// @vitest-environment node
import type { SessionConfig } from "@conducted/protocol";
import { type AppError, appError, ok } from "@conducted/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../../platform/platform.ts";
import { openTestDatabase } from "../../test/sqlite.ts";
import { REPOS_SQL, repoToParams } from "../db/repos.ts";
import { createRepositories, type Repositories } from "../db/repositories.ts";
import { sampleRepo, sampleSession, sampleWorkspace, workspaceId } from "../db/test-fixtures.ts";
import { WORKSPACES_SQL, workspaceToParams } from "../db/workspaces.ts";
import { SessionsService, type SessionsServiceDeps } from "./sessions.ts";

const bind = (params: readonly unknown[]): Record<string, never> =>
	Object.fromEntries(params.map((value, index) => [`$${index + 1}`, value])) as never;

const must = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

const workspace = {
	workspaceId,
	workspaceName: sampleWorkspace.directoryName,
	workspacePath: sampleWorkspace.path,
	repoRootPath: sampleRepo.rootPath,
	targetBranch: sampleWorkspace.targetBranch,
	placeholderBranch: sampleWorkspace.branchIsPlaceholder,
	port: sampleWorkspace.port,
};

interface Call {
	method: string;
	params: Record<string, unknown>;
}

let store: ReturnType<typeof openTestDatabase>;
let raw: ReturnType<typeof openTestDatabase>["raw"];
let database: Database;
let repositories: Repositories;
let now: number;
let nextId: number;

const harness = (
	settings: Record<string, unknown>,
	options: { sendError?: AppError; baseConfig?: SessionConfig } = {},
): { service: SessionsService; calls: Call[] } => {
	const calls: Call[] = [];
	const deps = {
		db: database,
		repositories: () => repositories,
		sidecar: {
			request: async (method: string, params: Record<string, unknown>) => {
				calls.push({ method, params });
				if (method === "sendMessage" && options.sendError !== undefined) {
					return { ok: false as const, error: options.sendError };
				}
				return ok({ deliveredAs: "new_turn" });
			},
			notify: async () => ok(undefined),
		},
		composer: {
			materializeForSend: vi.fn(async () => ok([])),
			clearDraft: vi.fn(),
			loadDraft: vi.fn(async () => ok({ text: "", attachmentPaths: [] })),
			saveDraft: vi.fn(),
		},
		queue: { enqueue: vi.fn(), release: vi.fn(), pauseOnCancel: vi.fn() },
		notifications: { onLiveStateChanged: vi.fn() },
		launchFor: async () => ok({ env: {}, providerKeys: {} }),
		workspaceContextOf: async () => ok(workspace),
		defaultConfig: async () => ok(options.baseConfig ?? sampleSession.config),
		setting: <T>(key: string) => settings[key] as T,
		now: () => now,
		newId: () => `generated-${++nextId}`,
	} as unknown as SessionsServiceDeps;
	return { service: new SessionsService(deps), calls };
};

const seedWorkspace = (): void => {
	raw.prepare(REPOS_SQL.insert).run(bind(repoToParams(sampleRepo)));
	raw.prepare(WORKSPACES_SQL.insert).run(bind(must(workspaceToParams(sampleWorkspace))));
};

beforeEach(() => {
	store = openTestDatabase();
	raw = store.raw;
	database = store.database;
	now = 1000;
	nextId = 0;
	repositories = createRepositories(database, {
		clock: { now: () => now },
		ids: { uuid: () => `repo-${++nextId}` },
	});
});

afterEach(() => {
	store.close();
});

describe("REV-05 startReviewChat", () => {
	it("starts a new chat with the review model and sends the text", async () => {
		seedWorkspace();
		const h = harness({
			default_message_send_mode: "steer",
			custom_prompt_general: "",
			review_model: "opus",
			review_fast_mode: true,
			review_claude_effort_level: "max",
		});

		const created = await h.service.startReviewChat(workspaceId, "Review this change.");

		expect(created.ok).toBe(true);
		if (!created.ok) return;
		expect(created.value.config).toMatchObject({
			model: "opus",
			fastMode: true,
			effort: "max",
		});
		expect(h.service.store.getState().byWorkspace[workspaceId]).toContain(created.value.id);
		const sent = h.calls.find((call) => call.method === "sendMessage");
		expect(sent?.params).toMatchObject({
			sessionId: created.value.id,
			text: "Review this change.",
		});
	});

	it("falls back to the default model when no review model is set", async () => {
		seedWorkspace();
		const h = harness({
			default_message_send_mode: "steer",
			custom_prompt_general: "",
			review_model: "",
			review_fast_mode: false,
			review_claude_effort_level: "",
		});

		const created = await h.service.startReviewChat(workspaceId, "Review this change.");

		expect(created.ok).toBe(true);
		if (!created.ok) return;
		expect(created.value.config.model).toBe(sampleSession.config.model);
		expect(created.value.config.effort).toBe(sampleSession.config.effort);
	});

	it("refuses an effort level a review cannot use without creating a chat", async () => {
		seedWorkspace();
		const h = harness({
			default_message_send_mode: "steer",
			custom_prompt_general: "",
			review_model: "",
			review_fast_mode: false,
			review_claude_effort_level: "turbo",
		});

		const result = await h.service.startReviewChat(workspaceId, "Review this change.");

		expect(result).toMatchObject({ ok: false, error: { code: "setting_invalid" } });
		const listed = must(
			await repositories.sessions.listByWorkspace(workspaceId, { includeClosed: true }),
		);
		expect(listed).toEqual([]);
		expect(h.calls.some((call) => call.method === "sendMessage")).toBe(false);
	});

	it("takes a Codex review's effort from the Codex thinking level", async () => {
		seedWorkspace();
		const codexConfig: SessionConfig = {
			...sampleSession.config,
			agent: "codex",
			model: "gpt-5",
			effort: "high",
		};
		const h = harness(
			{
				default_message_send_mode: "steer",
				custom_prompt_general: "",
				review_model: "",
				review_fast_mode: false,
				review_codex_thinking_level: "low",
			},
			{ baseConfig: codexConfig },
		);

		const created = await h.service.startReviewChat(workspaceId, "Review this change.");

		expect(created.ok).toBe(true);
		if (!created.ok) return;
		expect(created.value.config).toMatchObject({ agent: "codex", effort: "low" });
	});

	it("turns fast mode off for a review even when the default chat is fast", async () => {
		seedWorkspace();
		const fastConfig: SessionConfig = { ...sampleSession.config, fastMode: true };
		const h = harness(
			{
				default_message_send_mode: "steer",
				custom_prompt_general: "",
				review_model: "",
				review_fast_mode: false,
				review_claude_effort_level: "",
			},
			{ baseConfig: fastConfig },
		);

		const created = await h.service.startReviewChat(workspaceId, "Review this change.");

		expect(created.ok).toBe(true);
		if (!created.ok) return;
		expect(created.value.config.fastMode).toBe(false);
	});

	it("removes the new chat when the review message cannot be sent", async () => {
		seedWorkspace();
		const h = harness(
			{
				default_message_send_mode: "steer",
				custom_prompt_general: "",
				review_model: "",
				review_fast_mode: false,
				review_claude_effort_level: "",
			},
			{ sendError: appError("sidecar_unavailable", "The sidecar is not running.") },
		);

		const result = await h.service.startReviewChat(workspaceId, "Review this change.");

		expect(result).toMatchObject({ ok: false, error: { code: "sidecar_unavailable" } });
		const listed = must(
			await repositories.sessions.listByWorkspace(workspaceId, { includeClosed: true }),
		);
		expect(listed).toEqual([]);
		expect(h.service.store.getState().byWorkspace[workspaceId] ?? []).toEqual([]);
	});
});
