// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { idleLiveState, type SessionEvent } from "@conducted/protocol";
import { appError, err, type MessageId, ok } from "@conducted/shared";
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
	host: { kind: "local" as const },
	port: sampleWorkspace.port,
};

const harness = (overrides: Partial<SessionsServiceDeps> = {}): Harness => {
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
		launchFor: async () => ok({ env: {}, providerKeys: {} }),
		workspaceContextOf: vi.fn(async () => ok(workspace)),
		defaultConfig: async () => ok(sampleSession.config),
		setting: <T>(key: string) => settings[key] as T,
		now: () => now,
		newId: () => `generated-${++nextId}`,
		...overrides,
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
	it("holds the message in memory before the sidecar gets it and carries the query options", async () => {
		seedWorkspace();
		const h = harness();
		h.settings.custom_prompt_general = "Be brief. Show the diff before editing.";
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
			config: {
				...session.config,
				additionalDirectories: sampleWorkspace.linkedPaths,
				appTools: { ...session.config.appTools, localExecution: false },
			},
			workspace: { ...workspace, userPreferences: "Be brief. Show the diff before editing." },
		});
		expect(params.launch).toEqual({ env: {}, providerKeys: {} });
		expect(params.resume).toBeUndefined();
	});

	it("fails clearly instead of inventing a launch when the composition root gave none", async () => {
		seedWorkspace();
		const h = harness({ launchFor: undefined });
		const session = must(await h.service.create(workspaceId, sampleSession.config));

		const result = await h.service.send(session.id, "Fix login", [], "auto");

		expect(result).toMatchObject({ ok: false, error: { code: "chat_launch_missing" } });
		expect(sendMessageCalls(h.calls)).toHaveLength(0);
		expect(h.service.store.getState().sending[session.id] ?? []).toEqual([]);
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

	it("clears the pending message when the turn completes", async () => {
		seedWorkspace();
		const h = harness();
		const session = must(await h.service.create(workspaceId, sampleSession.config));

		await h.service.send(session.id, "First", [], "auto");
		const sent = sendMessageCalls(h.calls)[0]?.params ?? {};
		h.service.applyStoredEvent(
			session.id,
			0,
			{
				type: "turn_ended",
				eventId: "e-done",
				at: 1500,
				turnId: sent.turnId,
				outcome: "success",
			} as unknown as SessionEvent,
			1500,
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

describe("CHAT-03 steering through the send path", () => {
	it("sends a queued row under the row's own id, so startup repair can match it", async () => {
		seedWorkspace();
		const h = harness();
		const session = must(await h.service.create(workspaceId, sampleSession.config));
		h.service.store.setState({
			liveStates: {
				[session.id]: { ...idleLiveState, status: "working" },
			},
		});

		const sent = await h.service.send(session.id, "Steer", [], "steer", "queued-7" as MessageId);

		expect(sent).toEqual(ok(undefined));
		const [call] = sendMessageCalls(h.calls);
		expect(call?.params.messageId).toBe("queued-7");
		expect(call?.params.delivery).toBe("steer");
	});

	it("materialises the attachments the message carries, not the draft's", async () => {
		seedWorkspace();
		const h = harness();
		const session = must(await h.service.create(workspaceId, sampleSession.config));

		await h.service.send(session.id, "Queued", ["/draft/a.txt"], "auto", "queued-7" as MessageId);

		expect(h.composer.materializeForSend).toHaveBeenCalledWith(
			session.id,
			workspace.workspacePath,
			"queued-7",
			["/draft/a.txt"],
		);
	});

	it("refuses a steer asked for by name when the agent cannot steer, and queues nothing", async () => {
		seedWorkspace();
		const h = harness();
		const session = must(
			await h.service.create(workspaceId, {
				...sampleSession.config,
				agent: "acp",
				acpAgent: "opencode",
			}),
		);
		h.service.store.setState({
			liveStates: {
				[session.id]: { ...idleLiveState, status: "working" },
			},
		});

		const sent = await h.service.send(session.id, "Steer", [], "steer");

		expect(sent.ok).toBe(false);
		if (sent.ok) return;
		expect(sent.error.code).toBe("steer_unsupported");
		expect(h.queue.enqueue).not.toHaveBeenCalled();
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

	it("does not put the text in twice when the composer kept it after the failure", async () => {
		seedWorkspace();
		const h = harness();
		const session = must(await h.service.create(workspaceId, sampleSession.config));
		h.replyTo(async () => err(appError("send_failed", "The agent did not answer.")));
		await h.service.send(session.id, "Fix login", [], "auto");
		const failed = h.service.store.getState().failedSends?.[session.id] ?? [];
		h.composer.loadDraft.mockResolvedValue(ok({ text: "Fix login", attachmentPaths: [] }));

		const result = await h.service.discardFailedSend(session.id, failed[0]?.messageId as never);

		expect(result).toEqual(ok(undefined));
		expect(h.composer.saveDraft).toHaveBeenCalledWith(session.id, {
			text: "Fix login",
			attachmentPaths: [],
		});
	});

	it("restores the failed message's attachments when the draft is empty", async () => {
		seedWorkspace();
		const h = harness();
		const session = must(await h.service.create(workspaceId, sampleSession.config));
		h.replyTo(async () => err(appError("send_failed", "The agent did not answer.")));
		await h.service.send(session.id, "Fix login", ["/draft/a.txt"], "auto");
		const failed = h.service.store.getState().failedSends?.[session.id] ?? [];
		h.composer.loadDraft.mockResolvedValue(ok({ text: "", attachmentPaths: [] }));

		await h.service.discardFailedSend(session.id, failed[0]?.messageId as never);

		expect(h.composer.saveDraft).toHaveBeenCalledWith(session.id, {
			text: "Fix login",
			attachmentPaths: ["/ws/.context/a.txt"],
		});
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

	it("writes even when the stored JSON has another key order and whitespace", async () => {
		seedWorkspace();
		const h = harness();
		const session = must(await h.service.create(workspaceId, sampleSession.config));
		const reordered = JSON.stringify(
			{
				appTools: sampleSession.config.appTools,
				additionalDirectories: sampleSession.config.additionalDirectories,
				requireToolApproval: sampleSession.config.requireToolApproval,
				planMode: sampleSession.config.planMode,
				fastMode: sampleSession.config.fastMode,
				effort: sampleSession.config.effort,
				model: sampleSession.config.model,
				agent: sampleSession.config.agent,
			},
			null,
			2,
		);
		raw.prepare("UPDATE sessions SET config = ? WHERE id = ?").run(reordered, session.id);

		const result = await h.service.updateConfig(session.id, {
			...sampleSession.config,
			model: "haiku",
		});

		expect(result).toEqual(ok(undefined));
		expect(must(await repositories.sessions.get(session.id))?.config.model).toBe("haiku");
		expect(h.service.store.getState().sessions[session.id]?.config.model).toBe("haiku");
	});

	it("sends the chat's newest config with the message", async () => {
		seedWorkspace();
		const h = harness();
		const session = must(await h.service.create(workspaceId, sampleSession.config));
		must(await h.service.updateConfig(session.id, { ...sampleSession.config, model: "haiku" }));

		await h.service.send(session.id, "Fix login", [], "auto");

		expect(sendMessageCalls(h.calls)[0]?.params.config).toMatchObject({ model: "haiku" });
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
		expect(call?.params).toEqual({
			sessionId: session.id,
			config: {
				...next,
				additionalDirectories: sampleWorkspace.linkedPaths,
				appTools: { ...next.appTools, localExecution: false },
			},
		});
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

describe("CHAT-02 retry keeps a message the sidecar was never asked about", () => {
	it("keeps the failed row when the retry fails before the sidecar is reached", async () => {
		seedWorkspace();
		let contextFails = false;
		const h = harness({
			workspaceContextOf: async () =>
				contextFails ? err(appError("workspace_gone", "The workspace is gone.")) : ok(workspace),
		});
		const session = must(await h.service.create(workspaceId, sampleSession.config));
		h.replyTo(async () => err(appError("send_failed", "The agent did not answer.")));
		await h.service.send(session.id, "Fix login", [], "auto");
		const failed = h.service.store.getState().failedSends?.[session.id] ?? [];
		expect(failed).toHaveLength(1);

		contextFails = true;
		const retried = await h.service.retryFailedSend(session.id, failed[0]?.messageId as never);

		expect(retried).toMatchObject({ ok: false, error: { code: "workspace_gone" } });
		const after = h.service.store.getState().failedSends?.[session.id] ?? [];
		expect(after).toHaveLength(1);
		expect(after[0]).toMatchObject({
			messageId: failed[0]?.messageId,
			text: "Fix login",
			error: { code: "workspace_gone" },
		});
		expect(sendMessageCalls(h.calls)).toHaveLength(1);
	});
});

describe("SIDE-20 a config the agent changed is stored", () => {
	it("keeps the newest config when two changes overlap", async () => {
		seedWorkspace();
		const h = harness();
		const session = must(await h.service.create(workspaceId, sampleSession.config));
		const entered = { ...sampleSession.config, planMode: true };
		const left = { ...sampleSession.config, planMode: false };
		const original = repositories.sessions.setConfig.bind(repositories.sessions);
		let releaseFirst: () => void = () => {};
		const firstGate = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		let writes = 0;
		vi.spyOn(repositories.sessions, "setConfig").mockImplementation(async (id, config) => {
			writes += 1;
			if (writes === 1) await firstGate;
			return original(id, config);
		});

		const first = h.service.applyAgentConfig(session.id, entered);
		const second = h.service.applyAgentConfig(session.id, left);
		releaseFirst();
		const results = await Promise.all([first, second]);

		expect(results).toEqual([ok(undefined), ok(undefined)]);
		expect(must(await repositories.sessions.get(session.id))?.config.planMode).toBe(false);
		expect(h.service.store.getState().sessions[session.id]?.config.planMode).toBe(false);
	});

	it("retries a failed config write through the same writer", async () => {
		seedWorkspace();
		const h = harness();
		const session = must(await h.service.create(workspaceId, sampleSession.config));
		const original = repositories.sessions.setConfig.bind(repositories.sessions);
		let calls = 0;
		vi.spyOn(repositories.sessions, "setConfig").mockImplementation(async (id, config) => {
			calls += 1;
			if (calls === 1) return err(appError("db.failed", "The database is busy."));
			return original(id, config);
		});
		const entered = { ...sampleSession.config, planMode: true };

		expect(await h.service.applyAgentConfig(session.id, entered)).toEqual(ok(undefined));

		expect(calls).toBe(2);
		expect(must(await repositories.sessions.get(session.id))?.config.planMode).toBe(true);
	});

	it("keeps a composer change when an older agent notification writes during it", async () => {
		seedWorkspace();
		const h = harness();
		const session = must(await h.service.create(workspaceId, sampleSession.config));
		const entered = { ...sampleSession.config, planMode: true };
		const original = repositories.sessions.setConfig.bind(repositories.sessions);
		let release: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let writes = 0;
		vi.spyOn(repositories.sessions, "setConfig").mockImplementation(async (id, config) => {
			writes += 1;
			if (writes === 1) await gate;
			return original(id, config);
		});

		const olderAgentNotification = h.service.applyAgentConfig(session.id, entered);
		const composer = h.service.updateConfig(session.id, {
			...sampleSession.config,
			model: "opus",
		});
		release();
		const results = await Promise.all([olderAgentNotification, composer]);

		expect(results).toEqual([ok(undefined), ok(undefined)]);
		const stored = must(await repositories.sessions.get(session.id));
		expect(stored?.config.planMode).toBe(false);
		expect(stored?.config.model).toBe("opus");
	});

	it("sends the next message with the config the agent chose", async () => {
		seedWorkspace();
		const h = harness();
		const session = must(await h.service.create(workspaceId, sampleSession.config));
		const entered = { ...sampleSession.config, planMode: true };
		must(await h.service.applyAgentConfig(session.id, entered));

		must(await h.service.send(session.id, "next", [], "auto"));

		const [call] = sendMessageCalls(h.calls);
		expect(call?.params.config).toEqual({
			...entered,
			additionalDirectories: sampleWorkspace.linkedPaths,
			appTools: { ...entered.appTools, localExecution: false },
		});
	});
});
