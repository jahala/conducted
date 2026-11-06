/**
 * @feature PR-04 Checks tab
 * Owns: the Checks tab body. The PR summary, git status, the checks list with logs, deployments,
 * PR comments and reviewers.
 * Behaviour: ui-map.md 3.6, "Checks" paragraph; services-map.md 3.7.2 (what the poll returns),
 * 3.7.4 (review comments) and 3.7.5 (re-run, failed job log).
 * Data: useGitState (pullRequest, pullRequestUnavailable), useDiffComments (GitHub-origin
 * comments), useActions().pullRequests (rerunFailedChecks, fixErrors, openOnGithub) and comments. The check rows
 * load their own logs through useCheckLog. Reviewers and deployments are fields of PullRequest.
 * "Open on GitHub" opens the pull request's own page; with no pull request, "Create PR" opens
 * GitHub's new pull request page. Resolving a GitHub thread goes through
 * `actions.comments.setResolved`, which resolves it on GitHub (REV-04), and then shows "Comment
 * resolved on GitHub"; unresolving one is refused with the service's message. A failed GitHub
 * sync shows a line above the comments saying they may be out of date. "Hide" sets the comment's
 * state to hidden through `actions.comments.setHidden` (REV-12); hidden and superseded comments
 * are left out of the list, and a sync keeps a hidden GitHub comment hidden.
 * Children: PrSummaryHeader, ChecksList, DeploymentsList, PrCommentsList, ReviewersList.
 * Before a pull request exists the tab shows the workspace's title, its drafted description and "Git
 * status" rows ("No PR open" with Create PR, "N uncommitted changes" with Commit and push, "N commits
 * behind the remote branch" with Pull), measured from Conductor's Checks tab and the owner's capture.
 * Must handle: no PR yet (the Git status rows), PR info loading, offline, no GitHub access
 * (explain how to sign in with `gh auth login`), and a repository without a GitHub remote (the tab
 * says checks need GitHub).
 * Test first: with a PR that has one failed check, the tab shows the failed check and a "Re-run
 * failed checks" button.
 */

import type { CommentId, WorkspaceId } from "@conducted/shared";
import { messageOf } from "@conducted/shared";
import { useState } from "react";
import { useStore } from "zustand";
import { useServices } from "../../../core/context.tsx";
import { useActions, useDiffComments, useGitState, useSetting } from "../../../core/hooks.ts";
import type { GitState, PullRequest } from "../../../core/model.ts";
import type { GitHeaderActionId } from "../../../core/status/git-header.ts";
import { Button } from "../../../ui/Button.tsx";
import { EmptyState } from "../../../ui/EmptyState.tsx";
import { CircleIcon } from "../../../ui/icons.tsx";
import { Skeleton } from "../../../ui/Skeleton.tsx";
import { Spinner } from "../../../ui/Spinner.tsx";
import { toast, toastError } from "../../../ui/Toast.tsx";
import { ChecksList } from "./ChecksList.tsx";
import { DeploymentsList } from "./DeploymentsList.tsx";
import { PrCommentsList } from "./PrCommentsList.tsx";
import { PrSummaryHeader } from "./PrSummaryHeader.tsx";
import { ReviewersList } from "./ReviewersList.tsx";

export interface ChecksTabProps {
	workspaceId: WorkspaceId;
	/** Runs a git header action (Create PR, Commit and push, Pull) from a Git status row. */
	onGitAction?: (action: GitHeaderActionId) => void;
	/** The workspace's title and the pull request description drafted for it, shown above Git status. */
	title?: string;
	description?: string | null;
}

function LoadingChecks() {
	return (
		<div role="status" aria-label="Loading pull request checks" className="space-y-1 p-2">
			<Skeleton className="h-5 w-40" />
			<Skeleton className="h-8 w-full" />
			<Skeleton className="h-8 w-full" />
		</div>
	);
}

export function ChecksTab({ workspaceId, onGitAction, title, description }: ChecksTabProps) {
	const git = useGitState(workspaceId);
	const comments = useDiffComments(workspaceId);
	const actions = useActions();
	const services = useServices().services;
	const syncError = useStore(services.review.store, (state) => state.syncErrors[workspaceId]);
	const optionalBlocking = useSetting<boolean>("treat_optional_checks_as_blocking");

	const [rerunBusy, setRerunBusy] = useState(false);
	const [fixBusy, setFixBusy] = useState(false);

	const refresh = () => {
		void services.git.refresh(workspaceId, "full").then((result) => {
			if (!result.ok) toastError("Couldn't read the git state", result.error);
		});
	};

	/** With no pull request yet, GitHub's page for creating one. */
	const createOnGithub = () => {
		void actions.pullRequests.openOnGithub(workspaceId).then((result) => {
			if (!result.ok) toastError("Couldn't open GitHub", result.error);
		});
	};

	const openPullRequest = (url: string) => {
		void actions.app.openUrl(url).then((result) => {
			if (!result.ok) toastError("Couldn't open GitHub", result.error);
		});
	};

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

	const rerunFailed = async () => {
		if (rerunBusy) return;
		setRerunBusy(true);
		try {
			const reran = await runAction("Couldn't re-run the failed checks", () =>
				actions.pullRequests.rerunFailedChecks(workspaceId),
			);
			if (reran) toast.success("Re-running the failed checks");
		} finally {
			setRerunBusy(false);
		}
	};

	const fixErrors = async () => {
		if (fixBusy) return;
		setFixBusy(true);
		try {
			await runAction("Couldn't send the failing checks", () =>
				actions.pullRequests.fixErrors(workspaceId),
			);
		} finally {
			setFixBusy(false);
		}
	};

	const commentList = comments.state === "ready" ? comments.data : [];
	// A hidden comment leaves the list; a superseded one belongs to an older review.
	const githubComments = commentList.filter(
		(comment) =>
			comment.author.kind === "github" &&
			comment.state !== "hidden" &&
			comment.state !== "superseded",
	);

	const addCommentsToChat = (ids: CommentId[]) => {
		if (ids.length === 0) return;
		void runAction("Couldn't add the comments to the chat", () =>
			actions.comments.sendToChat(workspaceId, ids),
		);
	};

	const resolveComment = (id: CommentId, resolved: boolean) => {
		const onGithub = githubComments.find((entry) => entry.id === id)?.threadId != null;
		void runAction(
			resolved ? "Couldn't resolve the comment" : "Couldn't unresolve the comment",
			() => actions.comments.setResolved(id, resolved),
		).then((done) => {
			if (done && resolved && onGithub) toast.success("Comment resolved on GitHub");
		});
	};

	const hideComment = (id: CommentId) => {
		void runAction("Couldn't hide the comment", () => actions.comments.setHidden(id, true));
	};

	const openComment = (id: CommentId) => {
		const comment = githubComments.find((entry) => entry.id === id);
		if (comment?.remoteUrl == null) {
			toast.error("This comment has no GitHub link.");
			return;
		}
		void actions.app.openUrl(comment.remoteUrl).then((result) => {
			if (!result.ok) toastError("Couldn't open the comment", result.error);
		});
	};

	if (git.state === "loading") return <LoadingChecks />;
	if (git.state === "error") {
		return (
			<EmptyState
				compact
				tone="failed"
				title="Couldn't load the checks."
				body={git.error.message}
				action={
					<Button variant="secondary" onClick={refresh}>
						Try again
					</Button>
				}
			/>
		);
	}

	const pullRequest: PullRequest | null = git.data.pullRequest;
	const unavailable = git.data.pullRequestUnavailable;
	if (pullRequest === null && (unavailable === null || unavailable === "none")) {
		return (
			<GitStatusView
				git={git.data}
				title={title}
				description={description ?? null}
				onGitAction={onGitAction}
				onCreatePr={createOnGithub}
			/>
		);
	}
	if (pullRequest === null) {
		return (
			<div className="flex h-full min-h-0 flex-col overflow-auto">
				<PrSummaryHeader
					pullRequest={null}
					branch={git.data.branch}
					onOpenOnGithub={createOnGithub}
					onCopy={copy}
				/>
				<UnavailableState reason={git.data.pullRequestUnavailable} onRetry={refresh} />
			</div>
		);
	}

	return (
		<div className="flex h-full min-h-0 flex-col overflow-auto">
			<PrSummaryHeader
				pullRequest={pullRequest}
				branch={git.data.branch}
				onOpenOnGithub={() => openPullRequest(pullRequest.url)}
				onCopy={copy}
			/>
			<ChecksList
				workspaceId={workspaceId}
				checks={pullRequest.checks}
				treatOptionalAsBlocking={optionalBlocking}
				rerunBusy={rerunBusy}
				fixBusy={fixBusy}
				onRerunFailed={() => void rerunFailed()}
				onFixErrors={() => void fixErrors()}
				onOpenCheckUrl={(url) => {
					void actions.app.openUrl(url).then((result) => {
						if (!result.ok) toastError("Couldn't open the check", result.error);
					});
				}}
			/>
			<DeploymentsList
				deployments={pullRequest.deployments}
				onOpenUrl={(url) => {
					void actions.app.openUrl(url).then((result) => {
						if (!result.ok) toastError("Couldn't open the deployment", result.error);
					});
				}}
			/>
			{syncError === undefined ? null : (
				<p role="alert" className="px-3 py-1 text-2xs text-warning">
					Couldn't sync comments from GitHub, so they may be out of date. {syncError.message}
				</p>
			)}
			<PrCommentsList
				comments={githubComments}
				onAddToChat={addCommentsToChat}
				onResolve={resolveComment}
				onHide={hideComment}
				onOpenComment={openComment}
			/>
			<ReviewersList
				reviewers={pullRequest.reviewers}
				reviewDecision={pullRequest.reviewDecision}
				canRequestReview={!pullRequest.viewerDidAuthor && pullRequest.viewerCanMerge}
				onRequestReview={(login) => {
					void runAction(`Couldn't request a review from ${login}`, () =>
						actions.pullRequests.requestReview(workspaceId, [login]),
					);
				}}
			/>
		</div>
	);
}

/** A Git status row: an open circle, the sentence, and the action at the right. */
function StatusRow({
	text,
	action,
	onAction,
}: {
	text: string;
	action: string;
	onAction?: () => void;
}) {
	return (
		<li className="flex h-10 items-center gap-2 text-sm text-fg">
			<CircleIcon className="size-4 shrink-0 text-fg-muted" />
			<span className="min-w-0 flex-1 truncate">{text}</span>
			{onAction === undefined ? null : (
				<Button variant="ghost" size="xs" className="shrink-0 text-fg-muted" onClick={onAction}>
					{action}
				</Button>
			)}
		</li>
	);
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/**
 * The Checks tab before a pull request exists, after Conductor: the workspace's title and its drafted
 * description, then "Git status" with what is left to do and the action for each.
 */
function GitStatusView({
	git,
	title,
	description,
	onGitAction,
	onCreatePr,
}: {
	git: GitState;
	title: string | undefined;
	description: string | null;
	onGitAction?: (action: GitHeaderActionId) => void;
	/** Create PR here opens GitHub's new pull request page, as this tab did before. */
	onCreatePr: () => void;
}) {
	const act = (action: GitHeaderActionId) =>
		onGitAction === undefined ? undefined : () => onGitAction(action);
	return (
		<div className="flex h-full min-h-0 flex-col gap-4 overflow-auto px-4 py-3">
			{title === undefined ? null : (
				<div className="flex min-h-0 flex-col gap-1">
					<h2 className="truncate text-sm font-medium text-fg">{title}</h2>
					{description === null || description.trim() === "" ? null : (
						<p className="max-h-60 overflow-auto whitespace-pre-wrap text-xs text-fg-muted select-text">
							{description}
						</p>
					)}
				</div>
			)}
			<section aria-label="Git status">
				<h3 className="mb-1 text-xs text-fg-muted">Git status</h3>
				<ul className="flex flex-col">
					<StatusRow text="No PR open" action="Create PR" onAction={onCreatePr} />
					{git.uncommittedFiles > 0 ? (
						<StatusRow
							text={plural(git.uncommittedFiles, "uncommitted change")}
							action="Commit and push"
							onAction={act("commit_and_push")}
						/>
					) : null}
					{git.sync.behind > 0 ? (
						<StatusRow
							text={`${plural(git.sync.behind, "commit")} behind the remote branch`}
							action="Pull"
							onAction={act("pull")}
						/>
					) : null}
				</ul>
			</section>
		</div>
	);
}

function UnavailableState({
	reason,
	onRetry,
}: {
	reason: GitState["pullRequestUnavailable"];
	onRetry: () => void;
}) {
	if (reason === "loading") {
		return (
			<div className="flex items-center justify-center p-6">
				<Spinner label="Loading pull request info" size="lg" />
			</div>
		);
	}
	if (reason === "offline") {
		return (
			<EmptyState
				compact
				title="You're offline."
				body="Checks will load when the connection returns."
				action={
					<Button variant="secondary" onClick={onRetry}>
						Try again
					</Button>
				}
			/>
		);
	}
	if (reason === "no_github_access") {
		return (
			<EmptyState
				compact
				title="GitHub access required."
				body="Sign in with `gh auth login`, then try again."
				action={
					<Button variant="secondary" onClick={onRetry}>
						Try again
					</Button>
				}
			/>
		);
	}
	if (reason === "not_github") {
		return (
			<EmptyState
				compact
				title="Checks need GitHub."
				body="This repository has no GitHub remote, so there are no checks to show."
			/>
		);
	}
	return (
		<EmptyState
			compact
			title="No pull request yet."
			body="Checks appear once the branch has a pull request on GitHub."
		/>
	);
}
