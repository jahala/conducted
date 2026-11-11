// @vitest-environment node
/**
 * @feature APP-18 Chat history from Conductor
 * Tests the one statement that writes an imported chat's history: many events after the chat's
 * last position, in order, with the time they were received.
 * Test first: three events appended after one already there read back in order, at idx 1 to 3.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openTestDatabase } from "../../test/sqlite.ts";
import { REPOS_SQL, repoToParams } from "./repos.ts";
import { createRepositories, type Repositories } from "./repositories.ts";
import { SESSIONS_SQL, sessionToParams } from "./sessions.ts";
import {
	agentEvent,
	sampleRepo,
	sampleSession,
	sampleWorkspace,
	sessionId,
	turnEndedEvent,
	userMessageEvent,
} from "./test-fixtures.ts";
import { WORKSPACES_SQL, workspaceToParams } from "./workspaces.ts";

const bind = (params: readonly unknown[]): Record<string, never> =>
	Object.fromEntries(params.map((value, index) => [`$${index + 1}`, value])) as never;

const must = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

let store: ReturnType<typeof openTestDatabase>;
let repositories: Repositories;

beforeEach(() => {
	store = openTestDatabase();
	repositories = createRepositories(store.database, {
		clock: { now: () => 1000 },
		ids: { uuid: () => crypto.randomUUID() },
	});
	store.raw.prepare(REPOS_SQL.insert).run(bind(repoToParams(sampleRepo)));
	store.raw.prepare(WORKSPACES_SQL.insert).run(bind(must(workspaceToParams(sampleWorkspace))));
	store.raw.prepare(SESSIONS_SQL.insert).run(bind(must(sessionToParams(sampleSession))));
});

afterEach(() => {
	store.close();
});

describe("APP-18 many events in one statement", () => {
	it("appends after the last position, in order, and reads back the same events", async () => {
		const events = repositories.sessionEvents;
		must(await events.append(sessionId, userMessageEvent("e0", "turn-0", 50), 50));
		const batch = [
			userMessageEvent("e1", "turn-1", 100),
			agentEvent("e2", "turn-1", 110, [{ kind: "text", text: 'It\'s "quoted"\nand long' }]),
			turnEndedEvent("e3", "turn-1", 120),
		];

		expect(must(await events.appendMany(sessionId, batch, 9000))).toBe(3);

		const stored = must(await events.listFrom(sessionId, 0, 10));
		expect(stored.map((row) => [row.idx, row.eventId, row.turnId, row.receivedAt])).toEqual([
			[0, "e0", "turn-0", 50],
			[1, "e1", "turn-1", 9000],
			[2, "e2", "turn-1", 9000],
			[3, "e3", "turn-1", 9000],
		]);
		expect(stored.slice(1).map((row) => row.event)).toEqual(batch);
		expect(must(await events.count(sessionId))).toBe(4);
	});

	it("drops an event id the chat holds, so the count it answers falls short", async () => {
		const events = repositories.sessionEvents;
		must(await events.append(sessionId, userMessageEvent("e1", "turn-1", 100), 100));
		const answered = must(
			await events.appendMany(
				sessionId,
				[userMessageEvent("e1", "turn-1", 100), turnEndedEvent("e2", "turn-1", 120)],
				9000,
			),
		);
		expect(answered).toBe(1);
		expect(must(await events.count(sessionId))).toBe(2);
		expect(must(await events.appendMany(sessionId, [], 9000))).toBe(0);
	});
});
