/**
 * The app's end of a sidecar socket for the differential run (diff.ts): newline-delimited JSON-RPC
 * 2.0 both ways, as both sidecars speak it.
 *
 * - `request` sends a call and resolves with its answer or its error, never throws.
 * - Every line the sidecar sends is kept in `received`, in order, with the time it arrived.
 * - A request from the sidecar (it has an id and a method) goes to `onRequest`; what that returns is
 *   sent back as the answer. With no handler, the answer is a method-not-found error.
 * - `waitFor` resolves when a received line matches, or with undefined after the timeout. The timeout
 *   only catches a hang; scenarios wait for the event they need.
 */
import { connect, type Socket } from "node:net";

export type Json = Record<string, unknown>;

export interface Received {
	at: number;
	message: Json;
}

export type Answer = { result: unknown } | { error: { code: number; message: string } };

export class SidecarClient {
	readonly received: Received[] = [];
	readonly sent: Json[] = [];
	onRequest: ((method: string, params: unknown) => Promise<Answer> | Answer) | undefined;

	private nextId = 1;
	private buffer = "";
	private readonly waiting = new Map<number, (answer: Answer) => void>();
	private readonly watchers: { test: (m: Json) => boolean; done: (m: Json) => void }[] = [];

	private constructor(private readonly socket: Socket) {
		socket.setEncoding("utf8");
		socket.on("data", (chunk: string) => this.take(chunk));
	}

	static open(path: string): Promise<SidecarClient> {
		return new Promise((resolve, reject) => {
			const socket = connect(path);
			socket.once("connect", () => resolve(new SidecarClient(socket)));
			socket.once("error", reject);
		});
	}

	private write(message: Json): void {
		this.sent.push(message);
		this.socket.write(`${JSON.stringify(message)}\n`);
	}

	private take(chunk: string): void {
		this.buffer += chunk;
		const lines = this.buffer.split("\n");
		this.buffer = lines.pop() ?? "";
		for (const line of lines) {
			if (line.trim() === "") continue;
			let message: Json;
			try {
				message = JSON.parse(line) as Json;
			} catch {
				message = { unparsed: line };
			}
			this.received.push({ at: Date.now(), message });
			this.route(message);
			for (const watcher of [...this.watchers])
				if (watcher.test(message)) {
					this.watchers.splice(this.watchers.indexOf(watcher), 1);
					watcher.done(message);
				}
		}
	}

	private route(message: Json): void {
		const id = message.id;
		const method = message.method;
		if (typeof method === "string" && id !== undefined && id !== null) {
			void this.answer(id, method, message.params);
			return;
		}
		if (typeof id === "number" && method === undefined) {
			const done = this.waiting.get(id);
			this.waiting.delete(id);
			if (done === undefined) return;
			if (message.error !== undefined)
				done({ error: message.error as { code: number; message: string } });
			else done({ result: message.result });
		}
	}

	private async answer(id: unknown, method: string, params: unknown): Promise<void> {
		const answer: Answer =
			this.onRequest === undefined
				? { error: { code: -32601, message: `no handler for ${method}` } }
				: await this.onRequest(method, params);
		this.write({ jsonrpc: "2.0", id, ...answer });
	}

	request(method: string, params: unknown): Promise<Answer> {
		const id = this.nextId++;
		return new Promise((resolve) => {
			this.waiting.set(id, resolve);
			this.write({ jsonrpc: "2.0", id, method, params });
		});
	}

	notify(method: string, params: unknown): void {
		this.write({ jsonrpc: "2.0", method, params });
	}

	/** Resolves with the first line at or after index `from` of `received` that matches. */
	waitFor(
		test: (message: Json) => boolean,
		timeoutMs: number,
		from = 0,
	): Promise<Json | undefined> {
		const seen = this.received.slice(from).find((r) => test(r.message));
		if (seen !== undefined) return Promise.resolve(seen.message);
		return new Promise((resolve) => {
			const watcher = {
				test,
				done: (m: Json) => {
					clearTimeout(timer);
					resolve(m);
				},
			};
			const timer = setTimeout(() => {
				this.watchers.splice(this.watchers.indexOf(watcher), 1);
				resolve(undefined);
			}, timeoutMs);
			this.watchers.push(watcher);
		});
	}

	close(): void {
		this.socket.end();
		this.socket.destroy();
	}
}
