/**
 * @feature AGENT-06 Codex: `codex app-server` JSON-RPC
 * Owns: the one in-memory child process (JsonRpcChild) that Codex client and runner tests use. It
 * records every line the client writes and lets a test emit lines, stderr text and an exit.
 * Behaviour: modes/sidecar-mode.ts `spawnJsonRpcChild`. A real child that is stopped reports its
 * exit to the exit listeners before `stop` resolves, so this one does too (once, with SIGTERM).
 * Must handle: a write hook that answers requests (`onWrite`), lines emitted whole or raw, stderr
 * text, and an exit the test triggers by itself.
 * Test first: the Codex client tests, "connect sends initialize and then the initialized
 * notification".
 */
import type { JsonRpcChild } from "../runners/codex/app-server-client.ts";

export interface JsonRpcMessage {
	jsonrpc: string;
	id?: number | string | null;
	method?: string;
	params?: unknown;
	result?: unknown;
	error?: { code: number; message: string };
}

export class FakeChild implements JsonRpcChild {
	readonly lines: JsonRpcMessage[] = [];
	stopped = false;
	onWrite: ((message: JsonRpcMessage) => void) | undefined;

	private readonly lineListeners: ((line: string) => void)[] = [];
	private readonly stderrListeners: ((text: string) => void)[] = [];
	private readonly exitListeners: ((code: number | null, signal: string | null) => void)[] = [];
	private exited = false;

	writeLine(line: string): void {
		const message = JSON.parse(line) as JsonRpcMessage;
		this.lines.push(message);
		this.onWrite?.(message);
	}

	onLine(listener: (line: string) => void): void {
		this.lineListeners.push(listener);
	}

	onStderr(listener: (text: string) => void): void {
		this.stderrListeners.push(listener);
	}

	onExit(listener: (code: number | null, signal: string | null) => void): void {
		this.exitListeners.push(listener);
	}

	stop(): Promise<void> {
		this.stopped = true;
		this.exit(null, "SIGTERM");
		return Promise.resolve();
	}

	emit(message: JsonRpcMessage): void {
		this.emitRaw(JSON.stringify(message));
	}

	emitRaw(line: string): void {
		for (const listener of this.lineListeners) listener(line);
	}

	emitStderr(text: string): void {
		for (const listener of this.stderrListeners) listener(text);
	}

	/** The process ended. Only the first exit is reported, as with a real process. */
	exit(code: number | null, signal: string | null): void {
		if (this.exited) return;
		this.exited = true;
		for (const listener of this.exitListeners) listener(code, signal);
	}
}
