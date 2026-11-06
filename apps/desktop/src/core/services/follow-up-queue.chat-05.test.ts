// @vitest-environment node
/**
 * @feature CHAT-05 Cancel a turn
 * Behaviour: sessions-and-chats.md "While the agent is working" (cancel), services-map.md 2.3.3
 * (requeue a sent message at the end of the queue) and 2.3.4 (pause on cancel).
 * Test first: a row already sending goes back to waiting at the end of the queue, and every
 * waiting row stays.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { type MessageId, ok, type SessionId } from "@conducted/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../../platform/platform.ts";
import { REPOS_SQL, repoToParams } from "../db/repos.ts";
import { createRepositories, type Repositories } from "../db/repositories.ts";
import { sampleRepo, sampleSession, sampleWorkspace, workspaceId } from "../db/test-fixtures.ts";
import { WORKSPACES_SQL, workspaceToParams } from "../db/workspaces.ts";
import { FollowUpQueue } from "./follow-up-queue.ts";

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
let sessionId: SessionId;
let queue: FollowUpQueue;

const enqueue = async (id: string, text: string) =>
	must(
		await repositories.queuedMessages.enqueue({
			id: id as MessageId,
			sessionId,
			text,
			attachmentPaths: [],
			delivery: "queue",
		}),
	);

beforeEach(async () => {
	raw = new DatabaseSync(":memory:");
	for (const sql of MIGRATIONS) raw.exec(sql);
	now = 1000;
	nextId = 0;
	repositories = createRepositories(new NodeDatabase(raw), {
		clock: { now: () => now },
		ids: { uuid: () => `repo-${++nextId}` },
	});
	raw.prepare(REPOS_SQL.insert).run(bind(repoToParams(sampleRepo)));
	raw.prepare(WORKSPACES_SQL.insert).run(bind(must(workspaceToParams(sampleWorkspace))));
	const session = must(
		await repositories.sessions.create({
			workspaceId,
			title: null,
			config: sampleSession.config,
		}),
	);
	sessionId = session.id;
	queue = new FollowUpQueue({
		repos: repositories,
		deliver: async () => ok(undefined),
		liveStateOf: () => undefined,
		newId: () => `queue-${++nextId}`,
		now: () => now,
	});
});

afterEach(() => {
	raw.close();
});

describe("CHAT-05 cancel a turn", () => {
	it("pauses the queue and keeps every waiting message", async () => {
		const first = await enqueue("m1", "First");
		const second = await enqueue("m2", "Second");

		const result = await queue.pauseOnCancel(sessionId);

		expect(result).toEqual(ok(undefined));
		expect(queue.store.getState().pausedSessionIds[sessionId]).toBe(true);
		const rows = must(await repositories.queuedMessages.listBySession(sessionId));
		expect(rows.map((row) => row.id)).toEqual([first.id, second.id]);
		expect(rows.every((row) => row.state === "waiting")).toBe(true);
		expect(queue.store.getState().bySession[sessionId]?.map((row) => row.id)).toEqual([
			first.id,
			second.id,
		]);
	});

	it("puts a message that was already sending back at the end of the queue", async () => {
		const first = await enqueue("m1", "First");
		const second = await enqueue("m2", "Second");
		const third = await enqueue("m3", "Third");
		expect(
			await repositories.queuedMessages.setState(second.id, "waiting", "sending", null),
		).toEqual(ok(true));

		const result = await queue.pauseOnCancel(sessionId);

		expect(result).toEqual(ok(undefined));
		const rows = must(await repositories.queuedMessages.listBySession(sessionId));
		expect(rows.map((row) => row.id)).toEqual([first.id, third.id, second.id]);
		expect(rows.map((row) => row.state)).toEqual(["waiting", "waiting", "waiting"]);
		expect(rows.map((row) => row.position)).toEqual([1, 2, 3]);
		expect(queue.store.getState().bySession[sessionId]?.map((row) => row.id)).toEqual([
			first.id,
			third.id,
			second.id,
		]);
	});

	it("pauses an empty queue without touching any rows", async () => {
		const result = await queue.pauseOnCancel(sessionId);

		expect(result).toEqual(ok(undefined));
		expect(queue.store.getState().pausedSessionIds[sessionId]).toBe(true);
		expect(queue.store.getState().bySession[sessionId] ?? []).toEqual([]);
	});
});
