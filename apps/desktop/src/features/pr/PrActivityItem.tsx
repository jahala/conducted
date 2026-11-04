/**
 * @feature PR-07 PR activity item
 * Owns: one line or card in the activity list, by entry kind.
 * Behaviour: ui-map.md 3.2 (PR tab: "Activity"); the kinds are listed in pr-activity.ts.
 * Must handle: each kind having its own icon and text, a review with a body (card) versus a bare
 * approval (one line), author avatars missing, and times shown relative with the exact time in a
 * tooltip.
 * Test first: a "review" entry with state "changes_requested" renders the author and that state.
 */
import { notImplemented } from "@conducted/shared";
import type { PrActivityEntry } from "../../core/model.ts";

export interface PrActivityItemProps {
	entry: PrActivityEntry;
	onOpen: () => void;
}

export function PrActivityItem(_props: PrActivityItemProps): never {
	return notImplemented("PR-07");
}
