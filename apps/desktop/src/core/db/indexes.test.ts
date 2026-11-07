// @vitest-environment node
/**
 * @feature DATA-03 Startup repair and DATA-02 Data-lifetime job
 * Owns: the query-plan checks for the indexes on session_events (#392).
 * Behaviour: docs/research/db-scans-2026-11-07.md, the measurement before and after migration 0010.
 * Must handle: the startup repair query must be answered from the unreverted-turn index, not from
 * the table. The daily cutToolOutputs scan deliberately has no index, because the measurement
 * showed one makes it slower, so nothing here asserts one.
 * Test first: the startup repair query reads the unreverted-turn index.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openTestDatabase } from "../../test/sqlite.ts";
import { SESSION_EVENTS_SQL } from "./session-events.ts";

interface PlanRow {
	detail: string;
}

let store: ReturnType<typeof openTestDatabase>;

beforeEach(() => {
	store = openTestDatabase();
});

afterEach(() => {
	store.close();
});

const run = (sql: string): void => {
	store.raw.prepare(sql).run();
};

/** node:sqlite binds `$1..$n` by name, so a positional list becomes `{ $1: ... }`. */
const bind = (params: readonly unknown[]): Record<string, never> =>
	Object.fromEntries(params.map((value, index) => [`$${index + 1}`, value])) as never;

const planFor = (sql: string, params: readonly unknown[] = []): string =>
	(store.raw.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(bind(params)) as unknown as PlanRow[])
		.map((row) => row.detail)
		.join("\n");

describe("the indexes behind the event-log scans", () => {
	beforeEach(() => {
		run(
			`INSERT INTO repos (id, name, root_path, default_branch, created_at, updated_at)
			VALUES ('repo-1', 'conducted', '/code/conducted', 'main', 1, 1)`,
		);
		run(
			`INSERT INTO workspaces (id, repo_id, directory_name, path, branch, target_branch, state,
				port, last_activity_at, created_at, updated_at, host_kind)
			VALUES ('ws-1', 'repo-1', 'oslo', '/code/oslo', 'user/oslo', 'origin/main', 'ready',
				55100, 1, 1, 1, 'local')`,
		);
		run(
			`INSERT INTO sessions (id, workspace_id, config, created_at, updated_at)
			VALUES ('chat-1', 'ws-1', '{}', 1, 1)`,
		);
		run(
			`INSERT INTO session_events
				(session_id, idx, event_id, type, turn_id, content, received_at, reverted_at)
			VALUES ('chat-1', 0, 'e1', 'user_message', 'turn-1', '{}', 1, NULL)`,
		);
	});

	it("the startup repair query reads the unreverted-turn index", () => {
		const plan = planFor(SESSION_EVENTS_SQL.findInterruptedTurns);
		expect(plan).toContain("idx_session_events_unreverted_turn");
		expect(plan).toContain("COVERING INDEX");
		expect(plan).not.toContain("USING INDEX idx_session_events_turn");
	});

	it("the per-chat repair query reads the unreverted-turn index too", () => {
		const plan = planFor(SESSION_EVENTS_SQL.findInterruptedTurnsForSession, ["chat-1"]);
		expect(plan).toContain("idx_session_events_unreverted_turn");
	});
});
