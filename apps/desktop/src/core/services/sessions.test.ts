// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { idleLiveState } from "@conducted/protocol";
import { ok } from "@conducted/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../../platform/platform.ts";
import { REPOS_SQL, repoToParams } from "../db/repos.ts";
import { createRepositories, type Repositories } from "../db/repositories.ts";
import {
	sampleRepo,
	sampleSession,
	sampleWorkspace,
	sessionId,
	userMessageEvent,
	workspaceId,
} from "../db/test-fixtures.ts";
import { WORKSPACES_SQL, workspaceToParams } from "../db/workspaces.ts";
import { defaultSessionConfig, type Lookups } from "../lookups.ts";
import type { Workspace } from "../model.ts";
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

let raw: DatabaseSync;
let repositories: Repositories;
let now: number;
let nextId: number;
let service: SessionsService;

const settings: Record<string, unknown> = {
	default_model: "opus",
	default_fast_mode: true,
	default_plan_mode: false,
	tool_approvals_enabled: true,
	default_claude_effort_level: "medium",
};

const harness = (): SessionsService => {
	const deps = {
		db: new NodeDatabase(raw),
		repositories: () => repositories,
		sidecar: { request: vi.fn(), notify: vi.fn() },
		composer: { materializeForSend: vi.fn(), clearDraft: vi.fn() },
		queue: { enqueue: vi.fn(), release: vi.fn(), pauseOnCancel: vi.fn() },
		notifications: { onLiveStateChanged: vi.fn() },
		workspaceContextOf: vi.fn(),
		defaultConfig: async () => ok(sampleSession.config),
		setting: <T>(key: string) => settings[key] as T,
		now: () => now,
		newId: () => `generated-${++nextId}`,
	} as unknown as SessionsServiceDeps;
	return new SessionsService(deps);
};

const seedRepo = (): void => {
	raw.prepare(REPOS_SQL.insert).run(bind(repoToParams(sampleRepo)));
};

const seedWorkspace = (): void => {
	seedRepo();
	raw.prepare(WORKSPACES_SQL.insert).run(bind(must(workspaceToParams(sampleWorkspace))));
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
	service = harness();
});

afterEach(() => {
	raw.close();
});

describe("CHAT-01 sessions service", () => {
	it("loads open chats, closed chats and stored live states", async () => {
		seedWorkspace();
		const open = must(
			await repositories.sessions.create({
				workspaceId,
				title: "Open chat",
				config: sampleSession.config,
			}),
		);
		const closed = must(
			await repositories.sessions.create({
				workspaceId,
				title: "Closed chat",
				config: sampleSession.config,
			}),
		);
		must(await repositories.sessions.close(closed.id));
		must(await repositories.liveStates.upsert(open.id, idleLiveState, 1000));

		const started = await service.start();

		expect(started.ok).toBe(true);
		const state = service.store.getState();
		expect(state.loaded).toBe(true);
		expect(Object.keys(state.sessions).sort()).toEqual([open.id, closed.id].sort());
		expect(state.byWorkspace[workspaceId]).toEqual([open.id]);
		expect(state.liveStates[open.id]).toEqual(idleLiveState);
	});

	it("creates a chat and lists open chats newest first", async () => {
		seedWorkspace();
		const first = must(await service.create(workspaceId, sampleSession.config));
		now = 2000;
		const second = must(await service.create(workspaceId, sampleSession.config));

		const state = service.store.getState();
		expect(state.sessions[first.id]?.closedAt).toBeNull();
		expect(state.byWorkspace[workspaceId]).toEqual([second.id, first.id]);
		expect(must(await repositories.sessions.get(first.id))?.id).toBe(first.id);
	});

	it("closes a chat into history and reopens it", async () => {
		seedWorkspace();
		const created = must(await service.create(workspaceId, sampleSession.config));

		now = 3000;
		expect(await service.close(created.id)).toEqual({ ok: true, value: undefined });
		let state = service.store.getState();
		expect(state.byWorkspace[workspaceId]).toEqual([]);
		expect(state.sessions[created.id]?.closedAt).toBe(3000);
		expect(must(await repositories.sessions.get(created.id))?.closedAt).toBe(3000);

		now = 4000;
		expect(await service.reopen(created.id)).toEqual({ ok: true, value: undefined });
		state = service.store.getState();
		expect(state.byWorkspace[workspaceId]).toEqual([created.id]);
		expect(state.sessions[created.id]?.closedAt).toBeNull();
	});

	it("renames a chat and refuses an empty name", async () => {
		seedWorkspace();
		const created = must(await service.create(workspaceId, sampleSession.config));

		now = 5000;
		expect(await service.rename(created.id, "  Fix login  ")).toEqual({
			ok: true,
			value: undefined,
		});
		expect(service.store.getState().sessions[created.id]?.title).toBe("Fix login");
		expect(must(await repositories.sessions.get(created.id))?.title).toBe("Fix login");

		const empty = await service.rename(created.id, "   ");
		expect(empty).toMatchObject({ ok: false, error: { code: "chat_title_empty" } });
	});

	it("loads a chat's stored events once, in order", async () => {
		seedWorkspace();
		const created = must(await service.create(workspaceId, sampleSession.config));
		must(
			await repositories.sessionEvents.append(created.id, userMessageEvent("e1", "t1", 10), 100),
		);
		must(
			await repositories.sessionEvents.append(created.id, userMessageEvent("e2", "t1", 11), 101),
		);

		expect(await service.open(created.id)).toEqual({ ok: true, value: undefined });

		const loaded = service.store.getState().events[created.id] ?? [];
		expect(loaded.map((event) => event.idx)).toEqual([0, 1]);
		expect(loaded.map((event) => event.event.eventId)).toEqual(["e1", "e2"]);
	});

	it("deletes a chat with its events and live state", async () => {
		seedWorkspace();
		const created = must(await service.create(workspaceId, sampleSession.config));
		must(
			await repositories.sessionEvents.append(created.id, userMessageEvent("e1", "t1", 10), 100),
		);
		must(await repositories.liveStates.upsert(created.id, idleLiveState, 1000));

		expect(await service.delete(created.id)).toEqual({ ok: true, value: undefined });

		expect(must(await repositories.sessions.get(created.id))).toBeNull();
		expect(must(await repositories.sessionEvents.listFrom(created.id, 0, 10))).toEqual([]);
		expect(must(await repositories.liveStates.get(created.id))).toBeNull();
		const state = service.store.getState();
		expect(state.sessions[created.id]).toBeUndefined();
		expect(state.byWorkspace[workspaceId]).toEqual([]);
	});

	it("reports an unknown chat instead of inventing one", async () => {
		expect(await service.close(sessionId)).toMatchObject({
			ok: false,
			error: { code: "session_unknown" },
		});
		expect(await service.open(sessionId)).toMatchObject({
			ok: false,
			error: { code: "session_unknown" },
		});
	});
});

describe("CHAT-01 default session config", () => {
	const workspace = {
		id: workspaceId,
		linkedPaths: ["/code/other"],
	} as Workspace;

	const lookups = {
		workspace: () => ok(workspace),
	} as unknown as Lookups;

	it("builds a new chat's config from settings and the workspace", () => {
		const config = defaultSessionConfig(
			workspaceId,
			lookups,
			<T>(key: string) => settings[key] as T,
		);
		expect(config).toEqual({
			ok: true,
			value: {
				agent: "claude",
				model: "opus",
				effort: "medium",
				fastMode: true,
				planMode: false,
				requireToolApproval: true,
				additionalDirectories: ["/code/other"],
				appTools: { diffComments: true, progressUpdates: true, setTargetBranch: true },
			},
		});
	});

	it("returns the workspace error", () => {
		const missing = {
			workspace: () => ({
				ok: false as const,
				error: { code: "workspace_unknown", message: "gone" },
			}),
		} as unknown as Lookups;
		expect(defaultSessionConfig(workspaceId, missing, <T>() => "" as T)).toMatchObject({
			ok: false,
			error: { code: "workspace_unknown" },
		});
	});
});
