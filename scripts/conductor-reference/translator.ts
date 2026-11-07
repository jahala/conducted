/**
 * The translator of the live reference run (stage 2): one page session of a frontend whose native
 * calls our real backend answers. Stage 1's backend.ts answers from sample data; this one answers
 * from our app, reached through the bridge page in our app's own window (bridge.ts).
 *
 * - A mapping (`LiveMapping`) says what each of the frontend's commands, sidecar methods and event
 *   names is in our backend. The name-by-name mapping for Conductor is drawn from Conductor's code, so
 *   it lives in the main checkout's `.context/day/conductor-ref/`; `identityMapping` runs our own UI
 *   on the same backend for the paired pictures.
 * - Handlers reach our backend only through their context: our commands (`ours.invoke`), channels of
 *   ours (`ours.channel`), and our sidecar's JSON-RPC over our `sidecar_send` command and
 *   `sidecar://line` event (`ours.sidecar`, `sidecarReply`). Lines from our sidecar that answer the
 *   translator's own requests are taken out; every other event of ours goes to the mapping's handler.
 * - The frontend's sidecar tunnel (one command and one event carrying JSON-RPC lines) is routed to the
 *   mapping's sidecar handlers; the page's answers to requests the translator sent it
 *   (`sidecarRequest`) come back the same way.
 * - Every call is recorded with its outcome: `answered` (ours answered; `via` names which of ours),
 *   `failed` (ours answered with an error, passed on as it is), `refused` (ours has no counterpart, a
 *   handler declined, or the run's host refused it), `decided` (a decision of ours leaves the feature
 *   out, and the handler names it) and `translator` (the handler answered without asking ours, such
 *   as a native setting with nothing to return). Nothing is answered with a value ours did not give,
 *   except under a named decision, and the record says so.
 */
import {
	Declined,
	type Push,
	REFERENCE_TOOLS,
	type ReferenceTools,
	type Tunnel,
} from "./backend.ts";

/** Our sidecar's transport in the Rust shell (platform/tauri.ts: `sidecar_send`, `sidecar://line`). */
export const OUR_SIDECAR = { send: "sidecar_send", lineArg: "line", lineEvent: "sidecar://line" };

/** The error code the run's host answers with for a call it never lets through (live-server.ts). */
export const REFUSED_CODE = "reference_refused";

export type LiveAnswer = { ok: true; value: unknown } | { ok: false; error: unknown };

/** Our backend, as the bridge hands it over. */
export interface Ours {
	invoke(command: string, args: unknown, bytes?: boolean): Promise<LiveAnswer>;
}

export type Outcome = "answered" | "failed" | "refused" | "decided" | "translator";

export interface CallRecord {
	kind: "command" | "sidecar" | "event";
	name: string;
	outcome: Outcome;
	/** Which of ours answered: command names, `sidecar:<method>` for our sidecar, our event names. */
	via: string[];
	detail?: string;
	decision?: string;
}

/** Our backend answered with an error: passed on to the page as it is. */
export class OursFailed extends Error {
	constructor(
		readonly command: string,
		readonly error: unknown,
	) {
		super(`${command}: ${errorText(error)}`);
	}
}

const errorText = (error: unknown): string =>
	typeof error === "object" && error !== null && "message" in error
		? String((error as { message: unknown }).message)
		: String(error);

export interface LiveContext<State> {
	state: State;
	tools: ReferenceTools;
	ours: {
		/** Calls one of our commands; the value, or OursFailed with our error. */
		invoke(command: string, args?: unknown, bytes?: boolean): Promise<unknown>;
		/** A channel of ours to pass in a command's arguments; its messages reach `onMessage`. */
		channel(onMessage: (message: unknown) => void): string;
		/** A JSON-RPC request to our sidecar; its result, or OursFailed with its error. */
		sidecar(method: string, params: unknown): Promise<unknown>;
		sidecarNotify(method: string, params: unknown): Promise<void>;
		/** Answers a request our sidecar sent. */
		sidecarReply(id: unknown, reply: { result?: unknown; error?: unknown }): Promise<void>;
	};
	/** Sends an event to the page. */
	emit(event: string, payload: unknown): void;
	/** Sends a raw message on one of the page's channels. */
	pageChannel(channel: number, message: unknown): void;
	/** A JSON-RPC notification to the page, through its sidecar tunnel. */
	sidecarSend(method: string, params: unknown): void;
	/** A JSON-RPC request to the page; resolves with its answer. */
	sidecarRequest(method: string, params: unknown): Promise<{ result?: unknown; error?: unknown }>;
	/** Refuses this call: ours has nothing that answers it. */
	decline(detail: string): never;
	/** Answers under a decision of ours that leaves this feature out. */
	decided<T>(decision: string, value: T): T;
}

export type LiveHandler<State> = (
	args: Record<string, unknown>,
	context: LiveContext<State>,
) => unknown;

export interface LiveMapping<State> {
	commands: Record<string, LiveHandler<State>>;
	/** Answers a command with no entry in `commands` (the identity mapping forwards it). */
	otherwise?(
		command: string,
		args: Record<string, unknown>,
		context: LiveContext<State>,
		bytes: boolean,
	): unknown;
	tunnel?: Tunnel;
	sidecar: Record<string, (params: unknown, context: LiveContext<State>) => unknown>;
	/** Our events, by name: what the page gets for each. */
	events: Record<string, (payload: unknown, context: LiveContext<State>) => unknown>;
	/** An event of ours with no entry in `events`. */
	otherEvent?(event: string, payload: unknown, context: LiveContext<State>): void;
	/**
	 * For each event name the page may listen to: our event that stands for it, null for none, or the
	 * decision that leaves the feature out.
	 */
	listens?: Record<string, string | null | { decided: string }>;
}

export interface LiveSession {
	invoke(command: string, args: Record<string, unknown>, bytes?: boolean): Promise<LiveAnswer>;
	/** One of our app's events, from the bridge. */
	ourEvent(event: string, payload: unknown): void;
	/** A message on a channel passed to ours: the translator's own, or the page's. */
	ourChannel(channel: number, message: unknown): void;
	/** The page started listening to an event. */
	listen(event: string): void;
}

interface RpcMessage {
	jsonrpc?: string;
	id?: number | string | null;
	method?: string;
	params?: unknown;
	result?: unknown;
	error?: unknown;
}

interface Waiting {
	resolve(message: RpcMessage): void;
}

/** The translator's own channels and request ids start here, above any the page hands out. */
const OWN_IDS = 1_000_000;

export function openLiveSession<State>(options: {
	mapping: LiveMapping<State>;
	state: State;
	ours: Ours;
	push(push: Push): void;
	record(record: CallRecord): void;
}): LiveSession {
	const { mapping, state, ours, push, record } = options;
	const channels = new Map<number, (message: unknown) => void>();
	const waitingOurs = new Map<string, Waiting>();
	const waitingPage = new Map<number, Waiting>();
	let nextChannel = OWN_IDS;
	let nextOurs = 1;
	let nextPage = OWN_IDS;

	const pageLine = (message: RpcMessage): void => {
		const tunnel = mapping.tunnel;
		if (tunnel === undefined) throw new Error("This mapping has no sidecar tunnel to the page.");
		const line = JSON.stringify({ jsonrpc: "2.0", ...message });
		push({ kind: "event", event: tunnel.replyEvent, payload: { [tunnel.lineArg]: line } });
	};

	/** A context for one call; `via` collects which of ours it reached. */
	const contextFor = (via: string[], mark: { decision?: string }): LiveContext<State> => {
		const invoke = async (
			command: string,
			args: unknown = {},
			bytes?: boolean,
		): Promise<unknown> => {
			via.push(command);
			const answer = await ours.invoke(command, args, bytes);
			if (answer.ok) return answer.value;
			const { error } = answer;
			if (
				typeof error === "object" &&
				error !== null &&
				(error as { code?: unknown }).code === REFUSED_CODE
			) {
				throw new Declined(`${command}: ${errorText(error)}`, error);
			}
			throw new OursFailed(command, error);
		};
		const sendOurs = async (message: RpcMessage): Promise<void> => {
			const answer = await ours.invoke(OUR_SIDECAR.send, {
				[OUR_SIDECAR.lineArg]: JSON.stringify({ jsonrpc: "2.0", ...message }),
			});
			if (!answer.ok) throw new OursFailed(OUR_SIDECAR.send, answer.error);
		};
		return {
			state,
			tools: REFERENCE_TOOLS,
			ours: {
				invoke,
				channel: (onMessage) => {
					const id = nextChannel++;
					channels.set(id, onMessage);
					return `__CHANNEL__:${id}`;
				},
				sidecar: async (method, params) => {
					via.push(`sidecar:${method}`);
					const id = `reference-${nextOurs++}`;
					const reply = new Promise<RpcMessage>((resolve) => waitingOurs.set(id, { resolve }));
					await sendOurs({ id, method, params });
					const message = await reply;
					if (message.error !== undefined) throw new OursFailed(`sidecar:${method}`, message.error);
					return message.result ?? null;
				},
				sidecarNotify: async (method, params) => {
					via.push(`sidecar:${method}`);
					await sendOurs({ method, params });
				},
				sidecarReply: async (id, reply) => await sendOurs({ id: id as number | string, ...reply }),
			},
			emit: (event, payload) => push({ kind: "event", event, payload }),
			pageChannel: (channel, message) => push({ kind: "channel", channel, message }),
			sidecarSend: (method, params) => pageLine({ method, params }),
			sidecarRequest: (method, params) => {
				const id = nextPage++;
				const reply = new Promise<RpcMessage>((resolve) => waitingPage.set(id, { resolve }));
				pageLine({ id, method, params });
				return reply.then(({ result, error }) => ({ result, error }));
			},
			decline: (detail) => {
				throw new Declined(detail);
			},
			decided: (decision, value) => {
				mark.decision = decision;
				return value;
			},
		};
	};

	/** Runs one call and records it; the answer for the page. */
	const settle = async (
		kind: CallRecord["kind"],
		name: string,
		run: (context: LiveContext<State>) => unknown,
	): Promise<LiveAnswer> => {
		const via: string[] = [];
		const mark: { decision?: string } = {};
		const done = (outcome: Outcome, detail?: string): void =>
			record({
				kind,
				name,
				outcome,
				via,
				...(detail === undefined ? {} : { detail }),
				...(mark.decision === undefined ? {} : { decision: mark.decision }),
			});
		try {
			const value = (await run(contextFor(via, mark))) ?? null;
			done(mark.decision !== undefined ? "decided" : via.length > 0 ? "answered" : "translator");
			return { ok: true, value };
		} catch (cause) {
			if (cause instanceof Declined) {
				done("refused", cause.detail);
				return { ok: false, error: cause.error ?? cause.message };
			}
			if (cause instanceof OursFailed) {
				done("failed", cause.message);
				return { ok: false, error: cause.error };
			}
			const message = cause instanceof Error ? cause.message : String(cause);
			done("failed", `translator: ${message}`);
			return { ok: false, error: message };
		}
	};

	const answerRpc = async (message: RpcMessage): Promise<void> => {
		if (message.method === undefined) {
			// The page's answer to a request the translator sent it.
			if (typeof message.id === "number") waitingPage.get(message.id)?.resolve(message);
			waitingPage.delete(message.id as number);
			return;
		}
		const isRequest = message.id !== undefined && message.id !== null;
		const handler = mapping.sidecar[message.method];
		const method = message.method;
		const answer = await settle("sidecar", method, (context) =>
			handler === undefined
				? context.decline("no counterpart in our sidecar")
				: handler(message.params, context),
		);
		if (!isRequest) return;
		pageLine(
			answer.ok
				? { id: message.id, result: answer.value }
				: { id: message.id, error: { code: -32601, message: errorText(answer.error) } },
		);
	};

	const eventContext = (): LiveContext<State> => contextFor([], {});

	return {
		invoke: async (command, args, bytes) => {
			const tunnel = mapping.tunnel;
			if (tunnel !== undefined && command === tunnel.command) {
				const line = args[tunnel.lineArg];
				if (typeof line !== "string")
					return { ok: false, error: `${command} needs ${tunnel.lineArg}.` };
				const parsed = JSON.parse(line) as RpcMessage | RpcMessage[];
				// The tunnel only carries the line, as Rust's relay does; answers come back as events.
				for (const message of Array.isArray(parsed) ? parsed : [parsed]) {
					answerRpc(message).catch((cause: unknown) =>
						console.error(`[live] sidecar call ${String(message.method)} failed:`, cause),
					);
				}
				return { ok: true, value: null };
			}
			const handler = mapping.commands[command];
			const otherwise = mapping.otherwise;
			return await settle("command", command, (context) => {
				if (handler !== undefined) return handler(args, context);
				if (otherwise !== undefined) return otherwise(command, args, context, bytes === true);
				return context.decline("no counterpart in our backend");
			});
		},
		ourEvent: (event, payload) => {
			if (event === OUR_SIDECAR.lineEvent && typeof payload === "string") {
				let message: RpcMessage | null = null;
				try {
					message = JSON.parse(payload) as RpcMessage;
				} catch {
					message = null;
				}
				const id = message?.id;
				if (message !== null && message.method === undefined && typeof id === "string") {
					const waiting = waitingOurs.get(id);
					if (waiting !== undefined) {
						waitingOurs.delete(id);
						waiting.resolve(message);
						return;
					}
				}
			}
			const handler = mapping.events[event];
			const run = async (): Promise<void> => {
				if (handler !== undefined) await handler(payload, eventContext());
				else mapping.otherEvent?.(event, payload, eventContext());
			};
			run().catch((cause: unknown) =>
				console.error(`[live] our event ${event} could not be passed on:`, cause),
			);
		},
		ourChannel: (channel, message) => {
			const own = channels.get(channel);
			if (own !== undefined) own(message);
			else push({ kind: "channel", channel, message });
		},
		listen: (event) => {
			const listens = mapping.listens;
			if (listens === undefined) return;
			const ourEvent = listens[event];
			if (typeof ourEvent === "object" && ourEvent !== null) {
				record({
					kind: "event",
					name: event,
					outcome: "decided",
					via: [],
					decision: ourEvent.decided,
				});
				return;
			}
			record({
				kind: "event",
				name: event,
				outcome: typeof ourEvent === "string" ? "answered" : "refused",
				via: typeof ourEvent === "string" ? [ourEvent] : [],
			});
		},
	};
}

/** Our own UI on our own backend: every command and event passes unchanged. */
export function identityMapping(): LiveMapping<unknown> {
	return {
		commands: {},
		otherwise: async (command, args, context, bytes) =>
			await context.ours.invoke(command, args, bytes),
		sidecar: {},
		events: {},
		otherEvent: (event, payload, context) => context.emit(event, payload),
	};
}
