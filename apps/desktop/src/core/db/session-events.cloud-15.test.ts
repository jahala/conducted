// @vitest-environment node
/**
 * @feature CLOUD-15 Cloud workspace header: status, resources, cost, restart
 * Tests the one query the header's "Agent cost" uses: the sum of the usage items every agent turn
 * of a workspace reported, with reverted turns left out.
 * Test first: two turns reporting 0.25 and 0.50 US dollars add up to 0.75 for the workspace.
 */
import type { DatabaseSync } from "node:sqlite";
import type { WorkspaceId } from "@conducted/shared";
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

const usage = (costUsd: number | undefined) => ({
	kind: "usage" as const,
	inputTokens: 10,
	outputTokens: 5,
	cacheReadTokens: 0,
	cacheWriteTokens: 0,
	...(costUsd === undefined ? {} : { costUsd }),
});

let store: ReturnType<typeof openTestDatabase>;
let raw: DatabaseSync;
let repositories: Repositories;

beforeEach(() => {
	store = openTestDatabase();
	raw = store.raw;
	repositories = createRepositories(store.database, {
		clock: { now: () => 1000 },
		ids: { uuid: () => crypto.randomUUID() },
	});
	raw.prepare(REPOS_SQL.insert).run(bind(repoToParams(sampleRepo)));
	raw.prepare(WORKSPACES_SQL.insert).run(bind(must(workspaceToParams(sampleWorkspace))));
	raw.prepare(SESSIONS_SQL.insert).run(bind(must(sessionToParams(sampleSession))));
});

afterEach(() => {
	store.close();
});

describe("CLOUD-15 agent cost", () => {
	it("adds the usage costs of a workspace's turns", async () => {
		must(
			await repositories.sessionEvents.append(
				sessionId,
				userMessageEvent("e1", "turn-1", 100),
				100,
			),
		);
		must(
			await repositories.sessionEvents.append(
				sessionId,
				agentEvent("e2", "turn-1", 110, [usage(0.25)]),
				110,
			),
		);
		must(
			await repositories.sessionEvents.append(sessionId, turnEndedEvent("e3", "turn-1", 120), 120),
		);
		must(
			await repositories.sessionEvents.append(
				sessionId,
				agentEvent("e4", "turn-2", 210, [usage(0.5), usage(undefined)]),
				210,
			),
		);
		const cost = await repositories.sessionEvents.workspaceCost(sampleWorkspace.id);
		expect(cost).toEqual({ ok: true, value: 0.75 });
	});

	it("leaves a reverted turn out of the total", async () => {
		must(
			await repositories.sessionEvents.append(
				sessionId,
				userMessageEvent("r1", "turn-1", 100),
				100,
			),
		);
		must(
			await repositories.sessionEvents.append(
				sessionId,
				agentEvent("r2", "turn-1", 110, [usage(1)]),
				110,
			),
		);
		must(await repositories.sessionEvents.markRevertedFromTurn(sessionId, "turn-1" as never, 200));
		expect(await repositories.sessionEvents.workspaceCost(sampleWorkspace.id)).toEqual({
			ok: true,
			value: 0,
		});
	});

	it("answers zero for a workspace with no recorded usage", async () => {
		expect(
			await repositories.sessionEvents.workspaceCost("other-workspace" as WorkspaceId),
		).toEqual({ ok: true, value: 0 });
	});
});
