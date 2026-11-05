/**
 * @feature REV-01 Git panel tab strip
 * Owns: the tab buttons All files, Changes (with a count badge) and Checks, plus the Review
 * button on the right.
 * Behaviour: ui-map.md 3.6 ("Tab strip" paragraph). Review creates a new chat with a code review
 * prompt (the review itself is REV-05, built in the services).
 * Must handle: a badge that shows a count over 99 as "99+", a Checks tab that shows a dot when a
 * check failed, Review disabled while a review chat is being created or when there is nothing to
 * review, and keyboard navigation between tabs with the arrow keys.
 * Test first: with changedCount 3 the Changes tab shows the badge "3".
 */
import type { GitPanelTab } from "../../core/model.ts";
import { Badge } from "../../ui/Badge.tsx";
import { Tabs, TabsList, TabsTrigger } from "../../ui/Tabs.tsx";
import { ReviewButton } from "./ReviewButton.tsx";

export interface GitPanelTabsProps {
	active: GitPanelTab;
	onSelect: (tab: GitPanelTab) => void;
	changedCount: number;
	checksFailing: boolean;
	reviewDisabled: boolean;
	/** The reason the Review button is disabled, or null when it can be pressed. */
	reviewDisabledReason?: string | null;
	onReview: () => void;
	onReviewWithEdit: () => void;
}

const countLabel = (count: number): string => (count > 99 ? "99+" : String(count));

export function GitPanelTabs({
	active,
	onSelect,
	changedCount,
	checksFailing,
	reviewDisabled,
	reviewDisabledReason = null,
	onReview,
	onReviewWithEdit,
}: GitPanelTabsProps) {
	return (
		<Tabs value={active} onValueChange={(value) => onSelect(value as GitPanelTab)}>
			<div className="flex shrink-0 items-center justify-between gap-2 border-b border-separator pr-2">
				<TabsList className="border-b-0">
					<TabsTrigger value="files">All files</TabsTrigger>
					<TabsTrigger value="changes">
						Changes
						{changedCount > 0 ? <Badge>{countLabel(changedCount)}</Badge> : null}
					</TabsTrigger>
					<TabsTrigger value="checks">
						Checks
						{checksFailing ? (
							<span
								role="img"
								aria-label="A check failed"
								className="size-1.5 rounded-full bg-danger"
							/>
						) : null}
					</TabsTrigger>
				</TabsList>
				<ReviewButton
					disabled={reviewDisabled}
					disabledReason={reviewDisabled ? reviewDisabledReason : null}
					onReview={onReview}
					onReviewWithEdit={onReviewWithEdit}
				/>
			</div>
		</Tabs>
	);
}
