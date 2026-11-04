/**
 * @feature PR-07 PR activity entries
 * Owns: the pure ordering function for the activity entries (PrActivityEntry, core/model.ts). The
 * entries are built from the GitHub data the services fetch, and `usePullRequestActivity` returns them.
 * Behaviour: ui-map.md 3.2 (PR tab: "Activity"); services-map.md 3.7.2 (reviews and latest
 * reviews) and 3.7.4 (review threads, general comments).
 * Must handle: entries with equal times (stable order by id), entries with no time (sort last),
 * and an empty list.
 * Test first: sortActivity puts the newest first for "newest-first" and keeps equal times in id
 * order.
 */
import { notImplemented } from "@conducted/shared";
import type { PrActivityEntry } from "../../core/model.ts";

export function sortActivity(
	_entries: readonly PrActivityEntry[],
	_order: "newest-first" | "oldest-first",
): PrActivityEntry[] {
	return notImplemented("PR-07");
}
