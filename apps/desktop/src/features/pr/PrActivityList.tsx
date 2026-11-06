/**
 * @feature PR-07 PR activity list
 * Owns: the Activity section: commits, reviews, comments and status changes of the PR in time
 * order.
 * Behaviour: ui-map.md 3.2 (PR tab: "Activity"); services-map.md 3.7.2 and 3.7.4 for the data
 * available (reviews, review threads, general comments). A sort order setting exists in
 * Conductor (pr_activity_sort_order, newest-first or oldest-first, services-map.md 4.2.3).
 * Children: PrActivityItem. Order logic is in pr-activity.ts.
 * Must handle: empty activity, a long history (older items collapsed behind "Show earlier", with
 * the ten newest always shown first in the chosen order), and a comment from a review thread
 * (shown with its file and line; opening it is the caller's job).
 * Test first: three items render newest first when the order is "newest-first".
 */
import { useState } from "react";
import type { PrActivityEntry } from "../../core/model.ts";
import { Button } from "../../ui/Button.tsx";
import { PrActivityItem } from "./PrActivityItem.tsx";
import { sortActivity } from "./pr-activity.ts";

export interface PrActivityListProps {
	entries: PrActivityEntry[];
	order: "newest-first" | "oldest-first";
	onOpenEntry: (entry: PrActivityEntry) => void;
}

const ALWAYS_SHOWN = 10;

export function PrActivityList({ entries, order, onOpenEntry }: PrActivityListProps) {
	const [showEarlier, setShowEarlier] = useState(false);
	const ordered = sortActivity(entries, order);
	const recentIds = new Set(
		sortActivity(entries, "newest-first")
			.slice(0, ALWAYS_SHOWN)
			.map((entry) => entry.id),
	);
	const visible = showEarlier ? ordered : ordered.filter((entry) => recentIds.has(entry.id));

	if (entries.length === 0) {
		return <p className="px-2 py-3 text-sm text-fg-muted">No activity yet.</p>;
	}

	return (
		<div className="pb-2">
			<ul aria-label="Activity" className="m-0 list-none space-y-0.5 p-0">
				{visible.map((entry) => (
					<li key={entry.id}>
						<PrActivityItem entry={entry} onOpen={() => onOpenEntry(entry)} />
					</li>
				))}
			</ul>
			{showEarlier || entries.length <= ALWAYS_SHOWN ? null : (
				<div className="px-2 pt-1">
					<Button variant="link" size="xs" onClick={() => setShowEarlier(true)}>
						Show earlier
					</Button>
				</div>
			)}
		</div>
	);
}
