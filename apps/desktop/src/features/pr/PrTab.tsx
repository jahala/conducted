/**
 * @feature PR-07 PrTab
 * Owns: a center tab for the workspace's pull request: the title with its "Edit PR title" dialog,
 * the "#<number>" link that opens the pull request where "Open pull requests in" says (with its
 * right-click menu), the description, activity, checks, review state and merge. Entry point
 * embedded by the workspace tab strip.
 * Behaviour: ui-map.md 3.2, "Tab content: PR" (PR title editable, Description, Activity, Checks,
 * Review, Merge, Open on GitHub); services-map.md 3.7 (read, edit with `gh pr edit`, merge).
 * Data: useGitState (pullRequest and why it may be missing), useWorkspace (whether the workspace
 * is archived), useActions().pullRequests, usePullRequestActivity (sorted by pr/pr-activity.ts),
 * and the pr_activity_sort_order and treat_optional_checks_as_blocking settings. Reviewers, deployments and viewer
 * rights are fields of PullRequest.
 * Children: PrTitleEditor, PrDescriptionEditor, PrLevelComments, PrActivityList, PrChecksSummary,
 * PrReviewSection, PrMergeBar, PrEmptyState.
 * The Checks summary's "View checks" opens the pull request's checks page on GitHub, because the
 * center tab cannot change the git panel's tab. Opening a comment in the activity list sets the
 * workspace URL to the Comment tab.
 * Must handle: no PR yet (empty state with Create PR), PR info loading, offline, no GitHub access,
 * a repository without a GitHub remote, a merged or closed PR (read-only, no merge), a draft PR
 * (Mark ready first), and an archived workspace. Cmd+Shift+G is the Git panel's (it opens the
 * pull request from anywhere in the workspace).
 * Test first: with a PR in state "draft" the merge bar shows "Mark ready" and no Merge button.
 */
import type { WorkspaceId } from "@conducted/shared";
import { messageOf } from "@conducted/shared";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useServices } from "../../core/context.tsx";
import {
	useActions,
	useGitState,
	usePullRequestActivity,
	useSetting,
	useWorkspace,
} from "../../core/hooks.ts";
import type { PrActivityEntry, PullRequest } from "../../core/model.ts";
import { isArchivedWorkspace } from "../../core/status/archived.ts";
import { Badge, type BadgeTone } from "../../ui/Badge.tsx";
import { toast, toastError } from "../../ui/Toast.tsx";
import { PrActivityList } from "./PrActivityList.tsx";
import { PrChecksSummary } from "./PrChecksSummary.tsx";
import { PrDescriptionEditor } from "./PrDescriptionEditor.tsx";
import { type PrEmptyKind, PrEmptyState } from "./PrEmptyState.tsx";
import { isPrLevelComment, PrLevelComments } from "./PrLevelComments.tsx";
import { PrMergeBar } from "./PrMergeBar.tsx";
import { PrNumberLink } from "./PrNumberLink.tsx";
import { PrReviewSection } from "./PrReviewSection.tsx";
import { PrTitleEditor } from "./PrTitleEditor.tsx";
import { openTargetOf } from "./pr-open-target.ts";

const STATE_LABEL: Readonly<Record<PullRequest["state"], string>> = {
	open: "Open",
	draft: "Draft",
	merged: "Merged",
	closed: "Closed",
};

const STATE_TONE: Readonly<Record<PullRequest["state"], BadgeTone>> = {
	open: "success",
	draft: "neutral",
	merged: "success",
	closed: "neutral",
};

function emptyKind(pullRequest: PullRequest | null, unavailable: string | null): PrEmptyKind {
	if (pullRequest !== null) return "no_pr";
	switch (unavailable) {
		case "loading":
			return "loading";
		case "offline":
			return "offline";
		case "no_github_access":
			return "no_github_access";
		case "not_github":
			return "not_github";
		case "none":
		case null:
			return "no_pr";
		default:
			return "unavailable";
	}
}

export function PrTab({ workspaceId }: { workspaceId: WorkspaceId }) {
	const git = useGitState(workspaceId);
	const workspace = useWorkspace(workspaceId);
	const activity = usePullRequestActivity(workspaceId);
	const actions = useActions();
	const { services } = useServices();
	const navigate = useNavigate();
	const activityOrder = useSetting<"newest-first" | "oldest-first">("pr_activity_sort_order");
	const optionalBlocking = useSetting<boolean>("treat_optional_checks_as_blocking");
	const openTarget = openTargetOf(useSetting<string>("pull_request_open_target"));

	const [blockedReason, setBlockedReason] = useState<string | null>(null);

	const refresh = () => {
		void services.git.refresh(workspaceId, "full").then((result) => {
			if (!result.ok) toastError("Couldn't read the pull request", result.error);
		});
	};

	const openUrl = (url: string) => {
		void actions.app.openUrl(url).then((result) => {
			if (!result.ok) toastError("Couldn't open the link", result.error);
		});
	};

	const pullRequest = git.state === "ready" ? git.data.pullRequest : null;

	const copy = (text: string) => {
		void actions.app.copyText(text).then((result) => {
			if (!result.ok) toastError("Couldn't copy the text", result.error);
		});
	};

	const runAction = async (
		title: string,
		work: () => Promise<{ ok: boolean; error?: { message: string } }>,
	): Promise<boolean> => {
		try {
			const result = await work();
			if (!result.ok) {
				toastError(title, result.error ?? { message: title });
			}
			return result.ok;
		} catch (cause) {
			toastError(title, { message: messageOf(cause) });
			return false;
		}
	};

	const theTitle = pullRequest?.title ?? "";
	const theBody = pullRequest?.body ?? "";

	const saveTitle = async (next: string): Promise<boolean> =>
		runAction("Couldn't save the title", () =>
			actions.pullRequests.updateTitleAndBody(workspaceId, next, theBody),
		);

	const saveDescription = async (next: string): Promise<boolean> =>
		runAction("Couldn't save the description", () =>
			actions.pullRequests.updateTitleAndBody(workspaceId, theTitle, next),
		);

	const merge = async () => {
		setBlockedReason(null);
		const result = await actions.pullRequests.merge(workspaceId);
		if (!result.ok) {
			setBlockedReason(result.error.message);
			toastError("Couldn't merge the pull request", result.error);
			return;
		}
		toast.success("Merged the pull request");
	};

	const markReady = async () => {
		await runAction("Couldn't mark the pull request ready", () =>
			actions.pullRequests.markReady(workspaceId),
		);
	};

	const setAutoMerge = async (enabled: boolean) => {
		await runAction(enabled ? "Couldn't enable auto-merge" : "Couldn't disable auto-merge", () =>
			actions.pullRequests.setAutoMerge(workspaceId, enabled),
		);
	};

	const approve = async () => {
		await runAction("Couldn't approve the pull request", () =>
			actions.pullRequests.approve(workspaceId),
		);
	};

	const requestReview = async (login: string) => {
		const asked = await runAction("Couldn't request a review", () =>
			actions.pullRequests.requestReview(workspaceId, [login]),
		);
		if (asked) toast.success(`Asked ${login} for a review`);
	};

	const removeReview = async (login: string) => {
		const removed = await runAction("Couldn't remove the reviewer", () =>
			actions.pullRequests.removeReviewRequest(workspaceId, login),
		);
		if (removed) toast.success(`Removed ${login} from the reviewers`);
	};

	const openActivity = (entry: PrActivityEntry) => {
		if (entry.kind === "comment" && entry.commentId !== null) {
			void navigate({
				search: ((previous: Record<string, unknown>) => ({
					...previous,
					tab: "comment",
					commentId: entry.commentId,
				})) as never,
			});
			return;
		}
		if (entry.kind === "commit" && pullRequest !== null) {
			openUrl(`${pullRequest.url}/commits/${entry.sha}`);
			return;
		}
		if (pullRequest !== null) openUrl(pullRequest.url);
	};

	if (git.state === "loading") {
		return <PrEmptyState kind="loading" onAction={() => {}} />;
	}
	if (git.state === "error") {
		return (
			<PrEmptyState
				kind="unavailable"
				onAction={() => {
					refresh();
				}}
			/>
		);
	}
	if (pullRequest === null) {
		const kind = emptyKind(null, git.data.pullRequestUnavailable);
		const onAction =
			kind === "no_pr"
				? () => {
						void actions.pullRequests.openOnGithub(workspaceId).then((result) => {
							if (!result.ok) toastError("Couldn't open GitHub", result.error);
						});
					}
				: kind === "no_github_access"
					? () => {
							void actions.app.recheckGitHubAccess().then((result) => {
								if (!result.ok) toastError("Couldn't check GitHub access", result.error);
							});
						}
					: () => {
							refresh();
						};
		return <PrEmptyState kind={kind} onAction={onAction} />;
	}

	const archived = workspace.state === "ready" && isArchivedWorkspace(workspace.data);
	const editable = !archived && (pullRequest.state === "open" || pullRequest.state === "draft");
	const pending = git.data.pendingPullRequestAction;
	const busy =
		pending === "merging"
			? "merge"
			: pending === "marking_ready"
				? "ready"
				: pending === "enabling_auto_merge" || pending === "disabling_auto_merge"
					? "automerge"
					: null;

	return (
		<div className="flex h-full min-h-0 flex-col overflow-auto">
			<section aria-label="Pull request" className="border-b border-separator px-3 py-3">
				<div className="flex items-start gap-2">
					<div className="min-w-0 flex-1">
						<PrTitleEditor title={pullRequest.title} editable={editable} onSave={saveTitle} />
					</div>
					<PrNumberLink
						prUrl={pullRequest.url}
						prNumber={pullRequest.number}
						target={openTarget}
						onOpen={openUrl}
						onCopy={copy}
					/>
					<Badge tone={STATE_TONE[pullRequest.state]}>{STATE_LABEL[pullRequest.state]}</Badge>
				</div>
			</section>

			<section aria-label="Description" className="border-b border-separator py-2">
				<h3 className="px-2 pb-1 text-sm font-medium text-fg">Description</h3>
				<PrDescriptionEditor body={pullRequest.body} editable={editable} onSave={saveDescription} />
			</section>

			{activity.state === "ready" ? <PrLevelComments entries={activity.data} /> : null}

			<section aria-label="Activity" className="border-b border-separator py-2">
				<h3 className="px-2 pb-1 text-sm font-medium text-fg">Activity</h3>
				{activity.state === "loading" ? (
					<p className="px-2 py-1 text-sm text-fg-muted">Loading activity...</p>
				) : activity.state === "error" ? (
					<p role="alert" className="px-2 py-1 text-sm text-danger">
						Couldn't load the activity. {activity.error.message}
					</p>
				) : (
					<PrActivityList
						entries={activity.data.filter((entry) => !isPrLevelComment(entry))}
						order={activityOrder}
						onOpenEntry={openActivity}
					/>
				)}
			</section>

			<section aria-label="Checks" className="border-b border-separator">
				<h3 className="px-2 pt-2 text-sm font-medium text-fg">Checks</h3>
				<PrChecksSummary
					checks={pullRequest.checks}
					onShowDetails={() => openUrl(`${pullRequest.url}/checks`)}
				/>
			</section>

			<section aria-label="Review" className="border-b border-separator">
				<PrReviewSection
					pullRequest={pullRequest}
					approveBusy={pending === "approving"}
					onApprove={() => void approve()}
					onRequestReview={(login) => void requestReview(login)}
					onRemoveReview={(login) => void removeReview(login)}
				/>
			</section>

			<section aria-label="Merge">
				<PrMergeBar
					pullRequest={pullRequest}
					blockedReason={blockedReason}
					busy={busy}
					treatOptionalAsBlocking={optionalBlocking}
					onMerge={() => void merge()}
					onMarkReady={() => void markReady()}
					onSetAutoMerge={(enabled) => void setAutoMerge(enabled)}
				/>
			</section>
		</div>
	);
}
