// @vitest-environment node
/**
 * @feature CHAT-05 Cancel a turn
 * Behaviour: sessions-and-chats.md "While the agent is working" (cancel), sessions.md 6,
 * services-map.md 2.3.3 and 2.3.4.
 * Test first: cancel pauses the app queue, takes the sidecar's dropped messages back into the
 * composer draft, and clears the pending send.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { type Interaction, idleLiveState } from "@conducted/protocol";
import { appError, err, ok, type SessionId } from "@conducted/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../../platform/platform.ts";
import { REPOS_SQL, repoToParams } from "../db/repos.ts";
import { createRepositories, type Repositories } from "../db/repositories.ts";
import { sampleRepo, sampleSession, sampleWorkspace, workspaceId } from "../db/test-fixtures.ts";
import { WORKSPACES_SQL, workspaceToParams } from "../db/workspaces.ts";
import { FollowUpQueue } from "./follow-up-queue.ts";
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
	queue: FollowUpQueue;
	composer: { loadDraft: ReturnType<typeof vi.fn>; saveDraft: ReturnType<typeof vi.fn> };
	calls: Call[];
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

const question: Interaction = {
	kind: "question",
	questions: [{ question: "Which branch?", options: [], multiSelect: false }],
};

const harness = (overrides: Partial<SessionsServiceDeps> = {}): Harness => {
	const calls: Call[] = [];
	let reply: (method: string, params: Record<string, unknown>) => Promise<unknown> = async () =>
		ok({});
	const settings: Record<string, unknown> = {
		default_message_send_mode: "steer",
		custom_prompt_general: "",
	};
	const composer = {
		materializeForSend: vi.fn(async () => ok(["/ws/.context/a.txt"])),
		clearDraft: vi.fn(async () => ok(undefined)),
		draftOf: vi.fn(() => ({ text: "", attachmentPaths: [] })),
		loadDraft: vi.fn(async () => ok({ text: "", attachmentPaths: [] })),
		saveDraft: vi.fn(),
	};
	const sidecar = {
		request: async (method: string, params: Record<string, unknown>) => {
			calls.push({ method, params });
			return reply(method, params);
		},
		notify: async () => ok(undefined),
	};
	const queue: FollowUpQueue = new FollowUpQueue({
		repos: repositories,
		deliver: async () => ok(undefined),
		liveStateOf: () => undefined,
		newId: () => `queue-${++nextId}`,
		now: () => now,
	});
	const deps = {
		db: new NodeDatabase(raw),
		repositories: () => repositories,
		sidecar,
		composer,
		queue,
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
		queue,
		composer,
		calls,
		replyTo: (next) => {
			reply = next;
		},
	};
};

const seedWorkspace = (): void => {
	raw.prepare(REPOS_SQL.insert).run(bind(repoToParams(sampleRepo)));
	raw.prepare(WORKSPACES_SQL.insert).run(bind(must(workspaceToParams(sampleWorkspace))));
};

const working = { ...idleLiveState, status: "working" as const };

const sendMessageCalls = (calls: readonly Call[]): Call[] =>
	calls.filter((call) => call.method === "sendMessage");

const cancelCalls = (calls: readonly Call[]): Call[] =>
	calls.filter((call) => call.method === "cancel");

const settle = async (): Promise<void> => {
	await Promise.resolve();
	await Promise.resolve();
};

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

describe("CHAT-05 cancel a turn", () => {
	it("cancels the agent, pauses the queue, closes the interaction and clears the pending send", async () => {
		seedWorkspace();
		const h = harness();
		const session = must(await h.service.create(workspaceId, sampleSession.config));
		await h.service.send(session.id, "Fix login", [], "auto");
		const sent = sendMessageCalls(h.calls)[0]?.params ?? {};
		h.service.store.setState({
			liveStates: { [session.id]: working },
			openInteractions: {
				[session.id]: {
					interactionId: "i1" as never,
					interaction: question,
					expiresAt: null,
					timedOut: false,
				},
			},
		});
		h.replyTo(async () => ok({ wasWorking: true, droppedMessageIds: [sent.messageId as never] }));

		const result = await h.service.cancel(session.id);

		expect(result).toEqual(ok(undefined));
		expect(cancelCalls(h.calls)).toEqual([{ method: "cancel", params: { sessionId: session.id } }]);
		const state = h.service.store.getState();
		expect(state.cancelling[session.id]).toBe(false);
		expect(state.openInteractions[session.id]).toBeUndefined();
		expect(state.sending[session.id]).toEqual([]);
		expect(h.queue.store.getState().pausedSessionIds[session.id]).toBe(true);
	});

	it("settles the open interaction as withdrawn when the turn is cancelled", async () => {
		seedWorkspace();
		const h = harness();
		const session = must(await h.service.create(workspaceId, sampleSession.config));
		const pending = h.service.requestInteraction({
			sessionId: session.id,
			interactionId: "i1" as never,
			interaction: question,
		});
		h.replyTo(async () => ok({ wasWorking: true, droppedMessageIds: [] }));

		const result = await h.service.cancel(session.id);

		expect(result).toEqual(ok(undefined));
		await expect(pending).resolves.toEqual({ kind: "withdrawn" });
		expect(h.service.store.getState().openInteractions[session.id]).toBeUndefined();
	});

	it("reports cancelling while the sidecar has not answered yet", async () => {
		seedWorkspace();
		const h = harness();
		const session = must(await h.service.create(workspaceId, sampleSession.config));
		let finish: ((value: unknown) => void) | undefined;
		h.replyTo(
			async () =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);

		const pending = h.service.cancel(session.id);
		await settle();
		expect(h.service.store.getState().cancelling[session.id]).toBe(true);

		finish?.(ok({ wasWorking: true, droppedMessageIds: [] }));
		await pending;
		expect(h.service.store.getState().cancelling[session.id]).toBe(false);
	});

	it("puts a message the sidecar dropped back into the composer draft with its attachments", async () => {
		seedWorkspace();
		const h = harness();
		const session = must(await h.service.create(workspaceId, sampleSession.config));
		await h.service.send(session.id, "Fix login", ["/draft/a.txt"], "auto");
		const sent = sendMessageCalls(h.calls)[0]?.params ?? {};
		h.composer.loadDraft.mockResolvedValue(
			ok({ text: "Keep this", attachmentPaths: ["/draft/b.txt"] }),
		);
		h.replyTo(async () => ok({ wasWorking: true, droppedMessageIds: [sent.messageId] }));

		const result = await h.service.cancel(session.id);

		expect(result).toEqual(ok(undefined));
		expect(h.composer.saveDraft).toHaveBeenCalledWith(session.id, {
			text: "Fix login\n\nKeep this",
			attachmentPaths: ["/draft/b.txt", "/ws/.context/a.txt"],
		});
		expect(h.service.store.getState().sending[session.id]).toEqual([]);
	});

	it("restores only the messages the sidecar dropped, not the turn that was already running", async () => {
		seedWorkspace();
		const h = harness();
		const session = must(await h.service.create(workspaceId, sampleSession.config));
		await h.service.send(session.id, "First", [], "auto");
		await h.service.send(session.id, "Second", [], "auto");
		const [first, second] = sendMessageCalls(h.calls);
		h.replyTo(async () => ok({ wasWorking: true, droppedMessageIds: [second?.params.messageId] }));

		await h.service.cancel(session.id);

		expect(h.composer.saveDraft).toHaveBeenCalledWith(session.id, {
			text: "Second",
			attachmentPaths: [],
		});
		expect(first?.params.messageId).not.toBe(second?.params.messageId);
		expect(h.service.store.getState().sending[session.id]?.map((entry) => entry.messageId)).toEqual(
			[first?.params.messageId],
		);
	});

	it("returns an in-flight message to the draft when its send finishes after the cancel", async () => {
		seedWorkspace();
		const h = harness();
		const session = must(await h.service.create(workspaceId, sampleSession.config));
		let finishSend: ((value: unknown) => void) | undefined;
		h.replyTo(async (method) => {
			if (method !== "sendMessage") return ok({ wasWorking: true, droppedMessageIds: [] });
			return new Promise((resolve) => {
				finishSend = resolve;
			});
		});

		const sending = h.service.send(session.id, "Fix login", [], "auto");
		await vi.waitFor(() => expect(sendMessageCalls(h.calls)).toHaveLength(1));
		const cancelled = await h.service.cancel(session.id);
		expect(cancelled).toEqual(ok(undefined));

		finishSend?.(ok({ deliveredAs: "new_turn" }));
		const result = await sending;

		expect(result).toMatchObject({ ok: false, error: { code: "cancelled" } });
		expect(h.composer.saveDraft).toHaveBeenCalledWith(session.id, {
			text: "Fix login",
			attachmentPaths: [],
		});
		const state = h.service.store.getState();
		expect(state.sending[session.id]).toEqual([]);
		expect(state.failedSends?.[session.id] ?? []).toEqual([]);
	});

	it("restores a dropped in-flight message to the draft once, not again when its send returns", async () => {
		seedWorkspace();
		const h = harness();
		const session = must(await h.service.create(workspaceId, sampleSession.config));
		let draft = { text: "other", attachmentPaths: [] as string[] };
		h.composer.loadDraft.mockImplementation(async () => ok(draft));
		h.composer.saveDraft.mockImplementation((_id: unknown, next: typeof draft) => {
			draft = next;
		});
		let finishSend: ((value: unknown) => void) | undefined;
		h.replyTo(async (method) => {
			if (method === "cancel") {
				const sent = sendMessageCalls(h.calls)[0]?.params.messageId;
				return ok({ wasWorking: true, droppedMessageIds: [sent] });
			}
			return new Promise((resolve) => {
				finishSend = resolve;
			});
		});

		const sending = h.service.send(session.id, "Fix login", [], "auto");
		await vi.waitFor(() => expect(sendMessageCalls(h.calls)).toHaveLength(1));
		expect(await h.service.cancel(session.id)).toEqual(ok(undefined));
		finishSend?.(ok({ deliveredAs: "new_turn" }));
		expect(await sending).toMatchObject({ ok: false, error: { code: "cancelled" } });

		expect(h.composer.saveDraft).toHaveBeenCalledTimes(1);
		expect(draft.text).toBe("Fix login\n\nother");
		expect(h.service.store.getState().sending[session.id]).toEqual([]);
	});

	it("does not pause the queue or lose the pending send when the sidecar refuses the cancel", async () => {
		seedWorkspace();
		const h = harness();
		const session = must(await h.service.create(workspaceId, sampleSession.config));
		await h.service.send(session.id, "Fix login", [], "auto");
		h.replyTo(async () => err(appError("cancel_failed", "The agent did not stop.")));

		const result = await h.service.cancel(session.id);

		expect(result).toMatchObject({ ok: false, error: { code: "cancel_failed" } });
		const state = h.service.store.getState();
		expect(state.cancelling[session.id]).toBe(false);
		expect(state.sending[session.id]).toHaveLength(1);
		expect(h.queue.store.getState().pausedSessionIds[session.id]).toBeUndefined();
		expect(h.composer.saveDraft).not.toHaveBeenCalled();
	});

	it("reports an unknown chat instead of cancelling the wrong one", async () => {
		const h = harness();

		const result = await h.service.cancel("missing" as SessionId);

		expect(result).toMatchObject({ ok: false, error: { code: "session_unknown" } });
		expect(cancelCalls(h.calls)).toEqual([]);
	});

	it("cancels every working chat of a workspace and leaves idle chats alone", async () => {
		seedWorkspace();
		const h = harness();
		const first = must(await h.service.create(workspaceId, sampleSession.config));
		const second = must(await h.service.create(workspaceId, sampleSession.config));
		const third = must(await h.service.create(workspaceId, sampleSession.config));
		h.service.store.setState({
			liveStates: {
				[first.id]: working,
				[second.id]: idleLiveState,
				[third.id]: working,
			},
		});
		h.replyTo(async () => ok({ wasWorking: true, droppedMessageIds: [] }));

		const result = await h.service.cancelAll(workspaceId);

		expect(result).toEqual(ok(undefined));
		expect(
			cancelCalls(h.calls)
				.map((call) => call.params.sessionId)
				.sort(),
		).toEqual([first.id, third.id].sort());
	});

	it("knows a workspace is working while a chat works or its cancel is pending", async () => {
		seedWorkspace();
		const h = harness();
		const session = must(await h.service.create(workspaceId, sampleSession.config));

		expect(h.service.hasWorkingChats(workspaceId)).toBe(false);
		h.service.store.setState({ liveStates: { [session.id]: working } });
		expect(h.service.hasWorkingChats(workspaceId)).toBe(true);
		h.service.store.setState({
			liveStates: { [session.id]: idleLiveState },
			cancelling: { [session.id]: true },
		});
		expect(h.service.hasWorkingChats(workspaceId)).toBe(true);
	});

	it("does not count a closed chat as working", async () => {
		seedWorkspace();
		const h = harness();
		const session = must(await h.service.create(workspaceId, sampleSession.config));
		h.service.store.setState({ liveStates: { [session.id]: working } });
		must(await h.service.close(session.id));

		expect(h.service.hasWorkingChats(workspaceId)).toBe(false);
	});
});
