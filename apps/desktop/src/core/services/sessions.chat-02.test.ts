// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { idleLiveState, type SessionEvent } from "@conducted/protocol";
import { appError, err, ok } from "@conducted/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../../platform/platform.ts";
import { REPOS_SQL, repoToParams } from "../db/repos.ts";
import { createRepositories, type Repositories } from "../db/repositories.ts";
import { sampleRepo, sampleSession, sampleWorkspace, workspaceId } from "../db/test-fixtures.ts";
import { WORKSPACES_SQL, workspaceToParams } from "../db/workspaces.ts";
import { SessionsService, type SessionsServiceDeps } from "./sessions.ts";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../src-tauri/migrations/", import.meta.url));
const MIGRATIONS = readdirSync(MIGRATIONS_DIR)
	.filter((name) => name.endsWith(".sql"))
	.sort()
	.map((name) => readFileSync(join(MIGRATIONS_DIR, name), "utf8"));

const bind = (params: readonly unknown[]): Record<string, never> =>
	Object.fromEntries(params.map((value, index) => [`$${index + 1}`, value])) as never;

class NodeDatabase implements Database {
	readonly #db: DatabaseSync;

	constructor(db: DatabaseSync) {
		this.#db = db;
		this.#db.exec("PRAGMA foreign_keys = ON");
	}

	async execute(sql: string, params: readonly unknown[] = []) {
		const result = this.#db.prepare(sql).run(bind(params));
		return {
			rowsAffected: Number(result.changes),
			lastInsertId: Number(result.lastInsertRowid),
		};
	}

	async select<Row>(sql: string, params: readonly unknown[] = []): Promise<Row[]> {
		return this.#db.prepare(sql).all(bind(params)) as Row[];
	}

	async transaction<T>(work: (db: Database) => Promise<T>): Promise<T> {
		this.#db.exec("BEGIN IMMEDIATE");
		try {
			const value = await work(this);
			this.#db.exec("COMMIT");
			return value;
		} catch (cause) {
			this.#db.exec("ROLLBACK");
			throw cause;
		}
	}
}

const must = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

interface Call {
	method: string;
	params: Record<string, unknown>;
}

interface Harness {
	service: SessionsService;
	calls: Call[];
	queue: { enqueue: ReturnType<typeof vi.fn> };
	composer: {
		materializeForSend: ReturnType<typeof vi.fn>;
		loadDraft: ReturnType<typeof vi.fn>;
		saveDraft: ReturnType<typeof vi.fn>;
	};
	settings: Record<string, unknown>;
	replyTo: (reply: (method: string, params: Record<string, unknown>) => Promise<unknown>) => void;
}

let raw: DatabaseSync;
let repositories: Repositories;
let now: number;
let nextId: number;

const workspace = {
	workspaceId,
	workspaceName: sampleWorkspace.directoryName,
	workspacePath: sampleWorkspace.path,
	repoRootPath: sampleRepo.rootPath,
	targetBranch: sampleWorkspace.targetBranch,
	placeholderBranch: sampleWorkspace.branchIsPlaceholder,
	port: sampleWorkspace.port,
};

const harness = (): Harness => {
	const calls: Call[] = [];
	let reply: (method: string, params: Record<string, unknown>) => Promise<unknown> = async () =>
		ok({});
	const settings: Record<string, unknown> = {
		default_message_send_mode: "steer",
		custom_prompt_general: "",
	};
	const queue = { enqueue: vi.fn(async () => ok({})) };
	const composer = {
		materializeForSend: vi.fn(async () => ok(["/ws/.context/a.txt"])),
		loadDraft: vi.fn(async () => ok({ text: "", attachmentPaths: [] })),
		saveDraft: vi.fn(),
	};
	const deps = {
		db: new NodeDatabase(raw),
		repositories: () => repositories,
		sidecar: {
			request: async (method: string, params: Record<string, unknown>) => {
				calls.push({ method, params });
				return reply(method, params);
			},
			notify: async () => ok(undefined),
		},
		composer: {
			...composer,
			clearDraft: async () => ok(undefined),
			draftOf: () => ({ text: "", attachmentPaths: [] }),
		},
		queue: {
			...queue,
			release: vi.fn(),
			pauseOnCancel: vi.fn(),
			store: { getState: () => ({ bySession: {}, pausedSessionIds: {} }) },
		},
		notifications: { onLiveStateChanged: vi.fn() },
		workspaceContextOf: vi.fn(async () => ok(workspace)),
		defaultConfig: async () => ok(sampleSession.config),
		setting: <T>(key: string) => settings[key] as T,
		now: () => now,
		newId: () => `generated-${++nextId}`,
	};
	return {
		service: new SessionsService(deps as unknown as SessionsServiceDeps),
		calls,
		queue,
		composer,
		settings,
		replyTo: (next) => {
			reply = next;
		},
	};
};

const seedWorkspace = (): void => {
	raw.prepare(REPOS_SQL.insert).run(bind(repoToParams(sampleRepo)));
	raw.prepare(WORKSPACES_SQL.insert).run(bind(must(workspaceToParams(sampleWorkspace))));
};

const sendMessageCalls = (calls: readonly Call[]): Call[] =>
	calls.filter((call) => call.method === "sendMessage");

beforeEach(() => {
	raw = new DatabaseSync(":memory:");
	for (const sql of MIGRATIONS) raw.exec(sql);
	now = 1000;
	nextId = 0;
	repositories = createRepositories(new NodeDatabase(raw), {
		clock: { now: () => now },
		ids: { uuid: () => `repo-${++nextId}` },
	});
});

afterEach(() => {
	raw.close();
});

describe("CHAT-02 sends a message as a new turn", () => {
	it("stores the message before the sidecar gets it and carries the query options", async () => {
		seedWorkspace();
		const h = harness();
		h.settings.custom_prompt_general = "Be brief. Show the diff before editing.";
		h.settings.claude_executable_path = "/opt/claude";
		const session = must(await h.service.create(workspaceId, sampleSession.config));

		let storedFirst = false;
		h.replyTo(async (method, params) => {
			if (method !== "sendMessage") return ok({});
			const sending = h.service.store.getState().sending[session.id] ?? [];
			storedFirst = sending.some((entry) => entry.messageId === params.messageId);
			return ok({ deliveredAs: "new_turn" });
		});

		const result = await h.service.send(session.id, "Fix login", ["/draft/a.txt"], "auto");

		expect(result).toEqual(ok(undefined));
		expect(storedFirst).toBe(true);
		const [call] = sendMessageCalls(h.calls);
		expect(call).toBeDefined();
		const params = call?.params ?? {};
		expect(params).toMatchObject({
			sessionId: session.id,
			text: "Fix login",
			delivery: "new_turn",
			firstMessage: true,
			attachmentPaths: ["/ws/.context/a.txt"],
			config: session.config,
			workspace: { ...workspace, userPreferences: "Be brief. Show the diff before editing." },
		});
		expect((params.launch as { executablePath?: string }).executablePath).toBe("/opt/claude");
		expect(params.resume).toBeUndefined();
	});

	it("marks later messages as follow-ups and keeps the preferences on every send", async () => {
		seedWorkspace();
		const h = harness();
		h.settings.custom_prompt_general = "Be brief.";
		const session = must(await h.service.create(workspaceId, sampleSession.config));
		must(await h.service.setAgentSessionId(session.id, "agent-abc"));
		must(
			await repositories.sessionEvents.append(
				session.id,
				{
					type: "user_message",
					eventId: "e1",
					at: 900,
					messageId: "m1",
					turnId: "t1",
					text: "Earlier",
					attachmentPaths: [],
					delivery: "new_turn",
					config: sampleSession.config,
				} as unknown as SessionEvent,
				900,
			),
		);

		await h.service.send(session.id, "Second", [], "auto");

		const [call] = sendMessageCalls(h.calls);
		expect(call?.params.firstMessage).toBe(false);
		const sentWorkspace = (call?.params.workspace ?? {}) as { userPreferences?: string };
		expect(sentWorkspace.userPreferences).toBe("Be brief.");
		expect(call?.params.resume).toEqual({ agentSessionId: sampleSession.agentSessionId });
	});

	it("clears the pending message when the user_message event or the turn end arrives", async () => {
		seedWorkspace();
		const h = harness();
		const session = must(await h.service.create(workspaceId, sampleSession.config));

		await h.service.send(session.id, "First", [], "auto");
		const first = sendMessageCalls(h.calls)[0]?.params ?? {};
		h.service.applyStoredEvent(
			session.id,
			0,
			{
				type: "user_message",
				eventId: "e1",
				at: 1000,
				messageId: first.messageId,
				turnId: first.turnId,
				text: "First",
				attachmentPaths: [],
				delivery: "new_turn",
				config: sampleSession.config,
			} as unknown as SessionEvent,
			1000,
		);
		expect(h.service.store.getState().sending[session.id]).toEqual([]);

		await h.service.send(session.id, "Second", [], "auto");
		const second = sendMessageCalls(h.calls)[1]?.params ?? {};
		h.service.applyStoredEvent(
			session.id,
			1,
			{
				type: "turn_ended",
				eventId: "e2",
				at: 2000,
				turnId: second.turnId,
				outcome: "cancelled",
			} as unknown as SessionEvent,
			2000,
		);
		expect(h.service.store.getState().sending[session.id]).toEqual([]);
	});

	it("queues or steers a message while the agent is working", async () => {
		seedWorkspace();
		const h = harness();
		const session = must(await h.service.create(workspaceId, sampleSession.config));
		h.service.store.setState({
			liveStates: {
				[session.id]: { ...idleLiveState, status: "working" },
			},
		});

		await h.service.send(session.id, "Queue this", [], "queue");
		expect(h.queue.enqueue).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionId: session.id,
				text: "Queue this",
				delivery: "queue",
			}),
		);
		expect(sendMessageCalls(h.calls)).toHaveLength(0);

		await h.service.send(session.id, "Steer this", [], "steer");
		const [call] = sendMessageCalls(h.calls);
		expect(call?.params.delivery).toBe("steer");
	});

	it("queues a steer for an agent that cannot steer", async () => {
		seedWorkspace();
		const h = harness();
		const session = must(
			await h.service.create(workspaceId, {
				...sampleSession.config,
				agent: "acp",
				acpAgent: "opencode",
			}),
		);
		h.settings.default_message_send_mode = "steer";
		h.service.store.setState({
			liveStates: {
				[session.id]: { ...idleLiveState, status: "working" },
			},
		});

		await h.service.send(session.id, "Steer", [], "auto");

		expect(h.queue.enqueue).toHaveBeenCalledTimes(1);
		expect(sendMessageCalls(h.calls)).toHaveLength(0);
	});
});

describe("CHAT-02 failed sends", () => {
	it("keeps a message that failed with the sidecar's error and sends it again on Retry", async () => {
		seedWorkspace();
		const h = harness();
		const session = must(await h.service.create(workspaceId, sampleSession.config));
		h.replyTo(async () => err(appError("send_failed", "The agent did not answer.")));

		const result = await h.service.send(session.id, "Fix login", [], "auto");

		expect(result).toMatchObject({ ok: false, error: { code: "send_failed" } });
		const failed = h.service.store.getState().failedSends?.[session.id] ?? [];
		expect(failed).toHaveLength(1);
		expect(failed[0]?.text).toBe("Fix login");
		expect(failed[0]?.error?.code).toBe("send_failed");
		expect(h.service.store.getState().sending[session.id]).toEqual([]);

		h.replyTo(async () => ok({ deliveredAs: "new_turn" }));
		const retried = await h.service.retryFailedSend(session.id, failed[0]?.messageId as never);

		expect(retried).toEqual(ok(undefined));
		expect(sendMessageCalls(h.calls)).toHaveLength(2);
		expect(sendMessageCalls(h.calls)[1]?.params.messageId).toBe(failed[0]?.messageId);
		expect(h.service.store.getState().failedSends?.[session.id]).toEqual([]);
	});

	it("puts a discarded message back in the composer and drops the failed row", async () => {
		seedWorkspace();
		const h = harness();
		const session = must(await h.service.create(workspaceId, sampleSession.config));
		h.replyTo(async () => err(appError("send_failed", "The agent did not answer.")));
		await h.service.send(session.id, "Fix login", [], "auto");
		const failed = h.service.store.getState().failedSends?.[session.id] ?? [];
		h.composer.loadDraft.mockResolvedValue(
			ok({ text: "Keep this", attachmentPaths: ["/draft/b.txt"] }),
		);

		const result = await h.service.discardFailedSend(session.id, failed[0]?.messageId as never);

		expect(result).toEqual(ok(undefined));
		expect(h.composer.saveDraft).toHaveBeenCalledWith(session.id, {
			text: "Fix login\n\nKeep this",
			attachmentPaths: ["/draft/b.txt"],
		});
		expect(h.service.store.getState().failedSends?.[session.id]).toEqual([]);
	});
});

describe("CHAT-02 config compare-and-set", () => {
	it("does not let a late config write overwrite a newer stored choice", async () => {
		seedWorkspace();
		const h = harness();
		const session = must(await h.service.create(workspaceId, sampleSession.config));
		const newer = { ...sampleSession.config, model: "sonnet" };
		must(await repositories.sessions.setConfig(session.id, newer));

		const result = await h.service.updateConfig(session.id, {
			...sampleSession.config,
			model: "haiku",
		});

		expect(result).toEqual(ok(undefined));
		expect(must(await repositories.sessions.get(session.id))?.config.model).toBe("sonnet");
		expect(h.service.store.getState().sessions[session.id]?.config.model).toBe("sonnet");
		expect(h.calls.some((call) => call.method === "updateConfig")).toBe(false);
	});

	it("writes the newest config and tells the sidecar", async () => {
		seedWorkspace();
		const h = harness();
		const session = must(await h.service.create(workspaceId, sampleSession.config));
		const next = { ...sampleSession.config, model: "haiku" };

		const result = await h.service.updateConfig(session.id, next);

		expect(result).toEqual(ok(undefined));
		expect(must(await repositories.sessions.get(session.id))?.config.model).toBe("haiku");
		expect(h.service.store.getState().sessions[session.id]?.config.model).toBe("haiku");
		const call = h.calls.find((entry) => entry.method === "updateConfig");
		expect(call?.params).toEqual({ sessionId: session.id, config: next });
	});

	it("stores the agent session id for resume", async () => {
		seedWorkspace();
		const h = harness();
		const session = must(await h.service.create(workspaceId, sampleSession.config));

		const result = await h.service.setAgentSessionId(session.id, "agent-xyz");

		expect(result).toEqual(ok(undefined));
		expect(must(await repositories.sessions.get(session.id))?.agentSessionId).toBe("agent-xyz");
		expect(h.service.store.getState().sessions[session.id]?.agentSessionId).toBe("agent-xyz");
	});
});

describe("CHAT-02 instructions from other services", () => {
	it("creates a chat when the workspace has none and sends the instruction", async () => {
		seedWorkspace();
		const h = harness();

		const created = must(await h.service.sendInstruction(workspaceId, "Commit and push"));

		expect(h.service.store.getState().byWorkspace[workspaceId]).toEqual([created]);
		const [call] = sendMessageCalls(h.calls);
		expect(call?.params.sessionId).toBe(created);
		expect(call?.params.text).toBe("Commit and push");
	});

	it("uses the newest open chat, or a new one when asked", async () => {
		seedWorkspace();
		const h = harness();
		const first = must(await h.service.create(workspaceId, sampleSession.config));
		now = 2000;
		const second = must(await h.service.create(workspaceId, sampleSession.config));

		must(await h.service.sendInstruction(workspaceId, "Open a PR"));
		expect(sendMessageCalls(h.calls)[0]?.params.sessionId).toBe(second.id);

		const fresh = must(
			await h.service.sendInstruction(workspaceId, "Fix errors", { newChat: true }),
		);
		expect(fresh).not.toBe(first.id);
		expect(fresh).not.toBe(second.id);
		expect(h.service.store.getState().byWorkspace[workspaceId]).toContain(fresh);
	});
});
