/**
 * @feature REV-01 Git panel tab strip
 * @feature REV-10 Artifacts tab trigger
 * Owns: the tab buttons Artifacts (when the setting is on), All files, Changes (with a count
 * badge) and Checks, plus the Review button and the open tab's own buttons on the right. The tabs
 * scroll sideways when the panel is too narrow, so Review and the buttons stay whole
 * (scripts/catalogue/git-tabs.browser.ts).
 * Behaviour: ui-map.md 3.6 ("Tab strip" paragraph). Review creates a new chat with a code review
 * prompt (the review itself is REV-05, built in the services). The Artifacts trigger appears only
 * while the "Show Artifacts tab" setting is on.
 * Must handle: a badge that shows a count over 99 as "99+", a Checks tab that shows a dot when a
 * check failed, Review disabled while a review chat is being created or when there is nothing to
 * review, keyboard navigation between tabs with the arrow keys, and no Artifacts tab when the
 * setting is off.
 * Test first: with changedCount 3 the Changes tab shows the badge "3".
 */
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
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
	/** The open tab's own buttons, right of Review, such as All files' working directories. */
	actions?: ReactNode;
}

const countLabel = (count: number): string => (count > 99 ? "99+" : String(count));

/** Conductor's fade on a side the tabs scroll past (renderApp `kKe`): clear for 8px, solid by 40px. */
function fadeMask(left: boolean, right: boolean): string | undefined {
	if (left && right) {
		return "linear-gradient(to right, transparent 8px, black 40px, black calc(100% - 40px), transparent calc(100% - 8px))";
	}
	if (left) return "linear-gradient(to right, transparent 8px, black 40px)";
	if (right)
		return "linear-gradient(to right, black calc(100% - 40px), transparent calc(100% - 8px))";
	return undefined;
}

/** Which sides of the tab scroller hide tabs, kept as it scrolls or resizes. */
function useOverflowSides() {
	const ref = useRef<HTMLDivElement>(null);
	const [sides, setSides] = useState({ left: false, right: false });
	const measure = () => {
		const node = ref.current;
		if (node === null) return;
		const left = node.scrollLeft > 1;
		const right = node.scrollLeft + node.clientWidth < node.scrollWidth - 1;
		setSides((old) => (old.left === left && old.right === right ? old : { left, right }));
	};
	// biome-ignore lint/correctness/useExhaustiveDependencies: measure reads only the ref and a stable setter.
	useLayoutEffect(() => {
		const node = ref.current;
		if (node === null || typeof ResizeObserver === "undefined") return;
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(node);
		if (node.firstElementChild !== null) observer.observe(node.firstElementChild);
		return () => observer.disconnect();
	}, []);
	return { ref, sides, measure };
}

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
	actions,
}: GitPanelTabsProps) {
	const scroller = useOverflowSides();
	const mask = fadeMask(scroller.sides.left, scroller.sides.right);
	return (
		<Tabs value={active} onValueChange={(value) => onSelect(value as GitPanelViewTab)}>
			{/* Conductor's strip (renderApp `POs` @2553124): the tabs take the room left and scroll
			    sideways when it runs out, and Review with the tab's buttons never shrinks. Our TabsList
			    keeps its width and clips, which pushed Review past the panel's edge. */}
			<div className="flex min-w-0 shrink-0 items-center gap-2 overflow-hidden border-b border-separator pr-2">
				<div
					ref={scroller.ref}
					className="flex min-w-0 flex-1 overflow-x-auto [scrollbar-width:none]"
					style={mask === undefined ? undefined : { maskImage: mask, WebkitMaskImage: mask }}
					onScroll={scroller.measure}
					// A mouse wheel scrolls the tabs sideways, as Conductor's strip does.
					onWheel={(event) => {
						if (event.deltaY !== 0 && event.deltaX === 0) {
							event.currentTarget.scrollLeft += event.deltaY;
						}
					}}
				>
					<TabsList className="max-w-none! gap-1 overflow-visible! border-b-0 font-normal">
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
				</div>
				<div className="flex shrink-0 items-center gap-1">
					<ReviewButton
						disabled={reviewDisabled}
						disabledReason={reviewDisabled ? reviewDisabledReason : null}
						onReview={onReview}
						onReviewWithEdit={onReviewWithEdit}
					/>
					{actions}
				</div>
			</div>
		</Tabs>
	);
}
