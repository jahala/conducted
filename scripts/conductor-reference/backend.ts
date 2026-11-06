/**
 * The reference backend: what answers a frontend's native calls for one page session. It routes each
 * call to a handler table, the way a Tauri app routes `invoke` to its commands.
 *
 * - Built in, because they are Tauri's public contracts: the SQL plugin (sql-plugin.ts), the event
 *   plugin's `emit` and `emit_to` (the event goes back to the page), and a JSON-RPC tunnel carried by one
 *   command and one event, as a sidecar's is.
 * - Everything else comes from the mapping (`ReferenceMapping`): a table of command handlers and a table
 *   of sidecar-method handlers. The mapping is drawn from the reference app's code, so it lives in the
 *   git-ignored `.context/` folder and is loaded by path.
 * - A call no handler answers is logged with its name, how often it came and its first arguments, and
 *   is answered with an error. A handler that throws is answered with its message. Nothing is answered
 *   with a value no handler gave.
 */
import { type Answer, openSqlPlugin } from "./sql-plugin.ts";
import type { SqlJsStatic } from "./sqljs-types.ts";

/** What a page session receives: an event, or a message on a Tauri channel. */
export type Push =
	| { kind: "event"; event: string; payload: unknown }
	| { kind: "channel"; channel: number; message: unknown };

export interface SessionContext<State = unknown> {
	state: State;
	/** Sends an event to the page, as Rust's `emit` does. */
	emit(event: string, payload: unknown): void;
	/**
	 * Sends a message on a channel the page passed in its arguments (`__CHANNEL__:<id>`), numbered in
	 * order as Tauri numbers them.
	 */
	send(channel: number, message: unknown): void;
	/** Sends a JSON-RPC notification or request from the sidecar to the page. */
	sidecarSend(method: string, params: unknown): void;
	/** Declines this call (see `Declined`), so a mapping loaded by path needs no import of ours. */
	decline(detail: string): never;
}

export type CommandHandler<State = unknown> = (
	args: Record<string, unknown>,
	context: SessionContext<State>,
) => unknown;

export interface Tunnel {
	/** The command whose argument carries one JSON-RPC line to the sidecar. */
	command: string;
	/** The argument that holds the line. */
	lineArg: string;
	/** The event whose payload carries one line back, as `{ [lineArg]: line }`. */
	replyEvent: string;
}

export interface Boot {
	/** The labels `__TAURI_INTERNALS__.metadata` gives the current window and webview. */
	windowLabel: string;
	webviewLabel: string;
	/** Extra globals the page reads synchronously at start, by name (such as an OS plugin's values). */
	globals: Record<string, unknown>;
}

export interface ReferenceMapping<State = unknown> {
	/** The page route that shows this state, or null when the reference has no such screen. */
	route(state: State): string | null;
	databases(state: State): {
		name: string;
		schema: string;
		rows?: Record<string, Record<string, unknown>[]>;
		setup?: string[];
	}[];
	boot(state: State): Boot | Promise<Boot>;
	commands: Record<string, CommandHandler<State>>;
	tunnel?: Tunnel;
	sidecar: Record<string, (params: unknown, context: SessionContext<State>) => unknown>;
}

/**
 * Thrown by a handler that has no answer for this particular call, such as a shell command the sample
 * data has no output for. The call is logged as unanswered under `<name>: <detail>` and answered with
 * an error, the same as a call with no handler.
 */
export class Declined extends Error {
	constructor(readonly detail: string) {
		super(`The reference has no answer for ${detail}.`);
	}
}

export interface Unanswered {
	kind: "command" | "sidecar";
	name: string;
	count: number;
	firstArgs: unknown;
}

/** One log for a whole run: every unanswered call, by kind and name. */
export class UnansweredLog {
	readonly #entries = new Map<string, Unanswered>();

	record(kind: Unanswered["kind"], name: string, args: unknown): void {
		const key = `${kind}:${name}`;
		const entry = this.#entries.get(key);
		if (entry === undefined) this.#entries.set(key, { kind, name, count: 1, firstArgs: args });
		else entry.count += 1;
	}

	list(): Unanswered[] {
		return [...this.#entries.values()].sort(
			(a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name),
		);
	}
}

export interface BackendSession {
	invoke(command: string, args: Record<string, unknown>): Promise<Answer>;
	close(): void;
}

interface RpcMessage {
	jsonrpc?: string;
	id?: number | string | null;
	method?: string;
	params?: unknown;
	result?: unknown;
	error?: unknown;
}

const failure = (cause: unknown): string =>
	cause instanceof Error ? cause.message : String(cause);

/** A page session's backend: fresh databases from `databases`, the mapping's handlers, one push sink. */
export function openSession<State>(options: {
	SQL: SqlJsStatic;
	mapping: ReferenceMapping<State>;
	state: State;
	databases: readonly { name: string; bytes: Uint8Array }[];
	log: UnansweredLog;
	push(message: Push): void;
}): BackendSession {
	const { mapping, state, log, push } = options;
	const sql = openSqlPlugin(options.SQL, options.databases);
	const tunnel = mapping.tunnel;
	let nextSidecarId = 1;
	const channelIndex = new Map<number, number>();

	const sendLine = (message: RpcMessage): void => {
		if (tunnel === undefined) return;
		const line = JSON.stringify({ jsonrpc: "2.0", ...message });
		push({ kind: "event", event: tunnel.replyEvent, payload: { [tunnel.lineArg]: line } });
	};
	const context: SessionContext<State> = {
		state,
		emit: (event, payload) => push({ kind: "event", event, payload }),
		send: (channel, message) => {
			const index = channelIndex.get(channel) ?? 0;
			channelIndex.set(channel, index + 1);
			push({ kind: "channel", channel, message: { index, message } });
		},
		sidecarSend: (method, params) => sendLine({ id: nextSidecarId++, method, params }),
		decline: (detail) => {
			throw new Declined(detail);
		},
	};

	const answerRpc = async (message: RpcMessage): Promise<void> => {
		if (message.method === undefined) return; // The page's answer to a request the sidecar sent.
		const isRequest = message.id !== undefined && message.id !== null;
		const handler = mapping.sidecar[message.method];
		if (handler === undefined) {
			log.record("sidecar", message.method, message.params);
			if (isRequest) {
				sendLine({
					id: message.id,
					error: {
						code: -32601,
						message: `The reference sidecar does not answer ${message.method}.`,
					},
				});
			}
			return;
		}
		try {
			const result = await handler(message.params, context);
			if (isRequest) sendLine({ id: message.id, result: result ?? null });
		} catch (cause) {
			if (cause instanceof Declined) {
				log.record("sidecar", `${message.method}: ${cause.detail}`, message.params);
			}
			const code = cause instanceof Declined ? -32601 : -32000;
			if (isRequest) sendLine({ id: message.id, error: { code, message: failure(cause) } });
		}
	};

	const builtIn = async (
		command: string,
		args: Record<string, unknown>,
	): Promise<Answer | undefined> => {
		if (sql.handles(command)) return sql.call(command, args);
		if (command === "plugin:event|emit" || command === "plugin:event|emit_to") {
			push({ kind: "event", event: String(args.event), payload: args.payload ?? null });
			return { ok: true, value: null };
		}
		if (tunnel !== undefined && command === tunnel.command) {
			const line = args[tunnel.lineArg];
			if (typeof line !== "string")
				return { ok: false, error: `${command} needs ${tunnel.lineArg}.` };
			const parsed = JSON.parse(line) as RpcMessage | RpcMessage[];
			for (const message of Array.isArray(parsed) ? parsed : [parsed]) await answerRpc(message);
			return { ok: true, value: null };
		}
		return undefined;
	};

	return {
		invoke: async (command, args) => {
			const answered = await builtIn(command, args);
			if (answered !== undefined) return answered;
			const handler = mapping.commands[command];
			if (handler === undefined) {
				log.record("command", command, args);
				return { ok: false, error: `The reference backend does not answer ${command}.` };
			}
			try {
				return { ok: true, value: (await handler(args, context)) ?? null };
			} catch (cause) {
				if (cause instanceof Declined) log.record("command", `${command}: ${cause.detail}`, args);
				return { ok: false, error: failure(cause) };
			}
		},
		close: () => sql.close(),
	};
}
