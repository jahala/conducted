// @vitest-environment node
/**
 * @feature CHAT-14 Context wheel, cost and plan usage
 * Tests the per-model context window table (migration 0006): one row per agent and model, a new
 * report replacing the old one, and a size that must be positive.
 * Test first: recording a model's window twice keeps one row with the newer size.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestIds } from "../../test/ids.ts";
import { openTestDatabase } from "../../test/sqlite.ts";
import { createRepositories, type Repositories } from "./repositories.ts";

let store: ReturnType<typeof openTestDatabase>;
let repositories: Repositories;
let now = 1000;

beforeEach(() => {
	store = openTestDatabase();
	repositories = createRepositories(store.database, {
		clock: { now: () => now },
		ids: createTestIds(),
	});
});

afterEach(() => {
	store.close();
});

describe("CHAT-14 model_context_windows", () => {
	it("keeps one row per agent and model, with the newest size", async () => {
		expect((await repositories.modelContextWindows.record("claude", "opus", 200_000)).ok).toBe(
			true,
		);
		now = 2000;
		expect((await repositories.modelContextWindows.record("claude", "opus", 1_000_000)).ok).toBe(
			true,
		);
		expect((await repositories.modelContextWindows.record("codex", "opus", 272_000)).ok).toBe(true);

		expect(await repositories.modelContextWindows.list()).toEqual({
			ok: true,
			value: [
				{ agent: "claude", model: "opus", windowTokens: 1_000_000, updatedAt: 2000 },
				{ agent: "codex", model: "opus", windowTokens: 272_000, updatedAt: 2000 },
			],
		});
	});

	it("refuses a size that is not positive", async () => {
		const recorded = await repositories.modelContextWindows.record("claude", "opus", 0);
		expect(recorded.ok).toBe(false);
		expect(await repositories.modelContextWindows.list()).toEqual({ ok: true, value: [] });
	});
});
