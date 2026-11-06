// @vitest-environment node
/**
 * @feature COMP-10 Codex goal bar and `/goal`
 * Owns: tests for the goal calls of SessionsService: save, pause, resume and clear, the two
 * refusals, loading the chat's goal, and a `goalChanged` notification.
 * Behaviour: ui-map.md 3.5 and 5.4, other-runners.md 2.1.
 * Test first: Save with empty text returns "Enter a goal first." and sends nothing.
 */
import type { CodexGoal, SessionConfig, WorkspaceContext } from "@conducted/protocol";
import { appError, err, ok, type Result, type SessionId } from "@conducted/shared";
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
	appTools: { diffComments: false, progressUpdates: false, setTargetBranch: false },
};

const activeGoal: CodexGoal = { objective: "Ship the importer", status: "active" };
const pausedGoal: CodexGoal = { objective: "Ship the importer", status: "paused" };

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

type Reply = (method: string, params: unknown) => Promise<Result<unknown>>;

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

async function until(check: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		if (check()) return;
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	throw new Error("The expected number of sidecar calls never arrived.");
}

describe("COMP-10 Codex goal calls", () => {
	it("saves a non-empty objective and shows the goal the sidecar returns", async () => {
		const session = await seedChat();
		const h = harness();
		h.replyTo(async (method) => (method === "setGoal" ? ok({ goal: activeGoal }) : ok({})));

		const result = await h.service.setGoal(session.id, "  Ship the importer  ");

		expect(result).toEqual(ok(undefined));
		expect(h.calls).toEqual([
			{ method: "setGoal", params: { sessionId: session.id, objective: "Ship the importer" } },
		]);
		expect(h.service.chatView(session.id)?.goal).toEqual(activeGoal);
	});

	it("refuses empty text with 'Enter a goal first.' and sends nothing", async () => {
		const session = await seedChat();
		const h = harness();

		const result = await h.service.setGoal(session.id, "   ");

		expect(result).toMatchObject({
			ok: false,
			error: { code: "goal_empty", message: "Enter a goal first." },
		});
		expect(h.calls).toHaveLength(0);
	});

	it("refuses a chat that cannot do goals with the Conductor message", async () => {
		const session = await seedChat({ agent: "claude" });
		const h = harness();

		const result = await h.service.setGoal(session.id, "Ship it");

		expect(result).toMatchObject({
			ok: false,
			error: {
				code: "goal_unavailable",
				message: "Codex goals are not available in this chat.",
			},
		});
		expect(h.calls).toHaveLength(0);
	});

	it("pauses, resumes and clears the goal through the sidecar", async () => {
		const session = await seedChat();
		const h = harness();
		h.replyTo(async (method, params) => {
			if (method !== "changeGoal") return ok({});
			const action = (params as { action: string }).action;
			if (action === "pause") return ok({ goal: pausedGoal });
			if (action === "resume") return ok({ goal: activeGoal });
			return ok({ goal: null });
		});

		expect(await h.service.changeGoal(session.id, "pause")).toEqual(ok(undefined));
		expect(h.service.chatView(session.id)?.goal).toEqual(pausedGoal);
		expect(await h.service.changeGoal(session.id, "resume")).toEqual(ok(undefined));
		expect(h.service.chatView(session.id)?.goal).toEqual(activeGoal);
		expect(await h.service.changeGoal(session.id, "clear")).toEqual(ok(undefined));
		expect(h.service.chatView(session.id)?.goal).toBeNull();
		expect(h.calls.map((call) => call.params.action)).toEqual(["pause", "resume", "clear"]);
	});

	it("returns a sidecar failure unchanged", async () => {
		const session = await seedChat();
		const h = harness();
		const failure = appError("sidecar_down", "The sidecar is not running.");
		h.replyTo(async () => err(failure));

		expect(await h.service.setGoal(session.id, "Ship it")).toEqual(err(failure));
	});
});

describe("COMP-10 loading a goal", () => {
	it("loads the chat's goal and lets only the newest answer change the store", async () => {
		const session = await seedChat();
		const pending: ((result: Result<unknown>) => void)[] = [];
		const h = harness();
		h.replyTo(
			() =>
				new Promise<Result<unknown>>((resolve) => {
					pending.push(resolve);
				}),
		);

		const first = h.service.loadGoal(session.id);
		const second = h.service.loadGoal(session.id);
		await until(() => pending.length === 2);
		const newer: CodexGoal = { objective: "The newer goal", status: "active" };
		pending[1]?.(ok({ goal: newer }));
		await until(() => h.service.chatView(session.id)?.goal === newer);
		const older: CodexGoal = { objective: "The older goal", status: "active" };
		pending[0]?.(ok({ goal: older }));
		await Promise.all([first, second]);

		expect(h.service.chatView(session.id)?.goal).toEqual(newer);
	});

	it("shows a goal change the sidecar reports", async () => {
		const session = await seedChat();
		const h = harness();

		h.service.applyGoalChanged(session.id, activeGoal);

		expect(h.service.chatView(session.id)?.goal).toEqual(activeGoal);
		h.service.applyGoalChanged(session.id, null);
		expect(h.service.chatView(session.id)?.goal).toBeNull();
	});
});
