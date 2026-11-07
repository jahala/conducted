/**
 * @feature CLOUD-09 Cloud terminals, run scripts and previews
 * Owns: the desktop's side of a cloud terminal: it opens the Worker's `/terminal` stream, sends the
 * start, input and resize messages, and turns output, exit and a dropped connection back into the
 * PtyHandle the terminal service already drives.
 * Behaviour: docs/plans/cloud-and-remote.md Part 1 point 7 (a cloud terminal runs in the sandbox
 * over the Worker's WebSocket) and services-map.md 5A.4.5 (a dropped stream reconnects with
 * backoff, 2 s growing 1.5 times up to 30 s, and the new shell starts after a divider).
 * Must handle: an interactive terminal's dropped stream (retried with backoff; a new `start` runs
 * a new shell and "--- Sandbox reconnected ---" marks the seam; a kill stops the retries); a
 * one-shot command's dropped stream (it ends with "Connection lost." and no exit code, because
 * re-running it would repeat its work); an error message from the Worker; bytes split across
 * chunks; a write after the end or while reconnecting. The screen text and snapshot come from a
 * bounded text mirror, not a VT emulator, so the renderer's screen is the real one.
 * Our design choice: the terminal carries base64 JSON lines over the same relay machinery as the
 * sidecar, so the Rust shell needs only a channel name, not a second protocol (D108).
 * Test first: opening one sends its start message on the terminal channel, and a one-shot command
 * ends with a lost connection when the stream drops.
 */
import type { Host } from "@conducted/protocol";
import { appError, ok, type Result } from "@conducted/shared";
import type { Cloud, CloudRelay, PtyHandle, ScreenSnapshot } from "../../platform/platform.ts";
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
	/**
	 * Whether a dropped stream is retried. An interactive terminal reconnects (a new shell, with a
	 * divider), as Conductor's cloud transport does; a one-shot command ends with "Connection lost."
	 * because re-running it would repeat its work. Default: an interactive terminal.
	 */
	reconnect?: boolean;
}

/** The first wait before a reconnect, and the longest one (services-map.md 5A.4.5). */
export const RECONNECT_BASE_MS = 2_000;
export const RECONNECT_MAX_MS = 30_000;

/** The wait before attempt `attempt` (1 is the first): 2 s, 3 s, 4.5 s, up to 30 s. */
export function reconnectDelayMs(attempt: number): number {
	return Math.min(RECONNECT_BASE_MS * 1.5 ** (attempt - 1), RECONNECT_MAX_MS);
}

/** Shown where a reconnected terminal's new shell starts. */
export const RECONNECTED_TEXT = "--- Sandbox reconnected ---";

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
	const cols = options.cols ?? DEFAULT_COLS;
	const rows = options.rows ?? DEFAULT_ROWS;
	const reconnect = options.reconnect ?? options.command === undefined;
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

	let relay = opened.value;
	let text = "";
	const dataListeners = new Set<(chunk: Uint8Array) => void>();
	const exitListeners = new Set<(exitCode: number | null, historyError: null) => void>();
	const pending: Uint8Array[] = [];
	let ended = false;
	let stopped = false;
	let attempt = 0;
	let generation = 0;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let unwatch: (() => void) | null = null;

	const end = (exitCode: number | null): void => {
		if (ended) return;
		ended = true;
		attempt = 0;
		if (timer !== null) {
			clearTimeout(timer);
			timer = null;
		}
		unwatch?.();
		unwatch = null;
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

	/**
	 * Reopens the terminal stream after it dropped. The Worker ends the old process with its
	 * connection, so a new attempt sends `start` again and the sandbox runs a new shell. Writes
	 * during the wait are refused rather than queued, because the old process is gone.
	 */
	const reconnectNow = async (): Promise<void> => {
		if (ended || stopped) return;
		const next = await cloud.openRelay({ url: host.url, vmId: host.vmId, channel: "terminal" });
		if (ended || stopped) {
			if (next.ok) await next.value.close();
			return;
		}
		if (!next.ok) {
			scheduleReconnect();
			return;
		}
		const sent = await next.value.send(startLine);
		if (ended || stopped) {
			await next.value.close();
			return;
		}
		if (!sent.ok) {
			await next.value.close();
			scheduleReconnect();
			return;
		}
		unwatch?.();
		relay = next.value;
		attempt = 0;
		generation += 1;
		watch(next.value, generation);
		appendText(RECONNECTED_TEXT);
	};

	const scheduleReconnect = (): void => {
		if (ended || stopped || timer !== null) return;
		attempt += 1;
		timer = setTimeout(() => {
			timer = null;
			void reconnectNow();
		}, reconnectDelayMs(attempt));
	};

	const watch = (target: CloudRelay, generationOfRelay: number): void => {
		const current = generationOfRelay === generation;
		const stopLine = target.onLine((line) => {
			if (ended || generationOfRelay !== generation) return;
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
		const stopClosed = target.onClosed(() => {
			if (ended || stopped || !current || generationOfRelay !== generation) return;
			stopLine();
			stopClosed();
			if (reconnect) scheduleReconnect();
			else {
				appendText(CONNECTION_LOST_TEXT);
				end(null);
			}
		});
		unwatch = () => {
			stopLine();
			stopClosed();
		};
	};

	const started = await relay.send(startLine);
	if (!started.ok) {
		await relay.close();
		return started;
	}
	watch(relay, generation);

	const handle: PtyHandle = {
		id: options.terminalId,
		write: async (data) => {
			if (ended || stopped) {
				throw appError("terminal_not_running", "The terminal is not running.");
			}
			if (timer !== null) {
				throw appError("terminal_reconnecting", "The terminal is reconnecting.");
			}
			const sent = await relay.send(JSON.stringify({ type: "input", data: base64FromText(data) }));
			if (!sent.ok) {
				throw appError("terminal_write_failed", "Couldn't write to the terminal.", sent.error);
			}
		},
		resize: async (nextCols, nextRows) => {
			if (ended || stopped || timer !== null) return;
			await relay.send(JSON.stringify({ type: "resize", cols: nextCols, rows: nextRows }));
		},
		kill: async () => {
			if (ended || stopped) return;
			stopped = true;
			if (timer !== null) {
				clearTimeout(timer);
				timer = null;
			}
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
