/**
 * CLOUD-02 spike only. Drives a cloud workspace from this Mac the way the desktop app would:
 * JSON-RPC 2.0 lines (packages/protocol) over the Worker's WebSocket, and every session event
 * stored through the desktop's own repositories (apps/desktop/src/core/db) in a SQLite file
 * built from the app's migrations, then acknowledged with `eventPersisted`.
 *
 * Usage (from spike/cloud; scripts/drive.sh bundles it with esbuild, because the shared package
 * uses TypeScript that Node's type stripping refuses, and Bun has no node:sqlite):
 *   scripts/drive.sh start <name>
 *   scripts/drive.sh turn <name> <chat> <prompt> [--disconnect-after-ack <ms>]
 *   scripts/drive.sh exec <name> <argv...>
 *   scripts/drive.sh backup <name> <dir>
 *   scripts/drive.sh restore <name> <dir> [<backup id>]
 *   scripts/drive.sh destroy|forget <name>
 * Environment: SPIKE_URL (the workers.dev URL). The pairing token is read from
 * /tmp/conducted-spike-cloud/pairing-token, never from the command line.
 * Every command writes its measurements to runs/<time>-<command>.json.
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createRepoRepository } from "../../../apps/desktop/src/core/db/repos.ts";
import { createSessionEventRepository } from "../../../apps/desktop/src/core/db/session-events.ts";
import { createSessionRepository } from "../../../apps/desktop/src/core/db/sessions.ts";
import { createWorkspaceRepository } from "../../../apps/desktop/src/core/db/workspaces.ts";
import { DATABASE_PRAGMAS } from "../../../apps/desktop/src/platform/queued-database.ts";
import { createNodeQueuedDatabase } from "../../../apps/desktop/src/test/node-sql.ts";
import {
	type SessionConfig,
	sidecarToAppNotifications,
	sidecarToAppRequests,
	type WorkspaceContext,
} from "../../../packages/protocol/src/index.ts";
import type {
	MessageId,
	RepoId,
	SessionId,
	TurnId,
	WorkspaceId,
} from "../../../packages/shared/src/index.ts";
import { cryptoIds, systemClock } from "../../../packages/shared/src/index.ts";

// scripts/drive.sh bundles this file into /tmp and runs it from spike/cloud.
const SPIKE = process.cwd();
if (!existsSync(join(SPIKE, "wrangler.jsonc"))) throw new Error("Run from spike/cloud");
const REPO_ROOT = resolve(SPIKE, "../..");
const STATE_DIR = "/tmp/conducted-spike-cloud";
const DB_PATH = join(STATE_DIR, "conducted.sqlite");
const STATE_PATH = join(STATE_DIR, "state.json");
const TOKEN_PATH = join(STATE_DIR, "pairing-token");
const RUNS_DIR = join(SPIKE, "runs");
const MODEL = "claude-haiku-5-5";
const WORKSPACE_PATH = "/workspace/repo";

const BASE_URL = process.env.SPIKE_URL;
if (!BASE_URL) throw new Error("Set SPIKE_URL to the Worker's workers.dev URL");
const TOKEN = readFileSync(TOKEN_PATH, "utf8").trim();
const AUTH = { authorization: `Bearer ${TOKEN}` };

interface State {
	repoId: RepoId;
	workspaceId: WorkspaceId;
	/** Chat label -> stored session id and whether it has sent its first message. */
	chats: Record<string, { sessionId: SessionId; sentFirst: boolean }>;
}

// ---------------------------------------------------------------- the desktop's database

function openDatabase() {
	mkdirSync(STATE_DIR, { recursive: true });
	const fresh = !existsSync(DB_PATH);
	const raw = new DatabaseSync(DB_PATH);
	for (const pragma of DATABASE_PRAGMAS) raw.exec(pragma);
	if (fresh) {
		const dir = join(REPO_ROOT, "apps/desktop/src-tauri/migrations");
		for (const name of readdirSync(dir)
			.filter((n) => n.endsWith(".sql"))
			.sort()) {
			raw.exec(readFileSync(join(dir, name), "utf8"));
		}
	}
	const db = createNodeQueuedDatabase(raw);
	const deps = { clock: systemClock, ids: cryptoIds };
	return {
		raw,
		repos: createRepoRepository(db, deps),
		workspaces: createWorkspaceRepository(db, deps),
		sessions: createSessionRepository(db, deps),
		events: createSessionEventRepository(db, deps),
	};
}
type Db = ReturnType<typeof openDatabase>;

function must<T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): T {
	if (!result.ok) throw new Error(result.error.message);
	return result.value;
}

const baseConfig: SessionConfig = {
	agent: "claude",
	model: MODEL,
	effort: "low",
	fastMode: false,
	planMode: false,
	requireToolApproval: false,
	additionalDirectories: [],
	appTools: { diffComments: false, progressUpdates: false, setTargetBranch: false },
};

async function loadState(db: Db): Promise<State> {
	if (existsSync(STATE_PATH)) return JSON.parse(readFileSync(STATE_PATH, "utf8")) as State;
	const repo = must(
		await db.repos.create({
			name: "spike",
			rootPath: "cloud:conducted-spike/workspace/repo",
			remoteUrl: null,
			defaultBranch: "main",
			icon: null,
		}),
	);
	const workspace = must(
		await db.workspaces.create({
			repoId: repo.id,
			directoryName: "spike",
			path: WORKSPACE_PATH,
			branch: "main",
			branchIsPlaceholder: false,
			targetBranch: "origin/main",
			port: 5123,
			linkedPaths: [],
			setupLogPath: null,
		}),
	);
	const state: State = { repoId: repo.id, workspaceId: workspace.id, chats: {} };
	saveState(state);
	return state;
}

function saveState(state: State): void {
	writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

// ---------------------------------------------------------------- recording

function writeRun(command: string, record: unknown): string {
	mkdirSync(RUNS_DIR, { recursive: true });
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const path = join(RUNS_DIR, `${stamp}-${command}.json`);
	writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
	return path;
}

async function post(
	name: string,
	action: string,
	body?: unknown,
): Promise<{ status: number; json: unknown; ms: number }> {
	const began = performance.now();
	const response = await fetch(`${BASE_URL}/w/${name}/${action}`, {
		method: "POST",
		headers: { ...AUTH, "content-type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const text = await response.text();
	let json: unknown = text;
	try {
		json = JSON.parse(text);
	} catch {}
	return { status: response.status, json, ms: Math.round(performance.now() - began) };
}

// ---------------------------------------------------------------- the JSON-RPC link

type Incoming = {
	id?: number | string;
	method?: string;
	params?: unknown;
	result?: unknown;
	error?: { code: number; message: string };
};

class Link {
	private nextId = 1;
	private buffered = "";
	private readonly decoder = new TextDecoder();
	private readonly pending = new Map<number, (message: Incoming) => void>();
	readonly closed: Promise<void>;

	private constructor(
		private readonly socket: WebSocket,
		private readonly onMessage: (message: Incoming, link: Link) => void,
	) {
		this.closed = new Promise((resolve) => socket.addEventListener("close", () => resolve()));
		socket.addEventListener("message", (event) => {
			const data = event.data;
			this.buffered +=
				typeof data === "string"
					? data
					: this.decoder.decode(data as ArrayBuffer, { stream: true });
			const lines = this.buffered.split("\n");
			this.buffered = lines.pop() ?? "";
			for (const line of lines) {
				if (line.trim() === "") continue;
				const message = JSON.parse(line) as Incoming;
				if (message.method === undefined && typeof message.id === "number") {
					this.pending.get(message.id)?.(message);
					this.pending.delete(message.id);
				} else {
					this.onMessage(message, this);
				}
			}
		});
	}

	static open(name: string, onMessage: (message: Incoming, link: Link) => void): Promise<Link> {
		const url = `${BASE_URL?.replace(/^http/, "ws")}/w/${name}/rpc`;
		// Node's WebSocket (undici) accepts headers, so the token never goes in the URL.
		const socket = new WebSocket(url, { headers: AUTH } as unknown as string[]);
		socket.binaryType = "arraybuffer";
		return new Promise((resolve, reject) => {
			socket.addEventListener("open", () => resolve(new Link(socket, onMessage)), { once: true });
			socket.addEventListener(
				"error",
				(event) =>
					reject(new Error(`WebSocket failed: ${String((event as ErrorEvent).message ?? "")}`)),
				{ once: true },
			);
		});
	}

	private send(message: object): void {
		this.socket.send(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
	}

	request(method: string, params: unknown): Promise<Incoming> {
		const id = this.nextId++;
		return new Promise((resolve) => {
			this.pending.set(id, resolve);
			this.send({ id, method, params });
		});
	}

	notify(method: string, params: unknown): void {
		this.send({ method, params });
	}

	reply(id: number | string, result: unknown): void {
		this.send({ id, result });
	}

	fail(id: number | string, code: number, message: string): void {
		this.send({ id, error: { code, message } });
	}

	close(): void {
		this.socket.close(1000, "done");
	}
}

// ---------------------------------------------------------------- a turn

interface Timeline {
	t0: number;
	marks: Record<string, number>;
	events: {
		at: number;
		sequence: number;
		type: string;
		items?: string[];
		outcome?: string;
		via: string;
	}[];
	liveStates: { at: number; status: string; error?: string }[];
	notes: string[];
}

function mark(timeline: Timeline, name: string): void {
	if (timeline.marks[name] === undefined)
		timeline.marks[name] = Math.round(performance.now() - timeline.t0);
}

function handlerFor(db: Db, timeline: Timeline, turnId: TurnId, done: () => void) {
	const store = async (envelope: unknown, via: string, link: Link): Promise<boolean> => {
		const parsed = sidecarToAppNotifications.sessionEvent.parse(envelope);
		const at = Math.round(performance.now() - timeline.t0);
		const outcome = must(await db.events.append(parsed.sessionId, parsed.event, Date.now()));
		const event = parsed.event;
		const items = event.type === "agent" ? event.message.items.map((item) => item.kind) : undefined;
		timeline.events.push({
			at,
			sequence: parsed.sequence,
			type: event.type,
			items,
			outcome: event.type === "turn_ended" ? event.outcome : outcome.kind,
			via,
		});
		if (event.type === "agent") {
			mark(timeline, "firstAgentEvent");
			if (items?.some((kind) => kind === "text" || kind === "thinking" || kind === "tool_call")) {
				mark(timeline, "firstToken");
			}
		}
		link.notify("eventPersisted", { sessionId: parsed.sessionId, eventId: event.eventId });
		if (event.type === "turn_ended" && event.turnId === turnId) {
			mark(timeline, "turnEnded");
			if (event.error) timeline.notes.push(`turn error: ${event.error}`);
			done();
		}
		return true;
	};
	return (message: Incoming, link: Link): void => {
		const { id, method, params } = message;
		if (method === "sessionEvent") {
			void store(params, "notification", link).catch((error) =>
				timeline.notes.push(`store failed: ${error}`),
			);
		} else if (method === "deliverEvent" && id !== undefined) {
			sidecarToAppRequests.deliverEvent.params.parse(params);
			void store(params, "replay", link).then(
				(persisted) => link.reply(id, { persisted }),
				(error) => link.fail(id, -32000, String(error)),
			);
		} else if (method === "liveState") {
			const live = params as { liveState: { status: string; error?: string } };
			timeline.liveStates.push({
				at: Math.round(performance.now() - timeline.t0),
				status: live.liveState.status,
				error: live.liveState.error,
			});
		} else if (method === "agentSessionId") {
			const p = params as { sessionId: SessionId; agentSessionId: string };
			void db.sessions.setAgentSessionId(p.sessionId, p.agentSessionId);
			timeline.notes.push("agentSessionId stored");
		} else if (id !== undefined) {
			timeline.notes.push(`sidecar asked ${method}; answered method not found`);
			link.fail(id, -32601, `The spike driver does not handle ${method}`);
		} else if (method !== undefined) {
			timeline.notes.push(`notification ${method}`);
		}
	};
}

async function turn(
	name: string,
	chat: string,
	prompt: string,
	disconnectAfterAckMs: number | null,
) {
	const db = openDatabase();
	const state = await loadState(db);
	let entry = state.chats[chat];
	if (entry === undefined) {
		const session = must(
			await db.sessions.create({ workspaceId: state.workspaceId, title: chat, config: baseConfig }),
		);
		entry = { sessionId: session.id, sentFirst: false };
		state.chats[chat] = entry;
		saveState(state);
	}
	const stored = must(await db.sessions.get(entry.sessionId));
	const turnId = randomUUID() as TurnId;
	const workspace: WorkspaceContext = {
		workspaceId: state.workspaceId,
		workspaceName: "spike",
		workspacePath: WORKSPACE_PATH,
		repoRootPath: WORKSPACE_PATH,
		targetBranch: "origin/main",
		placeholderBranch: false,
		port: 5123,
	};
	const timeline: Timeline = {
		t0: performance.now(),
		marks: {},
		events: [],
		liveStates: [],
		notes: [],
	};
	const startedAtIso = new Date().toISOString();

	const start = await post(name, "start");
	mark(timeline, "sandboxReady");
	if (start.status !== 200) throw new Error(`start failed: ${JSON.stringify(start.json)}`);

	let finish: () => void = () => {};
	const ended = new Promise<void>((resolve) => {
		finish = resolve;
	});
	const onMessage = handlerFor(db, timeline, turnId, () => finish());
	let link = await Link.open(name, onMessage);
	mark(timeline, "socketOpen");
	// As the desktop does: a chat with a stored agent session id resumes it.
	const resume = stored?.agentSessionId ? { agentSessionId: stored.agentSessionId } : undefined;
	const reply = await link.request("sendMessage", {
		sessionId: entry.sessionId,
		messageId: randomUUID() as MessageId,
		turnId,
		text: prompt,
		attachmentPaths: [],
		delivery: "new_turn",
		firstMessage: !entry.sentFirst,
		config: baseConfig,
		workspace,
		launch: {
			executablePath: "/usr/local/bin/claude",
			env: {},
			// The plan's placeholder: the Worker's outbound handler swaps in the real key.
			providerKeys: { ANTHROPIC_API_KEY: { value: "provided-by-worker", source: "entered" } },
		},
		...(resume ? { resume } : {}),
	});
	mark(timeline, "sendAcknowledged");
	if (reply.error) throw new Error(`sendMessage failed: ${reply.error.message}`);
	entry.sentFirst = true;
	saveState(state);

	let disconnect: Record<string, unknown> | null = null;
	if (disconnectAfterAckMs !== null) {
		await new Promise((r) => setTimeout(r, disconnectAfterAckMs));
		link.close();
		await link.closed;
		mark(timeline, "disconnected");
		const eventsBefore = timeline.events.length;
		// Stay away long enough for the turn to finish without us.
		await new Promise((r) => setTimeout(r, 45_000));
		const again = await post(name, "start");
		link = await Link.open(name, onMessage);
		mark(timeline, "reconnected");
		disconnect = {
			afterAckMs: disconnectAfterAckMs,
			awayMs: 45_000,
			eventsBefore,
			restart: again.json,
		};
	}

	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<"timeout">((r) => {
		timer = setTimeout(() => r("timeout"), 300_000);
	});
	const outcome = await Promise.race([ended.then(() => "ended" as const), timeout]);
	clearTimeout(timer);
	// Let trailing acknowledgements leave before closing.
	await new Promise((r) => setTimeout(r, 500));
	link.close();

	const storedEvents = must(await db.events.listFrom(entry.sessionId, 0, 10_000));
	const record = {
		command: "turn",
		startedAt: startedAtIso,
		sandbox: name,
		chat,
		sessionId: entry.sessionId,
		turnId,
		prompt,
		model: MODEL,
		outcome,
		start: start.json,
		startHttpMs: start.ms,
		deliveredAs: reply.result,
		marks: timeline.marks,
		disconnect,
		events: timeline.events,
		liveStates: timeline.liveStates,
		notes: timeline.notes,
		storedEventsForChat: storedEvents.length,
		storedEventsThisTurn: storedEvents.filter((e) => e.turnId === turnId).length,
		finalText: storedEvents
			.filter((e) => e.turnId === turnId && e.event.type === "agent")
			.flatMap((e) => (e.event.type === "agent" ? e.event.message.items : []))
			.filter((item) => item.kind === "text")
			.map((item) => (item.kind === "text" ? item.text : ""))
			.join("\n"),
		usage: storedEvents
			.filter((e) => e.turnId === turnId && e.event.type === "agent")
			.flatMap((e) => (e.event.type === "agent" ? e.event.message.items : []))
			.filter((item) => item.kind === "usage"),
	};
	db.raw.close();
	console.log(
		JSON.stringify(
			{
				outcome,
				marks: timeline.marks,
				start: start.json,
				finalText: record.finalText,
				notes: timeline.notes,
			},
			null,
			2,
		),
	);
	console.log(`run written to ${writeRun("turn", record)}`);
}

// ---------------------------------------------------------------- the other commands

async function main(): Promise<void> {
	const [command, name, ...rest] = process.argv.slice(2);
	if (!command || !name) throw new Error("usage: drive.ts <command> <name> ...");
	switch (command) {
		case "turn": {
			const [chat, prompt, flag, value] = rest;
			if (!chat || !prompt) throw new Error("usage: turn <name> <chat> <prompt>");
			await turn(name, chat, prompt, flag === "--disconnect-after-ack" ? Number(value) : null);
			return;
		}
		case "start":
		case "destroy":
		case "forget": {
			const began = new Date().toISOString();
			const result = await post(name, command);
			console.log(JSON.stringify(result, null, 2));
			console.log(
				`run written to ${writeRun(command, { command, startedAt: began, sandbox: name, ...result })}`,
			);
			return;
		}
		case "exec": {
			const began = new Date().toISOString();
			const result = await post(name, "exec", { argv: rest, cwd: WORKSPACE_PATH });
			console.log(JSON.stringify(result, null, 2));
			console.log(
				`run written to ${writeRun("exec", { command, startedAt: began, sandbox: name, argv: rest, ...result })}`,
			);
			return;
		}
		case "backup":
		case "restore": {
			const began = new Date().toISOString();
			const result = await post(name, command, { dir: rest[0], id: rest[1] });
			console.log(JSON.stringify(result, null, 2));
			console.log(
				`run written to ${writeRun(command, { command, startedAt: began, sandbox: name, dir: rest[0], ...result })}`,
			);
			return;
		}
	}
	throw new Error(`unknown command ${command}`);
}

await main();
