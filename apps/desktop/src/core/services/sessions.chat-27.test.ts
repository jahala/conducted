// @vitest-environment node
/**
 * @feature CHAT-27 Visible auto-retry with Retry now
 * Behaviour: ui-map.md 3.3 ('Retry in new chat' starts a failed turn's message again in a new
 * chat of the same workspace).
 * Test first: retryInNewChat creates a chat with the failed chat's config and sends the failed
 * turn's message there, leaving the old chat open.
 */
import { err, ok, type TurnId } from "@conducted/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openTestDatabase, type TestDatabase } from "../../test/sqlite.ts";
import { createRepositories, type Repositories } from "../db/repositories.ts";
import {
	agentEvent,
	sampleRepo,
	sampleSession,
	sampleWorkspace,
	userMessageEvent,
} from "../db/test-fixtures.ts";
import { SessionsService, type SessionsServiceDeps } from "./sessions.ts";

const must = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

interface Call {
	method: string;
	params: Record<string, unknown>;
}

interface Harness {
	store: TestDatabase;
	repositories: Repositories;
	service: SessionsService;
	calls: Call[];
	failSend: (on: boolean) => void;
}

const workspace = {
	workspaceId: sampleWorkspace.id,
	workspaceName: sampleWorkspace.directoryName,
	workspacePath: sampleWorkspace.path,
	repoRootPath: sampleRepo.rootPath,
	targetBranch: sampleWorkspace.targetBranch,
	placeholderBranch: sampleWorkspace.branchIsPlaceholder,
	host: { kind: "local" as const },
	port: sampleWorkspace.port,
};

const opened: TestDatabase[] = [];

const harness = (): Harness => {
	const store = openTestDatabase();
	opened.push(store);
	let nextId = 0;
	const now = 1000;
	const deps = {
		clock: { now: () => now },
		ids: { uuid: () => `gen-${++nextId}` },
	};
	const repositories = createRepositories(store.database, deps);
	const calls: Call[] = [];
	let failSend = false;
	const settings: Record<string, unknown> = {
		default_message_send_mode: "steer",
		custom_prompt_general: "",
	};
	const service = new SessionsService({
		db: store.database,
		repositories: () => repositories,
		sidecar: {
			request: async (method: string, params: Record<string, unknown>) => {
				calls.push({ method, params });
				if (failSend && method === "sendMessage") {
					return err({ code: "sidecar_down", message: "The sidecar is not running." });
				}
				return ok({ deliveredAs: "new_turn" });
			},
			notify: async () => ok(undefined),
		},
		composer: {
			materializeForSend: vi.fn(async () => ok(["/ws/.context/login.png"])),
			clearDraft: vi.fn(async () => ok(undefined)),
			draftOf: vi.fn(() => ({ text: "", attachmentPaths: [] })),
			loadDraft: vi.fn(async () => ok({ text: "", attachmentPaths: [] })),
			saveDraft: vi.fn(),
		},
		queue: {
			enqueue: vi.fn(async () => ok({})),
			release: vi.fn(async () => ok(undefined)),
			pauseOnCancel: vi.fn(async () => ok(undefined)),
			store: { getState: () => ({ bySession: {}, pausedSessionIds: {} }) },
		},
		notifications: { onLiveStateChanged: vi.fn() },
		launchFor: async () => ok({ env: {}, providerKeys: {} }),
		workspaceContextOf: vi.fn(async () => ok(workspace)),
		defaultConfig: async () => ok(sampleSession.config),
		setting: <T>(key: string) => settings[key] as T,
		now: () => now,
		newId: () => `generated-${++nextId}`,
	} as unknown as SessionsServiceDeps);
	return {
		store,
		repositories,
		service,
		calls,
		failSend: (on) => {
			failSend = on;
		},
	};
};

const seedWorkspace = async (repositories: Repositories) => {
	const repo = must(
		await repositories.repos.create({
			name: sampleRepo.name,
			rootPath: sampleRepo.rootPath,
			remoteUrl: null,
			defaultBranch: sampleRepo.defaultBranch,
			icon: null,
		}),
	);
	const created = must(
		await repositories.workspaces.create({
			repoId: repo.id,
			directoryName: sampleWorkspace.directoryName,
			path: sampleWorkspace.path,
			branch: sampleWorkspace.branch,
			branchIsPlaceholder: sampleWorkspace.branchIsPlaceholder,
			host: { kind: "local" },
			targetBranch: sampleWorkspace.targetBranch,
			port: sampleWorkspace.port,
			linkedPaths: [],
			setupLogPath: null,
		}),
	);
	return created.id;
};

afterEach(() => {
	for (const store of opened.splice(0)) store.close();
});

const sendMessageCalls = (calls: readonly Call[]): Call[] =>
	calls.filter((call) => call.method === "sendMessage");

describe("CHAT-27 retry in a new chat", () => {
	it("starts a new chat with the failed chat's config and resends the turn's message", async () => {
		const h = harness();
		const workspaceId = await seedWorkspace(h.repositories);
		const failed = must(await h.service.create(workspaceId, sampleSession.config));
		const event = {
			...userMessageEvent("evt-1", "turn-1", 500),
			attachmentPaths: ["/draft/login.png"],
		};
		h.service.applyStoredEvent(failed.id, 0, event, 500);

		const retried = must(await h.service.retryInNewChat(failed.id, "turn-1" as TurnId));

		expect(retried.id).not.toBe(failed.id);
		expect(retried.workspaceId).toBe(workspaceId);
		expect(retried.config).toEqual(sampleSession.config);
		expect(sendMessageCalls(h.calls)).toHaveLength(1);
		expect(sendMessageCalls(h.calls)[0]?.params).toMatchObject({
			sessionId: retried.id,
			text: "Fix the login bug",
			attachmentPaths: ["/ws/.context/login.png"],
			delivery: "new_turn",
		});
		// The retry leaves the failed chat as it was; its stored message dated it (CHAT-26).
		expect(h.service.store.getState().sessions[failed.id]).toEqual({
			...failed,
			lastUserMessageAt: 500,
		});
		expect(h.service.store.getState().sessions[retried.id]).toEqual(retried);
	});

	it("refuses a turn the chat no longer holds", async () => {
		const h = harness();
		const workspaceId = await seedWorkspace(h.repositories);
		const chat = must(await h.service.create(workspaceId, sampleSession.config));

		const result = await h.service.retryInNewChat(chat.id, "missing-turn" as TurnId);

		expect(result).toMatchObject({ ok: false, error: { code: "chat_turn_unknown" } });
		expect(sendMessageCalls(h.calls)).toHaveLength(0);
	});

	it("refuses a turn the agent started by itself, which has no message to send", async () => {
		const h = harness();
		const workspaceId = await seedWorkspace(h.repositories);
		const chat = must(await h.service.create(workspaceId, sampleSession.config));
		h.service.applyStoredEvent(
			chat.id,
			0,
			agentEvent("evt-2", "turn-2", 600, [{ kind: "text", text: "I started this." }]),
			600,
		);
		const result = await h.service.retryInNewChat(chat.id, "turn-2" as TurnId);

		expect(result).toMatchObject({ ok: false, error: { code: "chat_turn_no_message" } });
		expect(sendMessageCalls(h.calls)).toHaveLength(0);
	});

	it("returns a failed send so the user learns the new chat is empty", async () => {
		const h = harness();
		const workspaceId = await seedWorkspace(h.repositories);
		const chat = must(await h.service.create(workspaceId, sampleSession.config));
		h.service.applyStoredEvent(chat.id, 0, userMessageEvent("evt-3", "turn-3", 700), 700);
		h.failSend(true);

		const result = await h.service.retryInNewChat(chat.id, "turn-3" as TurnId);

		expect(result).toMatchObject({ ok: false, error: { code: "sidecar_down" } });
	});
});
