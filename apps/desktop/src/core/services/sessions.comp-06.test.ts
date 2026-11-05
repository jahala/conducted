// @vitest-environment node
import type { SessionConfig, WorkspaceContext } from "@conducted/protocol";
import { appError, err, ok, type SessionId } from "@conducted/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../../platform/platform.ts";
import { memoryPlatformForShape } from "../../test/memory-platform.ts";
import { openTestDatabase, type TestDatabase } from "../../test/sqlite.ts";
import { createRepositories, type Repositories, type RepositoryDeps } from "../db/repositories.ts";
import type { Session } from "../model.ts";
import type { SidecarClient } from "../sidecar/tunnel.ts";
import { FollowUpQueue } from "./follow-up-queue.ts";
import { SessionsService, type SessionsServiceDeps } from "./sessions.ts";

const config: SessionConfig = {
	agent: "claude",
	model: "default",
	effort: "high",
	fastMode: false,
	planMode: false,
	requireToolApproval: false,
	additionalDirectories: [],
	appTools: { diffComments: true, progressUpdates: true, setTargetBranch: true },
};

interface Call {
	method: string;
	params: Record<string, unknown>;
}

let store: TestDatabase;
let repositories: Repositories;
let repositoryDeps: RepositoryDeps;
let nextId: number;
let workspace: WorkspaceContext;

const must = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

beforeEach(() => {
	store = openTestDatabase();
	nextId = 0;
	repositoryDeps = {
		clock: { now: () => 1000 },
		ids: { uuid: () => `id-${++nextId}` },
	};
	repositories = createRepositories(store.database, repositoryDeps);
	workspace = {
		workspaceId: "ws-1" as WorkspaceContext["workspaceId"],
		workspaceName: "oslo",
		workspacePath: "/code/workspaces/oslo",
		repoRootPath: "/code/conducted",
		targetBranch: "origin/main",
		placeholderBranch: true,
		port: 55_000,
	};
});

afterEach(() => {
	store.close();
});

async function seedChat(): Promise<Session> {
	const repo = must(
		await repositories.repos.create({
			name: "conducted",
			rootPath: "/code/conducted",
			remoteUrl: null,
			defaultBranch: "main",
			icon: null,
		}),
	);
	const created = must(
		await repositories.workspaces.create({
			repoId: repo.id,
			directoryName: "oslo",
			path: "/code/workspaces/oslo",
			branch: "jahala/oslo",
			branchIsPlaceholder: true,
			targetBranch: "origin/main",
			port: 55_000,
			linkedPaths: [],
			setupLogPath: null,
		}),
	);
	return must(
		await repositories.sessions.create({
			workspaceId: created.id,
			title: null,
			config,
		}),
	);
}

type Reply = (method: string, params: unknown) => Promise<unknown>;

interface Harness {
	service: SessionsService;
	calls: Call[];
	replyTo(reply: Reply): void;
}

function harness(overrides: Partial<SessionsServiceDeps> = {}): Harness {
	const calls: Call[] = [];
	let reply: Reply = async () => ok({});
	const queue = new FollowUpQueue({
		repos: repositories,
		deliver: async () => ok(undefined),
		liveStateOf: () => undefined,
	});
	const deps = {
		db: store.database,
		repositories: () => repositories,
		repositoriesOn: (db: Database) => createRepositories(db, repositoryDeps),
		sidecar: {
			request: (async (method: string, params: unknown) => {
				calls.push({ method, params: params as Record<string, unknown> });
				return reply(method, params);
			}) as SidecarClient["request"],
			notify: async () => ok(undefined),
		},
		composer: {
			materializeForSend: async () => ok([]),
			clearDraft: async () => ok(undefined),
			draftOf: () => ({ text: "", attachmentPaths: [] }),
			loadDraft: async () => ok({ text: "", attachmentPaths: [] }),
			saveDraft: () => {},
		},
		queue,
		notifications: { onLiveStateChanged: () => {} },
		launchFor: async () => ok({ env: {}, providerKeys: {} }),
		fs: memoryPlatformForShape().fs,
		workspaceContextOf: async () => ok(workspace),
		defaultConfig: async () => ok(config),
		setting: <T>(key: string): T => ({ custom_prompt_general: "" })[key] as T,
		now: () => 1000,
		newId: () => `generated-${++nextId}`,
		...overrides,
	} satisfies SessionsServiceDeps;
	return {
		service: new SessionsService(deps),
		calls,
		replyTo: (next) => {
			reply = next;
		},
	};
}

const chat = "chat-1" as SessionId;

describe("COMP-06 /restart restarts the agent session", () => {
	it("resets the agent, then warms it again with the chat's history", async () => {
		const session = await seedChat();
		const h = harness();
		must(await h.service.setAgentSessionId(session.id, "agent-abc"));

		const result = await h.service.restartAgent(session.id);

		expect(result).toEqual(ok(undefined));
		expect(h.calls.map((call) => call.method)).toEqual(["resetAgent", "warmAgent"]);
		expect(h.calls[0]?.params).toEqual({ sessionId: session.id });
		expect(h.calls[1]?.params).toMatchObject({
			sessionId: session.id,
			config,
			workspace,
			launch: { env: {}, providerKeys: {} },
			resume: { agentSessionId: "agent-abc" },
		});
		expect(h.service.store.getState().liveStates[session.id]?.status).toBe("idle");
	});

	it("starts a chat with no history without a resume", async () => {
		const session = await seedChat();
		const h = harness();

		expect(await h.service.restartAgent(session.id)).toEqual(ok(undefined));

		expect(h.calls[1]?.params.resume).toBeUndefined();
	});

	it("does not warm the agent when the reset fails", async () => {
		const session = await seedChat();
		const h = harness();
		const failure = appError("sidecar_down", "The sidecar is not running.");
		h.replyTo(async () => err(failure));

		expect(await h.service.restartAgent(session.id)).toEqual(err(failure));
		expect(h.calls.map((call) => call.method)).toEqual(["resetAgent"]);
	});

	it("refuses to restart a chat with no launch settings", async () => {
		const session = await seedChat();
		const h = harness({ launchFor: undefined });

		const result = await h.service.restartAgent(session.id);

		expect(result).toMatchObject({ ok: false, error: { code: "chat_launch_missing" } });
		expect(h.calls).toHaveLength(0);
	});

	it("returns an error for an unknown chat", async () => {
		const h = harness();

		const result = await h.service.restartAgent(chat);

		expect(result).toMatchObject({ ok: false, error: { code: "session_unknown" } });
		expect(h.calls).toHaveLength(0);
	});
});
