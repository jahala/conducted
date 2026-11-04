/**
 * @feature REV-01 Git panel tab strip
 * Owns: the tab buttons All files, Changes (with a count badge) and Checks, plus the Review
 * button on the right.
 * Behaviour: ui-map.md 3.6 ("Tab strip" paragraph). Review creates a new chat with a code review
 * prompt (the review itself is REV-05, built in the services).
 * Must handle: a badge that shows a count over 99 as "99+", a Checks tab that shows a dot when a
 * check failed, Review disabled while a review chat is being created, keyboard navigation between
 * tabs with the arrow keys, and an archived workspace (tabs disabled).
 * Test first: with changedCount 3 the Changes tab shows the badge "3".
 */
import { notImplemented } from "@conducted/shared";
import type { GitPanelTab } from "../../core/model.ts";

export interface GitPanelTabsProps {
	active: GitPanelTab;
	onSelect: (tab: GitPanelTab) => void;
	changedCount: number;
	checksFailing: boolean;
	reviewDisabled: boolean;
	onReview: () => void;
	onReviewWithEdit: () => void;
}

export function GitPanelTabs(_props: GitPanelTabsProps): never {
	return notImplemented("REV-01");
}
