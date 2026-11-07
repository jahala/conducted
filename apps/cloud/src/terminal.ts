/**
 * @feature CLOUD-09 Cloud terminals, run scripts and previews
 * Owns: the wire protocol of a terminal WebSocket into a workspace's sandbox, the headless text
 * mirror the desktop reads for `GetTerminalOutput`, and the unguessable token a preview URL
 * carries.
 * Behaviour: docs/plans/cloud-and-remote.md Part 1 point 7 (a cloud terminal runs in the sandbox
 * through the container's PTY and streams over a WebSocket; previews go through the Worker). The
 * protocol is ours, because the research describes Conductor's cloud backend only as a concept
 * (D002): one JSON message per line, output carried as base64 so a byte never has to be UTF-8.
 * Must handle: a client message that is not the protocol's shape; output of any byte sequence;
 * a terminal that ends; a kill; a connection that ends while the process still runs. The mirror
 * keeps a bounded number of lines, so a long-running terminal cannot grow without limit.
 * Our design choice: the mirror keeps raw text, not a full VT screen. It serves the agent's
 * `GetTerminalOutput` tool and the saved screen, and the renderer holds the real screen. Research
 * gives no cloud mirror to match.
 * Test first: a start message runs the process, its output arrives as base64, and a bad message is
 * refused.
 */
import { z } from "zod";

/** One client message on a terminal WebSocket. */
const zClientMessage = z.discriminatedUnion("type", [
	z
		.object({
			type: z.literal("start"),
			cwd: z
				.string()
				.min(1)
				.refine((path) => path.startsWith("/") && !path.includes("\u0000"), {
					message: "A terminal's folder must be absolute.",
				}),
			cols: z.number().int().positive().max(1000).default(80),
			rows: z.number().int().positive().max(1000).default(24),
			command: z.array(z.string()).min(1).optional(),
			env: z.record(z.string(), z.string()).optional(),
		})
		.strict(),
	z.object({ type: z.literal("input"), data: z.string() }).strict(),
	z
		.object({
			type: z.literal("resize"),
			cols: z.number().int().positive().max(1000),
			rows: z.number().int().positive().max(1000),
		})
		.strict(),
	z.object({ type: z.literal("kill") }).strict(),
]);

export type ClientMessage =
	| {
			type: "start";
			cwd: string;
			cols: number;
			rows: number;
			command: string[] | undefined;
			env: Record<string, string> | undefined;
	  }
	| { type: "input"; data: string }
	| { type: "resize"; cols: number; rows: number }
	| { type: "kill" }
	| { type: "invalid"; message: string };

/** One server message on a terminal WebSocket. */
export type ServerMessage =
	| { type: "ready" }
	| { type: "data"; data: string }
	| { type: "exit"; exitCode: number | null }
	| { type: "error"; message: string };

/** Reads one text frame. Anything that is not the protocol's shape becomes `invalid`. */
export function parseClientMessage(text: string): ClientMessage {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return { type: "invalid", message: "A terminal message must be JSON." };
	}
	const result = zClientMessage.safeParse(parsed);
	if (!result.success) {
		return { type: "invalid", message: "That terminal message is not one the app sends." };
	}
	const message = result.data;
	switch (message.type) {
		case "start":
			return {
				type: "start",
				cwd: message.cwd,
				cols: message.cols,
				rows: message.rows,
				command: message.command,
				env: message.env,
			};
		case "input":
			return { type: "input", data: message.data };
		case "resize":
			return { type: "resize", cols: message.cols, rows: message.rows };
		case "kill":
			return { type: "kill" };
	}
}

/** Base64 of a byte chunk, safe for a chunk larger than the argument limit. */
export function base64FromBytes(bytes: Uint8Array): string {
	let binary = "";
	const block = 0x8000;
	for (let index = 0; index < bytes.length; index += block) {
		binary += String.fromCharCode(...bytes.subarray(index, index + block));
	}
	return btoa(binary);
}

/** Bytes of a base64 chunk. Invalid base64 decodes to nothing, which the caller treats as empty. */
export function bytesFromBase64(text: string): Uint8Array {
	let binary: string;
	try {
		binary = atob(text);
	} catch {
		return new Uint8Array();
	}
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}
	return bytes;
}

/**
 * The text of the last lines a terminal printed. A carriage return ends a line, because a progress
 * bar rewrites one line thousands of times. The buffer holds at most `maxLines` lines.
 */
export class TerminalMirror {
	readonly #maxLines: number;
	#lines: string[] = [];
	#carry = "";
	readonly #decoder = new TextDecoder();

	constructor(maxLines = 5000) {
		this.#maxLines = maxLines;
	}

	append(chunk: Uint8Array): void {
		const text = this.#carry + this.#decoder.decode(chunk, { stream: true });
		const parts = text.split(/\r\n|\n|\r/);
		this.#carry = parts.pop() ?? "";
		for (const line of parts) this.#lines.push(line);
		this.#trim();
	}

	/** The text so far, with the unfinished last line included and the oldest lines dropped. */
	text(): string {
		const all = this.#carry === "" ? this.#lines : [...this.#lines, this.#carry];
		return all.slice(Math.max(0, all.length - this.#maxLines)).join("\n");
	}

	#trim(): void {
		const overflow = this.#lines.length - this.#maxLines;
		if (overflow > 0) this.#lines.splice(0, overflow);
	}
}

/** The part of a container process a terminal session drives. */
export interface TerminalProcess {
	readonly stdin: WritableStream<Uint8Array> | null;
	readonly stdout: ReadableStream<Uint8Array> | null;
	readonly exitCode: Promise<number>;
	kill(signal?: number): void;
	resize(cols: number, rows: number): void;
}

export interface TerminalStart {
	cwd: string;
	cols: number;
	rows: number;
	command: string[];
	env: Record<string, string> | undefined;
}

/**
 * One terminal WebSocket's session. It starts the process on the client's `start`, copies its
 * output and the client's input in both directions, and ends once the process exits or the
 * connection drops. The sink is the WebSocket; the callbacks are injected so the session can be
 * tested without a container.
 */
export class TerminalSession {
	readonly #send: (message: ServerMessage) => void;
	readonly #start: (input: TerminalStart) => Promise<TerminalProcess>;
	readonly #close: () => void;
	readonly #mirror = new TerminalMirror();
	#process: TerminalProcess | null = null;
	#started = false;
	#finished = false;
	#pump: Promise<void> | null = null;

	constructor(
		send: (message: ServerMessage) => void,
		start: (input: TerminalStart) => Promise<TerminalProcess>,
		close: () => void,
	) {
		this.#send = send;
		this.#start = start;
		this.#close = close;
	}

	/** The text the mirror has kept, for `GetTerminalOutput`. */
	mirrorText(): string {
		return this.#mirror.text();
	}

	/** Receives one client frame. */
	async receive(text: string): Promise<void> {
		const message = parseClientMessage(text);
		switch (message.type) {
			case "invalid":
				this.#send({ type: "error", message: message.message });
				return;
			case "start":
				if (this.#started || this.#finished) {
					this.#send({ type: "error", message: "This terminal has already started." });
					return;
				}
				await this.#begin(message);
				return;
			case "input": {
				const process = this.#process;
				if (process?.stdin == null || this.#finished) return;
				try {
					const writer = process.stdin.getWriter();
					await writer.write(bytesFromBase64(message.data));
					writer.releaseLock();
				} catch {
					this.#send({ type: "error", message: "The terminal could not take the input." });
				}
				return;
			}
			case "resize":
				this.#process?.resize(message.cols, message.rows);
				return;
			case "kill":
				this.#process?.kill();
				return;
		}
	}

	/** Ends the session when its connection drops, so no process outlives it. */
	disconnect(): void {
		this.#finished = true;
		this.#process?.kill();
		this.#close();
	}

	/** Resolves when the output pump has finished. Tests use it; production does not wait. */
	settled(): Promise<void> {
		return this.#pump ?? Promise.resolve();
	}

	async #begin(input: Extract<ClientMessage, { type: "start" }>): Promise<void> {
		this.#started = true;
		let process: TerminalProcess;
		try {
			process = await this.#start({
				cwd: input.cwd,
				cols: input.cols,
				rows: input.rows,
				command: input.command ?? ["/bin/bash", "-l"],
				env: input.env,
			});
		} catch (cause) {
			this.#finished = true;
			this.#send({
				type: "error",
				message: cause instanceof Error ? cause.message : "The terminal could not start.",
			});
			this.#close();
			return;
		}
		this.#process = process;
		this.#send({ type: "ready" });
		this.#pump = this.#copyOutput(process);
	}

	async #copyOutput(process: TerminalProcess): Promise<void> {
		const stdout = process.stdout;
		if (stdout !== null) {
			const reader = stdout.getReader();
			try {
				for (;;) {
					const { done, value } = await reader.read();
					if (done) break;
					if (value.length === 0) continue;
					this.#mirror.append(value);
					this.#send({ type: "data", data: base64FromBytes(value) });
				}
			} catch {
				// The process ended under the reader; its exit code below is the outcome.
			} finally {
				reader.releaseLock();
			}
		}
		const exitCode = await process.exitCode.catch(() => null);
		this.#finished = true;
		this.#send({ type: "exit", exitCode });
		this.#close();
	}
}

/** The number of bytes behind a preview token. */
export const PREVIEW_TOKEN_BYTES = 32;

const base64Url = (bytes: Uint8Array): string =>
	btoa(String.fromCharCode(...bytes))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");

/**
 * The unguessable part of a preview URL. It is derived from the Worker's pairing token, the
 * workspace name and the port, so the Worker needs no stored preview state: a URL it made can be
 * checked again later, and one port's URL cannot reach another port.
 */
export async function previewToken(secret: string, name: string, port: number): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign(
		"HMAC",
		key,
		new TextEncoder().encode(`${name}:${port}`),
	);
	return base64Url(new Uint8Array(signature).subarray(0, PREVIEW_TOKEN_BYTES));
}

/** Whether a preview request's token is the one this Worker made. */
export function previewTokenMatches(expected: string, given: string): boolean {
	if (expected.length !== given.length) return false;
	let difference = 0;
	for (let index = 0; index < expected.length; index += 1) {
		difference |= expected.charCodeAt(index) ^ given.charCodeAt(index);
	}
	return difference === 0;
}
