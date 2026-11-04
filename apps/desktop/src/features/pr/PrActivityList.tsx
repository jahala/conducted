/**
 * @feature PR-07 PR activity list
 * Owns: the Activity section: commits, reviews, comments and status changes of the PR in time
 * order.
 * Behaviour: ui-map.md 3.2 (PR tab: "Activity"); services-map.md 3.7.2 and 3.7.4 for the data
 * available (reviews, review threads, general comments). A sort order setting exists in
 * Conductor (pr_activity_sort_order, newest-first or oldest-first, services-map.md 4.2.3).
 * Children: PrActivityItem. Order logic is in pr-activity.ts.
 * Must handle: empty activity, a long history (older items collapsed behind "show earlier"),
 * comments that come from review threads (shown with file and line, linking to the Comment tab),
 * and the sort order setting changing live.
 * Test first: three items render newest first when the order is "newest-first".
 */
import { notImplemented } from "@conducted/shared";
import type { PrActivityEntry } from "../../core/model.ts";

export interface PrActivityListProps {
	entries: PrActivityEntry[];
	order: "newest-first" | "oldest-first";
	onOpenEntry: (entry: PrActivityEntry) => void;
}

export function PrActivityList(_props: PrActivityListProps): never {
	return notImplemented("PR-07");
}
