/**
 * @feature CLOUD-09 Cloud terminals, run scripts and previews
 * Owns: the desktop's side of a cloud terminal: it opens the Worker's `/terminal` stream, sends the
 * start, input and resize messages, and turns output, exit and a dropped connection back into the
 * PtyHandle the terminal service already drives.
 * Behaviour: docs/plans/cloud-and-remote.md Part 1 point 7 (a cloud terminal runs in the sandbox
 * over the Worker's WebSocket; the cloud transport reconnects with backoff in the sidecar case,
 * and a terminal keeps its place only while its stream lives).
 * Must handle: a relay that closes without an exit (the terminal shows "Connection lost." and ends
 * with no exit code); an error message from the Worker; bytes split across chunks; a write after
 * the end. The screen text and snapshot come from a bounded text mirror, not a VT emulator, so the
 * renderer's screen is the real one.
 * Our design choice: the terminal carries base64 JSON lines over the same relay machinery as the
 * sidecar, so the Rust shell needs only a channel name, not a second protocol (D108).
 * Test first: opening one sends its start message on the terminal channel, and a lost stream ends
 * the terminal with "Connection lost.".
 */
import type { Host } from "@conducted/protocol";
import { appError, ok, type Result } from "@conducted/shared";
import type { Cloud, PtyHandle, ScreenSnapshot } from "../../platform/platform.ts";
import { stripTerminalEscapes } from "../../platform/terminal-escapes.ts";

type CloudHost = Extract<Host, { kind: "cloud" }>;

/** The text a terminal shows when its stream drops before the process says it ended. */
export const CONNECTION_LOST_TEXT = "Connection lost.";

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

/** One server message on a terminal stream. Unknown shapes are ignored. */
type ServerMessage =
	| { type: "ready" }
	| { type: "data"; data: string }
	| { type: "exit"; exitCode: number | null }
	| { type: "error"; message: string };

function parseServerMessage(line: string): ServerMessage | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(line);
	} catch {
		return null;
	}
	if (typeof parsed !== "object" || parsed === null) return null;
	const message = parsed as {
		type?: unknown;
		data?: unknown;
		exitCode?: unknown;
		message?: unknown;
	};
	switch (message.type) {
		case "ready":
			return { type: "ready" };
		case "data":
			return typeof message.data === "string" ? { type: "data", data: message.data } : null;
		case "exit":
			return {
				type: "exit",
				exitCode: typeof message.exitCode === "number" ? message.exitCode : null,
			};
		case "error":
			return typeof message.message === "string"
				? { type: "error", message: message.message }
				: null;
		default:
			return null;
	}
}

function bytesFromBase64(text: string): Uint8Array {
	let binary: string;
	try {
		binary = atob(text);
	} catch {
		return new Uint8Array();
	}
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
	return bytes;
}

function base64FromText(text: string): string {
	const bytes = new TextEncoder().encode(text);
	let binary = "";
	const block = 0x8000;
	for (let index = 0; index < bytes.length; index += block) {
		binary += String.fromCharCode(...bytes.subarray(index, index + block));
	}
	return btoa(binary);
}

const lastLines = (text: string, maxLines: number): string => {
	const lines = text.split("\n");
	while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
	return lines.slice(Math.max(0, lines.length - maxLines)).join("\n");
};

export interface CloudTerminalOptions {
	terminalId: string;
	cwd: string;
	cols?: number;
	rows?: number;
	command?: { program: string; args: readonly string[] };
	env?: Readonly<Record<string, string>>;
}

/**
 * Opens one terminal in a workspace's sandbox. The returned handle is the same PtyHandle the local
 * terminal service drives, so a cloud terminal reuses the service's rows, limits and screen saving.
 */
export async function openCloudTerminal(
	cloud: Cloud,
	host: CloudHost,
	options: CloudTerminalOptions,
): Promise<Result<PtyHandle>> {
	const opened = await cloud.openRelay({ url: host.url, vmId: host.vmId, channel: "terminal" });
	if (!opened.ok) return opened;
	const relay = opened.value;
	const cols = options.cols ?? DEFAULT_COLS;
	const rows = options.rows ?? DEFAULT_ROWS;

	let text = "";
	const dataListeners = new Set<(chunk: Uint8Array) => void>();
	const exitListeners = new Set<(exitCode: number | null, historyError: null) => void>();
	const pending: Uint8Array[] = [];
	let ended = false;
	let closed = false;

	const end = (exitCode: number | null): void => {
		if (ended) return;
		ended = true;
		for (const listener of [...exitListeners]) listener(exitCode, null);
		exitListeners.clear();
	};

	const append = (chunk: Uint8Array): void => {
		text += new TextDecoder().decode(chunk, { stream: true });
		if (dataListeners.size === 0) {
			pending.push(chunk);
			return;
		}
		for (const listener of [...dataListeners]) listener(chunk);
	};

	const appendText = (message: string): void => {
		append(new TextEncoder().encode(`\r\n${message}\r\n`));
	};

	const stopLine = relay.onLine((line) => {
		const message = parseServerMessage(line);
		if (message === null) return;
		switch (message.type) {
			case "ready":
				return;
			case "data":
				append(bytesFromBase64(message.data));
				return;
			case "error":
				appendText(message.message);
				return;
			case "exit":
				end(message.exitCode);
				return;
		}
	});
	const stopClosed = relay.onClosed(() => {
		closed = true;
		if (!ended) {
			appendText(CONNECTION_LOST_TEXT);
			end(null);
		}
		stopLine();
		stopClosed();
	});

	const startLine = JSON.stringify({
		type: "start",
		cwd: options.cwd,
		cols,
		rows,
		command:
			options.command === undefined
				? ["/bin/bash", "-l"]
				: [options.command.program, ...options.command.args],
		...(options.env === undefined ? {} : { env: options.env }),
	});
	const started = await relay.send(startLine);
	if (!started.ok) {
		stopLine();
		stopClosed();
		await relay.close();
		return started;
	}

	const handle: PtyHandle = {
		id: options.terminalId,
		write: async (data) => {
			if (ended || closed) {
				throw appError("terminal_not_running", "The terminal is not running.");
			}
			const sent = await relay.send(JSON.stringify({ type: "input", data: base64FromText(data) }));
			if (!sent.ok) {
				throw appError("terminal_write_failed", "Couldn't write to the terminal.", sent.error);
			}
		},
		resize: async (nextCols, nextRows) => {
			if (ended || closed) return;
			await relay.send(JSON.stringify({ type: "resize", cols: nextCols, rows: nextRows }));
		},
		kill: async () => {
			if (ended || closed) return;
			await relay.send(JSON.stringify({ type: "kill" }));
			// The Worker sends the exit; a stream that never answers is not left hanging.
			queueMicrotask(() => end(null));
		},
		onData: (listener) => {
			dataListeners.add(listener);
			for (const chunk of pending.splice(0)) listener(chunk);
			return () => {
				dataListeners.delete(listener);
			};
		},
		ack: async () => ok(undefined),
		onExit: (listener) => {
			if (ended) {
				queueMicrotask(() => listener(null, null));
				return () => {};
			}
			exitListeners.add(listener);
			return () => {
				exitListeners.delete(listener);
			};
		},
		screenText: async (maxLines) =>
			lastLines(stripTerminalEscapes(text).replace(/\r/g, ""), maxLines),
		screenSnapshot: async (): Promise<Result<ScreenSnapshot>> =>
			ok({
				data: text,
				cols,
				rows,
				alternateScreen: false,
				bracketedPaste: false,
			}),
	};
	return ok(handle);
}
