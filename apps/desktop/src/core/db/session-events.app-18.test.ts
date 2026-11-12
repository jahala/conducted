// @vitest-environment node
/**
 * @feature APP-18 Chat history from Conductor
 * Tests the statements that write an imported chat's history: the staging the import writes a
 * chat's events to, which no reader of the chat sees, and the one statement that copies them into
 * the chat after its last position, in order, with the time they were received (D136).
 * Test first: three staged events are not in the chat until they are published, then read back in
 * order at idx 0 to 2.
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

describe("APP-18 a chat's history staged, then written in one statement (D136)", () => {
	const staged = [
		userMessageEvent("e1", "turn-1", 100),
		agentEvent("e2", "turn-1", 110, [{ kind: "text", text: 'It\'s "quoted"\nand long' }]),
		turnEndedEvent("e3", "turn-1", 120),
	];
	const attached = async (): Promise<string[]> =>
		(await store.database.select<{ name: string }>("SELECT name FROM pragma_database_list"))
			.map((row) => row.name)
			.sort();

	it("no reader of the chat sees staged events until they are published, in order", async () => {
		const events = repositories.sessionEvents;
		must(await events.openStaging());
		expect(must(await events.stageMany(staged.slice(0, 2)))).toBe(2);
		expect(must(await events.stageMany(staged.slice(2)))).toBe(1);
		expect(must(await events.stageMany([]))).toBe(0);
		expect(must(await events.count(sessionId))).toBe(0);

		expect(must(await events.publishStaged(sessionId, 9000))).toBe(3);
		const stored = must(await events.listFrom(sessionId, 0, 10));
		expect(stored.map((row) => [row.idx, row.eventId, row.receivedAt])).toEqual([
			[0, "e1", 9000],
			[1, "e2", 9000],
			[2, "e3", 9000],
		]);
		expect(stored.map((row) => row.event)).toEqual(staged);
		must(await events.closeStaging());
		expect(await attached()).toEqual(["main", "temp"]);
	});

	it("a staging left open is dropped when the next opens, and closing twice is harmless", async () => {
		const events = repositories.sessionEvents;
		must(await events.openStaging());
		must(await events.stageMany(staged));
		must(await events.openStaging());

		expect(must(await events.publishStaged(sessionId, 9000))).toBe(0);
		must(await events.closeStaging());
		must(await events.closeStaging());
		expect(await attached()).toEqual(["main", "temp"]);
		expect(must(await events.count(sessionId))).toBe(0);
	});

	it("publishes after the chat's last position and drops an id it holds, so the count falls short", async () => {
		const events = repositories.sessionEvents;
		must(await events.append(sessionId, userMessageEvent("e1", "turn-1", 100), 100));
		must(await events.openStaging());
		must(await events.stageMany(staged));

		expect(must(await events.publishStaged(sessionId, 9000))).toBe(2);
		const stored = must(await events.listFrom(sessionId, 0, 10));
		expect(stored.map((row) => [row.idx, row.eventId, row.receivedAt])).toEqual([
			[0, "e1", 100],
			[2, "e2", 9000],
			[3, "e3", 9000],
		]);
		must(await events.closeStaging());
	});
});
