// @vitest-environment node
/**
 * @feature CHAT-18 Resume after restart and reconnect
 * Behaviour: sessions.md section 8, sessions-and-chats.md "How chats are stored".
 * Test first: a live state without an open interaction clears the card, and closing a lost chat
 * writes its interrupted turns in one transaction.
 */
import { type InteractionRequest, idleLiveState, type LiveState } from "@conducted/protocol";
import {
	appError,
	err,
	type InteractionId,
	ok,
	type Result,
	type SessionId,
	type TurnId,
} from "@conducted/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../../platform/platform.ts";
import { openTestDatabase, type TestDatabase } from "../../test/sqlite.ts";
import { createRepositories, type Repositories } from "../db/repositories.ts";
import { sampleSession, userMessageEvent } from "../db/test-fixtures.ts";
import { SessionsService, type SessionsServiceDeps } from "./sessions.ts";

const must = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

const working: LiveState = { ...idleLiveState, status: "working" };

interface Harness {
	store: TestDatabase;
	repositories: Repositories;
	service: SessionsService;
	queries: { sql: string; params: readonly unknown[] }[];
	failAppend: (on: boolean) => void;
}

/**
 * Wraps the test database so a test can see the SQL, and fails the second append once `failAppend`
 * is on. The transaction handle is wrapped too, because the service builds its repositories on it.
 */
const recordingDatabase = (inner: Database) => {
	const queries: { sql: string; params: readonly unknown[] }[] = [];
	let failAppend = false;
	let appends = 0;
	const wrap = (db: Database): Database => ({
		execute: async (sql, params = []) => db.execute(sql, params),
		select: async <Row>(sql: string, params?: readonly unknown[]) => {
			queries.push({ sql, params: params ?? [] });
			// The append statement returns its row, so it runs through select.
			if (failAppend && sql.includes("INSERT INTO session_events")) {
				appends += 1;
				if (appends === 2) throw new Error("The second append failed");
			}
			return db.select<Row>(sql, params);
		},
		transaction: <T>(work: (tx: Database) => Promise<T>) => db.transaction((tx) => work(wrap(tx))),
	});
	return {
		database: wrap(inner),
		queries,
		failAppend: (on: boolean) => {
			failAppend = on;
		},
	};
};

const open: TestDatabase[] = [];

const harness = async (): Promise<Harness> => {
	const store = openTestDatabase();
	open.push(store);
	let next = 0;
	const deps = { clock: { now: () => 1000 }, ids: { uuid: () => `gen-${++next}` } };
	const planned = recordingDatabase(store.database);
	const repositories = createRepositories(planned.database, deps);
	const service = new SessionsService({
		db: planned.database,
		repositories: () => repositories,
		repositoriesOn: (db: Database): Repositories => createRepositories(db, deps),
		notifications: { onLiveStateChanged: vi.fn() },
		now: () => 1000,
		newId: () => `gen-${++next}`,
	} as unknown as SessionsServiceDeps);
	return {
		store,
		repositories,
		service,
		queries: planned.queries,
		failAppend: planned.failAppend,
	};
};

const seedSession = async (repositories: Repositories, suffix: string) => {
	const repo = must(
		await repositories.repos.create({
			name: `project-${suffix}`,
			rootPath: `/code/projects/${suffix}`,
			remoteUrl: null,
			defaultBranch: "main",
			icon: null,
		}),
	);
	const workspace = must(
		await repositories.workspaces.create({
			repoId: repo.id,
			directoryName: `workspace-${suffix}`,
			path: `/code/workspaces/${suffix}`,
			branch: `jahala/workspace-${suffix}`,
			branchIsPlaceholder: true,
			remoteFileSyncEnabled: false,
			host: { kind: "local" },
			targetBranch: "origin/main",
			port: 55_000,
			linkedPaths: [],
			setupLogPath: null,
		}),
	);
	const session = must(
		await repositories.sessions.create({
			workspaceId: workspace.id,
			title: `Chat ${suffix}`,
			config: sampleSession.config,
		}),
	);
	must(
		await repositories.sessionEvents.append(
			session.id,
			userMessageEvent(`event-${suffix}`, `turn-${suffix}`, 900),
			900,
		),
	);
	return session.id;
};

afterEach(() => {
	vi.restoreAllMocks();
	for (const store of open.splice(0)) store.close();
});

describe("CHAT-18 live state", () => {
	it("clears a stale card when the new live state has no open interaction", async () => {
		const h = await harness();
		const sessionId = await seedSession(h.repositories, "one");
		const request: InteractionRequest = {
			sessionId,
			interactionId: "i1" as InteractionId,
			interaction: {
				kind: "question",
				questions: [{ question: "Which branch?", options: [], multiSelect: false }],
			},
		};
		const pending = h.service.requestInteraction(request);

		const written = await h.service.applyLiveState(sessionId, idleLiveState);

		expect(written.ok).toBe(true);
		expect(h.service.store.getState().openInteractions[sessionId]).toBeUndefined();
		await expect(pending).resolves.toEqual({ kind: "withdrawn" });
	});

	it("returns the error when the live-state write fails", async () => {
		const service = new SessionsService({
			repositories: () => ({
				liveStates: {
					upsert: async () => err(appError("db.failed", "The live state was not stored")),
				},
			}),
			notifications: { onLiveStateChanged: vi.fn() },
			now: () => 1000,
		} as unknown as SessionsServiceDeps);

		const written = await service.applyLiveState("s1" as SessionId, idleLiveState);

		expect(written).toMatchObject({ ok: false, error: { code: "db.failed" } });
	});
});

describe("CHAT-18 mark interrupted", () => {
	it("reads only the lost chat's log, closes only its turns and shows idle", async () => {
		const h = await harness();
		const lost = await seedSession(h.repositories, "lost");
		const other = await seedSession(h.repositories, "other");
		await h.service.applyLiveState(lost, working);

		const result = await h.service.markInterrupted(lost);

		expect(result).toEqual(ok(undefined));
		const lostTurns = must(
			await h.repositories.sessionEvents.listByTurn(lost, "turn-lost" as TurnId),
		);
		expect(lostTurns.filter((stored) => stored.event.type === "turn_ended")).toHaveLength(1);
		const otherTurns = must(
			await h.repositories.sessionEvents.listByTurn(other, "turn-other" as TurnId),
		);
		expect(otherTurns.some((stored) => stored.event.type === "turn_ended")).toBe(false);
		expect(h.service.store.getState().liveStates[lost]).toEqual(idleLiveState);

		const finder = h.queries.find((query) => query.sql.includes("SUM(type = 'user_message')"));
		expect(finder?.params).toEqual([lost]);
	});

	it("writes every interrupted turn in one transaction and leaves nothing behind on failure", async () => {
		const h = await harness();
		const lost = await seedSession(h.repositories, "lost");
		must(
			await h.repositories.sessionEvents.append(
				lost,
				userMessageEvent("event-lost-2", "turn-lost-2", 950),
				950,
			),
		);
		await h.service.applyLiveState(lost, working);
		h.failAppend(true);

		const result: Result<void> = await h.service.markInterrupted(lost);

		expect(result.ok).toBe(false);
		const turns = must(await h.repositories.sessionEvents.listByTurn(lost, "turn-lost" as TurnId));
		expect(turns.some((stored) => stored.event.type === "turn_ended")).toBe(false);
		const second = must(
			await h.repositories.sessionEvents.listByTurn(lost, "turn-lost-2" as TurnId),
		);
		expect(second.some((stored) => stored.event.type === "turn_ended")).toBe(false);
		expect(h.service.store.getState().liveStates[lost]).toEqual(working);
	});
});
