/**
 * @feature PR-07 PR activity entries
 * Owns: the pure ordering function for the activity entries (PrActivityEntry, core/model.ts). The
 * entries are built from the GitHub data the services fetch, and `usePullRequestActivity` returns them.
 * Behaviour: ui-map.md 3.2 (PR tab: "Activity"); services-map.md 3.7.2 (reviews and latest
 * reviews) and 3.7.4 (review threads, general comments).
 * Must handle: entries with equal times (stable order by id), entries with no usable time (sort
 * last in either order), and an empty list.
 * Test first: sortActivity puts the newest first for "newest-first" and keeps equal times in id
 * order.
 */
import type { PrActivityEntry } from "../../core/model.ts";

const timeOf = (entry: PrActivityEntry): number | null =>
	Number.isFinite(entry.at) ? entry.at : null;

export function sortActivity(
	entries: readonly PrActivityEntry[],
	order: "newest-first" | "oldest-first",
): PrActivityEntry[] {
	return [...entries].sort((left, right) => {
		const leftAt = timeOf(left);
		const rightAt = timeOf(right);
		if (leftAt === null || rightAt === null) {
			if (leftAt === null && rightAt === null) return left.id.localeCompare(right.id);
			return leftAt === null ? 1 : -1;
		}
		if (leftAt !== rightAt) {
			return order === "newest-first" ? rightAt - leftAt : leftAt - rightAt;
		}
		return left.id.localeCompare(right.id);
	});
}
