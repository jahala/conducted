// @vitest-environment node
/**
 * @feature CHAT-16 Fork a chat from a turn
 * Tests the fork service: the chat up to a checkpointed turn is copied into a new chat with its
 * checkpoints under the fork's own ids, a turn with no checkpoint is refused, a fork with no agent
 * message to resume at is refused, and the first send of the fork resumes the agent at the turn's
 * last message with a forked session.
 * Test first: forking at a turn copies that turn and the turns before it, and leaves the later
 * turns behind.
 */
import type { WorkspaceContext } from "@conducted/protocol";
import type { CheckpointId, EventId, SessionId, TurnId, WorkspaceId } from "@conducted/shared";
import { appError, err, ok, type Result } from "@conducted/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createStore } from "zustand/vanilla";

import { openTestDatabase } from "../../test/sqlite.ts";
import { createRepositories, type Repositories } from "../db/repositories.ts";
import {
	agentEvent,
	sampleQueued,
	sampleSession,
	turnEndedEvent,
	userMessageEvent,
} from "../db/test-fixtures.ts";
import { turnCheckpointId } from "../git/refs.ts";
import type { FollowUpQueueState } from "./follow-up-queue.ts";
import { SessionsService, type SessionsServiceDeps } from "./sessions.ts";

interface Call {
	method: string;
	params: Record<string, unknown>;
}

const workspaceContext: WorkspaceContext = {
	workspaceId: "ws-1" as WorkspaceId,
	workspaceName: "workspace",
	workspacePath: "/code/workspace",
	repoRootPath: "/code/project",
	targetBranch: "origin/main",
	placeholderBranch: true,
	port: 55_000,
};

let store: ReturnType<typeof openTestDatabase>;
let repositories: Repositories;
let nextId = 0;

const checkpointEvent = (
	id: string,
	turn: string,
	at: number,
	phase: "start" | "end",
	checkpointId: string,
) => ({
	type: "checkpoint" as const,
	eventId: id as EventId,
	at,
	turnId: turn as TurnId,
	phase,
	checkpointId: checkpointId as CheckpointId,
});

const agentWithNativeId = (id: string, turn: string, at: number, nativeId: string) => {
	const event = agentEvent(id, turn, at, [{ kind: "text", text: `answer ${nativeId}` }]);
	if (event.type !== "agent") throw new Error("the fixture is an agent event");
	return { ...event, message: { ...event.message, nativeId } };
};

interface Harness {
	service: SessionsService;
	calls: Call[];
	/** The checkpoint id pairs the fork asked the composition root to copy, in order. */
	copiedCheckpoints: (readonly [string, string])[];
	replyTo: (next: (method: string) => Promise<Result<unknown>>) => void;
}

const harness = (overrides: Partial<SessionsServiceDeps> = {}): Harness => {
	const calls: Call[] = [];
	const copiedCheckpoints: (readonly [string, string])[] = [];
	let reply: (method: string) => Promise<Result<unknown>> = async () =>
		ok({ deliveredAs: "new_turn" });
	const deps: SessionsServiceDeps = {
		db: store.database,
		repositories: () => repositories,
		repositoriesOn: () => repositories,
		fs: {
			exists: async () => true,
			trash: async () => ok(undefined),
		},
		sidecar: {
			request: (async (method: string, params: Record<string, unknown>) => {
				calls.push({ method, params });
				return reply(method);
			}) as SessionsServiceDeps["sidecar"]["request"],
			notify: async () => ok(undefined),
		},
		composer: {
			materializeForSend: async () => ok([]),
			clearDraft: async () => ok(undefined),
			draftOf: () => ({ text: "", attachmentPaths: [] }),
			loadDraft: async () => ok({ text: "", attachmentPaths: [] }),
			saveDraft: () => {},
		},
		queue: {
			enqueue: async () => ok(sampleQueued),
			release: async () => ok(undefined),
			pauseOnCancel: async () => ok(undefined),
			store: createStore<FollowUpQueueState>(() => ({
				bySession: {},
				pausedSessionIds: {},
			})),
		},
		notifications: { onLiveStateChanged: () => {} },
		launchFor: async () => ok({ env: {}, providerKeys: {} }),
		copyCheckpoints: async (_workspaceId, pairs) => {
			copiedCheckpoints.push(...pairs);
			return ok(pairs.length);
		},
		workspaceContextOf: async () => ok(workspaceContext),
		defaultConfig: async () => ok(sampleSession.config),
		setting: <T>(key: string) => (key === "default_message_send_mode" ? "steer" : "") as T,
		now: () => 1000,
		newId: () => `generated-${++nextId}`,
		...overrides,
	};
	return {
		service: new SessionsService(deps),
		calls,
		copiedCheckpoints,
		replyTo: (next) => {
			reply = next;
		},
	};
};

beforeEach(() => {
	store = openTestDatabase();
	nextId = 0;
	repositories = createRepositories(store.database, {
		clock: { now: () => 1000 },
		ids: { uuid: () => `repo-${++nextId}` },
	});
});

afterEach(() => {
	store.close();
});

async function seedChat(): Promise<{ workspaceId: WorkspaceId }> {
	const repo = await repositories.repos.create({
		name: "project",
		rootPath: "/code/project",
		remoteUrl: null,
		defaultBranch: "main",
		icon: null,
	});
	if (!repo.ok) throw new Error(JSON.stringify(repo.error));
	const workspace = await repositories.workspaces.create({
		repoId: repo.value.id,
		directoryName: "workspace",
		path: "/code/workspace",
		branch: "jahala/workspace",
		branchIsPlaceholder: true,
		targetBranch: "origin/main",
		port: 55_000,
		linkedPaths: [],
		setupLogPath: null,
	});
	if (!workspace.ok) throw new Error(JSON.stringify(workspace.error));
	return { workspaceId: workspace.value.id };
}

const append = async (
	sessionId: SessionId,
	event: Parameters<Repositories["sessionEvents"]["append"]>[1],
) => {
	const appended = await repositories.sessionEvents.append(sessionId, event, event.at);
	if (!appended.ok) throw new Error(JSON.stringify(appended.error));
};

describe("CHAT-16 fork a chat from a turn", () => {
	it("copies the chosen turn and the turns before it into a new chat of the same workspace", async () => {
		const { workspaceId } = await seedChat();
		const h = harness();
		const created = await h.service.create(workspaceId, sampleSession.config);
		if (!created.ok) throw new Error(JSON.stringify(created.error));
		const originId = created.value.id;
		await h.service.rename(originId, "Fix the login bug");
		const saved = await h.service.setAgentSessionId(originId, "agent-session-1");
		expect(saved.ok).toBe(true);
		await append(originId, userMessageEvent("u1", "t1", 10));
		await append(originId, checkpointEvent("c1", "t1", 11, "start", "start-1"));
		await append(originId, agentWithNativeId("a1", "t1", 12, "native-1"));
		await append(originId, checkpointEvent("c2", "t1", 13, "end", "end-1"));
		await append(originId, turnEndedEvent("e1", "t1", 14));
		await append(originId, userMessageEvent("u2", "t2", 20));
		await append(originId, checkpointEvent("c3", "t2", 21, "start", "start-2"));
		await append(originId, agentWithNativeId("a2", "t2", 22, "native-2"));
		await append(originId, checkpointEvent("c4", "t2", 23, "end", "end-2"));
		await append(originId, turnEndedEvent("e2", "t2", 24));

		const forked = await h.service.forkFrom(originId, "t1" as TurnId);

		expect(forked.ok).toBe(true);
		if (!forked.ok) return;
		expect(forked.value.id).not.toBe(originId);
		expect(forked.value.workspaceId).toBe(workspaceId);
		expect(forked.value.title).toBe("Fix the login bug");
		expect(forked.value.config).toEqual(sampleSession.config);
		expect(forked.value.agentSessionId).toBe("agent-session-1");
		expect(h.service.store.getState().byWorkspace[workspaceId]).toContain(forked.value.id);

		const copied = await repositories.sessionEvents.listFrom(forked.value.id, 0, 100);
		expect(copied.ok).toBe(true);
		if (!copied.ok) return;
		expect(copied.value.map((row) => row.event.eventId)).toEqual(["u1", "c1", "a1", "c2", "e1"]);
		expect(copied.value.map((row) => row.event.turnId)).toEqual(["t1", "t1", "t1", "t1", "t1"]);
		// The copied checkpoints name the fork's own refs, and only the kept turn's refs are copied.
		const ownStart = turnCheckpointId(forked.value.id, "t1", "start");
		const ownEnd = turnCheckpointId(forked.value.id, "t1", "end");
		expect(
			copied.value.flatMap((row) =>
				row.event.type === "checkpoint" ? [row.event.checkpointId] : [],
			),
		).toEqual([ownStart, ownEnd]);
		expect(h.copiedCheckpoints).toEqual([
			["start-1", ownStart],
			["end-1", ownEnd],
		]);

		const origin = await repositories.sessionEvents.listFrom(originId, 0, 100);
		expect(origin.ok).toBe(true);
		if (!origin.ok) return;
		expect(origin.value).toHaveLength(10);
	});

	it("refuses a turn with no checkpoint and creates no chat", async () => {
		const { workspaceId } = await seedChat();
		const h = harness();
		const created = await h.service.create(workspaceId, sampleSession.config);
		if (!created.ok) throw new Error(JSON.stringify(created.error));
		const originId = created.value.id;
		await append(originId, userMessageEvent("u1", "t1", 10));
		await append(originId, agentWithNativeId("a1", "t1", 11, "native-1"));
		await append(originId, turnEndedEvent("e1", "t1", 12));

		const forked = await h.service.forkFrom(originId, "t1" as TurnId);

		expect(forked.ok).toBe(false);
		if (forked.ok) return;
		expect(forked.error).toMatchObject({
			code: "chat_fork_no_checkpoint",
			message: "Checkpoint not found for this turn.",
		});
		expect(h.service.store.getState().byWorkspace[workspaceId]).toEqual([originId]);
		const origin = await repositories.sessionEvents.listFrom(originId, 0, 100);
		expect(origin.ok).toBe(true);
		if (!origin.ok) return;
		expect(origin.value).toHaveLength(3);
	});

	it("resumes the agent at the chosen turn's last message on the fork's first send", async () => {
		const { workspaceId } = await seedChat();
		const h = harness();
		const created = await h.service.create(workspaceId, sampleSession.config);
		if (!created.ok) throw new Error(JSON.stringify(created.error));
		const originId = created.value.id;
		await h.service.setAgentSessionId(originId, "agent-session-1");
		await append(originId, userMessageEvent("u1", "t1", 10));
		await append(originId, checkpointEvent("c1", "t1", 11, "start", "start-1"));
		await append(originId, agentWithNativeId("a1", "t1", 12, "native-1"));
		await append(originId, checkpointEvent("c2", "t1", 13, "end", "end-1"));
		await append(originId, turnEndedEvent("e1", "t1", 14));

		const forked = await h.service.forkFrom(originId, "t1" as TurnId);
		if (!forked.ok) throw new Error(JSON.stringify(forked.error));

		h.replyTo(async () => ok({ deliveredAs: "new_turn" }));
		const sent = await h.service.send(forked.value.id, "Carry on", [], "auto");

		expect(sent).toEqual(ok(undefined));
		const call = h.calls.find((entry) => entry.method === "sendMessage");
		expect(call?.params).toMatchObject({
			sessionId: forked.value.id,
			text: "Carry on",
			firstMessage: false,
			resume: { agentSessionId: "agent-session-1", atNativeMessageId: "native-1" },
		});
	});

	it("refuses a fork with no agent message to resume at, so two chats never share a session", async () => {
		const { workspaceId } = await seedChat();
		const h = harness();
		const created = await h.service.create(workspaceId, sampleSession.config);
		if (!created.ok) throw new Error(JSON.stringify(created.error));
		const originId = created.value.id;
		await h.service.setAgentSessionId(originId, "agent-session-1");
		// The turn has its start checkpoint but no answer yet.
		await append(originId, userMessageEvent("u1", "t1", 10));
		await append(originId, checkpointEvent("c1", "t1", 11, "start", "start-1"));

		const forked = await h.service.forkFrom(originId, "t1" as TurnId);

		expect(forked.ok).toBe(false);
		if (forked.ok) return;
		expect(forked.error.code).toBe("chat_fork_no_agent_message");
		expect(forked.error.message).toBe(
			"Unable to fork chat: the agent has no message to fork from in this turn or before it.",
		);
		expect(h.service.store.getState().byWorkspace[workspaceId]).toEqual([originId]);
		expect(h.copiedCheckpoints).toEqual([]);
	});

	it("removes the new chat when its checkpoints cannot be copied", async () => {
		const { workspaceId } = await seedChat();
		const h = harness({
			copyCheckpoints: async () => err(appError("git_failed", "fatal: cannot lock ref")),
		});
		const created = await h.service.create(workspaceId, sampleSession.config);
		if (!created.ok) throw new Error(JSON.stringify(created.error));
		const originId = created.value.id;
		await append(originId, userMessageEvent("u1", "t1", 10));
		await append(originId, checkpointEvent("c1", "t1", 11, "start", "start-1"));
		await append(originId, turnEndedEvent("e1", "t1", 12));

		const forked = await h.service.forkFrom(originId, "t1" as TurnId);

		expect(forked).toEqual(err(appError("git_failed", "fatal: cannot lock ref")));
		expect(h.service.store.getState().byWorkspace[workspaceId]).toEqual([originId]);
		const sessions = await repositories.sessions.listByWorkspace(workspaceId, {
			includeClosed: true,
		});
		expect(sessions.ok && sessions.value.map((session) => session.id)).toEqual([originId]);
	});

	it("returns a clear failure when the picked turn is no longer in the log", async () => {
		const { workspaceId } = await seedChat();
		const h = harness();
		const created = await h.service.create(workspaceId, sampleSession.config);
		if (!created.ok) throw new Error(JSON.stringify(created.error));

		const forked = await h.service.forkFrom(created.value.id, "missing" as TurnId);

		expect(forked.ok).toBe(false);
		if (forked.ok) return;
		expect(forked.error.code).toBe("chat_fork_turn_unknown");
		expect(forked.error.message).toBe("Unable to fork chat: that turn is no longer here.");
	});
});
