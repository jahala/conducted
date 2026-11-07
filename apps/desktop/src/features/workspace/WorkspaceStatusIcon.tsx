/**
 * @feature NAV-03 Workspace status icon
 * Owns: the small icon at the start of a sidebar row, Home card and tab that shows the derived status.
 * Behaviour: ui-map.md 3.8 (row icon: typing loader, waiting loader, setting-up loader, or a mark for
 * the status). Conductor's renderApp draws one mark per status and no dots: a clipboard for a plan to
 * review, an alert for a permission or a failure, a question for a question, pull request and merge
 * marks for the pull request states, a cross for failing checks, a circle for an unstarted workspace
 * and the branch glyph for the rest. Failures and failing checks are red, a mergeable pull request
 * green, a merged one in the merged colour, the merge queue and running checks in the progress colour,
 * the rest muted.
 * Our design choice: the marks are our own line icons (ui/icons.tsx) in Conductor's shapes; a
 * workspace that is archiving keeps a spinner. The optional animated "status matrix" for working
 * local workspaces is left out (WS-09).
 * Must handle: a caller that names the status itself (the sidebar row names it on the icon's box, a card
 * prints it) passes `decorative`, so 300 rows are not 300 live regions; without it an active status is
 * announced as a status role; an unknown status (null) shows the branch glyph.
 * Test first: renders a status role for an active status and an aria-hidden mark otherwise; each
 * settled status draws its mark in its colour.
 */

import type { ComponentType, SVGProps } from "react";
import type { WorkspaceStatus } from "../../core/model.ts";
import { cn } from "../../ui/cn.ts";
import {
	AlertCircleIcon,
	CircleIcon,
	ClipboardListIcon,
	CloseIcon,
	GitBranchIcon,
	GitMergeIcon,
	HelpCircleIcon,
	PullRequestIcon,
} from "../../ui/icons.tsx";
import { Spinner, type SpinnerKind } from "../../ui/Spinner.tsx";
import { statusText } from "./status-text.ts";

function spinnerKind(status: WorkspaceStatus | null): SpinnerKind {
	if (status?.kind === "lifecycle" && status.label === "setting_up") return "setting-up";
	if (status?.kind === "agent" && status.label === "working") return "typing";
	if (status?.kind === "agent" && status.label === "waiting") return "waiting";
	return "working";
}

interface Mark {
	name: string;
	Icon: ComponentType<SVGProps<SVGSVGElement>>;
	colour: string;
}

const MUTED = "text-fg-muted";

/** Conductor's mark for a status that is not a loader. */
function markOf(status: WorkspaceStatus | null): Mark {
	const branch = { name: "branch", Icon: GitBranchIcon, colour: "text-fg-subtle" };
	if (status === null) return branch;
	switch (status.kind) {
		case "lifecycle":
			if (status.label === "unstarted")
				return { name: "unstarted", Icon: CircleIcon, colour: MUTED };
			if (status.label === "failed") {
				return { name: "alert", Icon: AlertCircleIcon, colour: "text-danger" };
			}
			return branch;
		case "agent":
			if (status.label === "needs_plan_review") {
				return { name: "plan", Icon: ClipboardListIcon, colour: MUTED };
			}
			if (status.label === "needs_permission") {
				return { name: "alert", Icon: AlertCircleIcon, colour: MUTED };
			}
			if (status.label === "needs_answer") {
				return { name: "question", Icon: HelpCircleIcon, colour: MUTED };
			}
			return branch;
		case "git":
			switch (status.label) {
				case "merged":
					return { name: "merged", Icon: GitMergeIcon, colour: "text-merged" };
				case "in_merge_queue":
					return { name: "merge-queue", Icon: GitMergeIcon, colour: "text-status-progress" };
				case "ready_to_merge":
					return { name: "pull-request", Icon: PullRequestIcon, colour: "text-success" };
				case "merge_conflict":
					return { name: "merge-conflict", Icon: PullRequestIcon, colour: "text-accent" };
				case "checks_failing":
					return { name: "checks-failing", Icon: CloseIcon, colour: "text-danger" };
				case "checks_running":
					return { name: "pull-request", Icon: PullRequestIcon, colour: "text-status-progress" };
				case "draft_pr":
				case "pr_open":
					return { name: "pull-request", Icon: PullRequestIcon, colour: MUTED };
				default:
					return branch;
			}
	}
}

/** The loaders Conductor keeps for work in progress; every other status draws its mark. */
function isLoader(status: WorkspaceStatus | null): boolean {
	if (status === null) return false;
	if (status.kind === "agent") {
		return (
			status.label === "working" || status.label === "cancelling" || status.label === "waiting"
		);
	}
	if (status.kind === "lifecycle") {
		return (
			status.label === "initializing" ||
			status.label === "setting_up" ||
			status.label === "archiving"
		);
	}
	return false;
}

export function WorkspaceStatusIcon({
	status,
	decorative = false,
}: {
	status: WorkspaceStatus | null;
	/** True when the caller names the status itself, so the icon adds nothing to announce. */
	decorative?: boolean;
}) {
	if (isLoader(status)) {
		const spinner = (
			<Spinner
				label={statusText(status).text}
				kind={spinnerKind(status)}
				size="sm"
				className="text-fg-muted"
			/>
		);
		return decorative ? <span aria-hidden="true">{spinner}</span> : spinner;
	}
	const { name, Icon, colour } = markOf(status);
	return (
		<span aria-hidden="true" data-mark={name} className={cn("flex", colour)}>
			<Icon className="size-3.5" />
		</span>
	);
}
