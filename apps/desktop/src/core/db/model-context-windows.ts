/**
 * @feature CHAT-14 Repository for the model_context_windows table
 * Owns: the context window size each agent last reported for a model.
 * Behaviour: services-map.md 1.5 and 2.7.2 (Conductor keeps the context window per model, so a
 * chat can show its size before its own agent reports one); migration 0006.
 * Must handle: a second report for the same agent and model replaces the first; a size that is
 * not positive is refused by the table; `updated_at` comes from `RepositoryDeps`.
 * Test first: recording a model's window twice keeps one row with the newer size.
 */
import { err, ok, type Result } from "@conducted/shared";
import type { Database } from "../../platform/platform.ts";
import type { RepositoryDeps } from "./deps.ts";
import { executeVoid, selectRows } from "./row-codec.ts";

/** One remembered size. `agent` is the agent kind, or "acp:<agent>" for an ACP agent. */
export interface ModelContextWindow {
	agent: string;
	model: string;
	windowTokens: number;
	updatedAt: number;
}

interface ModelContextWindowRow {
	agent: string;
	model: string;
	window_tokens: number;
	updated_at: number;
}

/** Every statement the repository runs. Parameters are `$1..$n` in order of first appearance. */
export const MODEL_CONTEXT_WINDOWS_SQL = {
	list: `SELECT agent, model, window_tokens, updated_at FROM model_context_windows
		ORDER BY agent, model`,
	record: `INSERT INTO model_context_windows (agent, model, window_tokens, updated_at)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (agent, model) DO UPDATE SET
			window_tokens = excluded.window_tokens, updated_at = excluded.updated_at`,
} as const;

export interface ModelContextWindowRepository {
	/** MODEL_CONTEXT_WINDOWS_SQL.list. */
	list(): Promise<Result<ModelContextWindow[]>>;
	/** MODEL_CONTEXT_WINDOWS_SQL.record: inserts the size, or replaces the one already kept. */
	record(agent: string, model: string, windowTokens: number): Promise<Result<void>>;
}

export function createModelContextWindowRepository(
	db: Database,
	deps: RepositoryDeps,
): ModelContextWindowRepository {
	return {
		list: async () => {
			const rows = await selectRows<ModelContextWindowRow>(
				db,
				MODEL_CONTEXT_WINDOWS_SQL.list,
				[],
				"Listing model context windows",
			);
			if (!rows.ok) return err(rows.error);
			return ok(
				rows.value.map((row) => ({
					agent: row.agent,
					model: row.model,
					windowTokens: row.window_tokens,
					updatedAt: row.updated_at,
				})),
			);
		},
		record: (agent, model, windowTokens) =>
			executeVoid(
				db,
				MODEL_CONTEXT_WINDOWS_SQL.record,
				[agent, model, windowTokens, deps.clock.now()],
				"Remembering a model's context window",
			),
	};
}
