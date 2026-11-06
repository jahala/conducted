/**
 * @feature PR-07 PR merge bar
 * Owns: the Merge block of the PR tab. Merge, auto-merge, and Mark ready, with the reasons when
 * merging is not possible.
 * Behaviour: ui-map.md 3.2 (PR tab: Merge) and 3.6 (Ready, Draft, Blocked, Unable states);
 * services-map.md 3.7.5 (merge pinned to the local head commit; a mismatch raises "code in this
 * workspace may differ from GitHub"; the merge method comes from the repository: squash, rebase,
 * merge commit).
 * Failing checks follow the Checks tab's rule (`summarizeChecks`): a failing optional check blocks
 * only when "treat optional checks as blocking" is on. Archiving after a merge is the workspace
 * service's (`archive_on_merge`), so the bar says nothing about it.
 * Must handle: draft (Mark ready only), conflicts, failing checks, a head mismatch (the service's
 * explanation, with no merge offered), a generic blocked reason, auto-merge on and off, merge in
 * flight (spinner, no double click), the merge queue, and merged and closed pull requests.
 * Test first: with a head mismatch error the bar shows the explanation and does not retry.
 */
import type { PullRequest } from "../../core/model.ts";
import { GITHUB_HEAD_MISMATCH_MESSAGE } from "../../core/services/github.ts";
import { Button } from "../../ui/Button.tsx";
import { summarizeChecks } from "../git-panel/checks/checks-summary.ts";

export interface PrMergeBarProps {
	pullRequest: PullRequest;
	blockedReason: string | null;
	busy: "merge" | "ready" | "automerge" | null;
	/** The `treat_optional_checks_as_blocking` setting: whether a failing optional check blocks. */
	treatOptionalAsBlocking: boolean;
	onMerge: () => void;
	onMarkReady: () => void;
	onSetAutoMerge: (enabled: boolean) => void;
}

function mergeLabel(method: PullRequest["mergeMethod"]): string {
	switch (method) {
		case "squash":
			return "Squash and merge";
		case "rebase":
			return "Rebase and merge";
		case "merge":
			return "Create a merge commit";
	}
}

export function PrMergeBar({
	pullRequest,
	blockedReason,
	busy,
	treatOptionalAsBlocking,
	onMerge,
	onMarkReady,
	onSetAutoMerge,
}: PrMergeBarProps) {
	const settled = pullRequest.state === "merged" || pullRequest.state === "closed";
	const draft = pullRequest.state === "draft";
	const headMismatch = blockedReason === GITHUB_HEAD_MISMATCH_MESSAGE;
	// The Checks tab's rule: only the checks that block a merge can make it fail.
	const checks = summarizeChecks(pullRequest.checks, { treatOptionalAsBlocking });
	const failing = checks.overall === "failing";
	const conflicting = pullRequest.mergeable === "conflicting";
	const showMerge =
		pullRequest.state === "open" &&
		pullRequest.viewerCanMerge &&
		blockedReason === null &&
		!failing &&
		!conflicting &&
		!pullRequest.inMergeQueue;
	const showAutoMerge =
		pullRequest.state === "open" && pullRequest.viewerCanMerge && blockedReason === null;

	return (
		<div className="px-2 py-2">
			<div className="flex items-center justify-between gap-2">
				<h3 className="text-sm font-medium text-fg">Merge</h3>
				{pullRequest.state === "merged" ? (
					<span className="text-xs text-success">Merged</span>
				) : pullRequest.state === "closed" ? (
					<span className="text-xs text-fg-muted">Closed</span>
				) : null}
			</div>

			{settled ? (
				<p className="mt-1 text-xs text-fg-muted">
					{pullRequest.state === "merged"
						? "This pull request has been merged."
						: "This pull request was closed without merging."}
				</p>
			) : null}

			{draft ? (
				<div className="mt-2 flex items-center gap-2">
					<Button variant="default" size="sm" loading={busy === "ready"} onClick={onMarkReady}>
						Mark ready
					</Button>
					<p className="text-xs text-fg-muted">Draft pull requests cannot be merged.</p>
				</div>
			) : null}

			{settled || draft ? null : (
				<>
					{blockedReason === null ? null : (
						<p role="alert" className="mt-1 text-xs text-danger">
							{blockedReason}
						</p>
					)}
					{conflicting && blockedReason === null ? (
						<p className="mt-1 text-xs text-danger">
							This branch has conflicts that must be resolved before merging.
						</p>
					) : null}
					{failing && blockedReason === null ? (
						<p className="mt-1 text-xs text-danger">
							{checks.failed === 1
								? "1 check failed. Fix it before merging."
								: `${checks.failed} checks failed. Fix them before merging.`}
						</p>
					) : null}
					{pullRequest.inMergeQueue ? (
						<p className="mt-1 text-xs text-fg-muted">This pull request is in the merge queue.</p>
					) : null}

					<div className="mt-2 flex flex-wrap items-center gap-2">
						{showMerge ? (
							<Button variant="default" size="sm" loading={busy === "merge"} onClick={onMerge}>
								{mergeLabel(pullRequest.mergeMethod)}
							</Button>
						) : null}
						{showAutoMerge && !headMismatch ? (
							<Button
								variant="outline"
								size="sm"
								loading={busy === "automerge"}
								onClick={() => onSetAutoMerge(!pullRequest.autoMergeEnabled)}
							>
								{pullRequest.autoMergeEnabled ? "Disable auto-merge" : "Enable auto-merge"}
							</Button>
						) : null}
					</div>
				</>
			)}
		</div>
	);
}
