/**
 * @feature REV-01 Git panel tab strip
 * @feature REV-10 Artifacts tab trigger
 * Owns: the tab buttons Artifacts (when the setting is on), All files, Changes (with a count
 * badge) and Checks, plus the Review button on the right.
 * Behaviour: ui-map.md 3.6 ("Tab strip" paragraph). Review creates a new chat with a code review
 * prompt (the review itself is REV-05, built in the services). The Artifacts trigger appears only
 * while the "Show Artifacts tab" setting is on.
 * Must handle: a badge that shows a count over 99 as "99+", a Checks tab that shows a dot when a
 * check failed, Review disabled while a review chat is being created or when there is nothing to
 * review, keyboard navigation between tabs with the arrow keys, and no Artifacts tab when the
 * setting is off.
 * Test first: with changedCount 3 the Changes tab shows the badge "3".
 */
import type { GitPanelTab } from "../../core/model.ts";
import { Tabs, TabsList, TabsTrigger } from "../../ui/Tabs.tsx";
import { ReviewButton } from "./ReviewButton.tsx";

/** The existing URL-backed tabs plus the Artifacts tab, which the panel keeps itself. */
export type GitPanelViewTab = GitPanelTab | "artifacts";

export interface GitPanelTabsProps {
	active: GitPanelViewTab;
	onSelect: (tab: GitPanelViewTab) => void;
	/** The "Show Artifacts tab" setting. Defaults to off for a bare tab strip. */
	showArtifacts?: boolean;
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
	showArtifacts = false,
	changedCount,
	checksFailing,
	reviewDisabled,
	reviewDisabledReason = null,
	onReview,
	onReviewWithEdit,
}: GitPanelTabsProps) {
	return (
		<Tabs value={active} onValueChange={(value) => onSelect(value as GitPanelViewTab)}>
			<div className="flex shrink-0 items-center justify-between gap-2 border-b border-separator pr-2">
				<TabsList className="gap-1 border-b-0 font-normal">
					{showArtifacts ? (
						<TabsTrigger variant="pill" value="artifacts">
							Artifacts
						</TabsTrigger>
					) : null}
					<TabsTrigger variant="pill" value="files">
						All files
					</TabsTrigger>
					<TabsTrigger variant="pill" value="changes">
						Changes
						<span className="font-mono text-xs text-fg-muted">{countLabel(changedCount)}</span>
					</TabsTrigger>
					<TabsTrigger variant="pill" value="checks">
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
