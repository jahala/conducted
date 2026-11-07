/**
 * @feature CLOUD-13 Local copy of cloud data, kept apart by host
 * Owns: removing every row that belongs to one cloud host, in one transaction.
 * Behaviour: services-map.md 2.6.2 (cache.db holds the local mirror of everything that belongs
 * to a cloud host and is removed with it). Our design choice: one database, so the rows are found
 * by their host columns (D103).
 * Must handle: every table that carries a host is cleared before its workspaces, so a row whose
 * workspace already went is still removed; the local host is refused, because removing it would
 * delete this Mac's own data; a second call changes nothing.
 * Test first: removing a cloud host deletes its rows in every table and leaves local rows alone.
 */
import type { Host } from "@conducted/protocol";
import { appError, err, ok, type Result } from "@conducted/shared";
import type { Database } from "../../platform/platform.ts";
import type { RepositoryDeps } from "./deps.ts";
import { hostFilter } from "./host-rows.ts";
import { executeVoid, inTransaction } from "./row-codec.ts";

/** The tables that carry their workspace's host, plus the workspace table itself. */
const HOST_TABLES = [
	"session_events",
	"session_live_state",
	"sessions",
	"diff_comments",
	"terminals",
	"workspaces",
] as const;

export interface HostCopyRepository {
	/** Deletes every row of `host` in one transaction. The local host is refused. */
	remove(host: Host): Promise<Result<void>>;
}

export function createHostCopyRepository(db: Database, _deps: RepositoryDeps): HostCopyRepository {
	return {
		remove: async (host) => {
			if (host.kind === "local") {
				return err(
					appError("db.invalid_host", "Only a cloud host's rows can be removed as a copy."),
				);
			}
			const filter = hostFilter(host, 1);
			return inTransaction(db, "Removing a cloud host's rows", async (tx) => {
				for (const table of HOST_TABLES) {
					const removed = await executeVoid(
						tx,
						`DELETE FROM ${table} WHERE ${filter.sql}`,
						filter.params,
						`Removing a cloud host's rows from ${table}`,
					);
					if (!removed.ok) return removed;
				}
				return ok(undefined);
			});
		},
	};
}
