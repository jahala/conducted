// @vitest-environment node
/**
 * @feature AGENT-14 Codex `/compact`
 * Owns: tests for SessionsService.compact: warming the Codex agent, then sending the sidecar's
 * compact request and reporting its answer.
 * Behaviour: research/conductor/other-runners.md section 2.1.
 * Test first: compact warms the chat and asks the sidecar to compact it.
 */
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
	agent: "codex",
	model: "gpt-5",
	effort: "medium",
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
		host: { kind: "local" },
		port: 55_000,
	};
});

afterEach(() => {
	store.close();
});

async function seedChat(overrides: Partial<SessionConfig> = {}): Promise<Session> {
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
			remoteFileSyncEnabled: false,
			host: { kind: "local" },
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
			config: { ...config, ...overrides },
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
		newId: () => `queue-${++nextId}`,
		now: () => 1000,
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

describe("AGENT-14 /compact on a Codex chat", () => {
	it("warms the agent and asks the sidecar to compact the thread", async () => {
		const session = await seedChat();
		const h = harness();
		h.replyTo(async (method) => (method === "compact" ? ok({ started: true }) : ok({})));

		const result = await h.service.compact(session.id);

		expect(result).toEqual(ok(undefined));
		expect(h.calls.map((call) => call.method)).toEqual(["warmAgent", "compact"]);
		expect(h.calls[1]?.params).toEqual({ sessionId: session.id });
	});

	it("says the chat could not start when the sidecar answers started false", async () => {
		const session = await seedChat();
		const h = harness();
		h.replyTo(async (method) => (method === "compact" ? ok({ started: false }) : ok({})));

		const result = await h.service.compact(session.id);

		expect(result).toMatchObject({ ok: false, error: { code: "compact_not_started" } });
	});

	it("returns a sidecar failure unchanged", async () => {
		const session = await seedChat();
		const h = harness();
		const failure = appError("sidecar_down", "The sidecar is not running.");
		h.replyTo(async (method) => (method === "compact" ? err(failure) : ok({})));

		expect(await h.service.compact(session.id)).toEqual(err(failure));
	});

	it("refuses an agent without a compact call", async () => {
		const session = await seedChat({ agent: "claude" });
		const h = harness();

		const result = await h.service.compact(session.id);

		expect(result).toMatchObject({ ok: false, error: { code: "compact_unsupported" } });
		expect(h.calls).toHaveLength(0);
	});

	it("returns an error for an unknown chat", async () => {
		const h = harness();

		const result = await h.service.compact(chat);

		expect(result).toMatchObject({ ok: false, error: { code: "session_unknown" } });
		expect(h.calls).toHaveLength(0);
	});
});
