/**
 * @feature PR-04 Checks tab
 * Owns: the Checks tab body. The PR summary, git status, the checks list with logs, deployments,
 * PR comments and reviewers.
 * Behaviour: ui-map.md 3.6, "Checks" paragraph; services-map.md 3.7.2 (what the poll returns),
 * 3.7.4 (review comments) and 3.7.5 (re-run, failed job log).
 * Data: useGitState (pullRequest, pullRequestUnavailable), useDiffComments (GitHub-origin
 * comments), useActions().pullRequests (rerunFailedChecks, fixErrors) and comments. The check rows
 * load their own logs through useCheckLog. Reviewers and deployments are fields of PullRequest.
 * "Open on GitHub" opens the pull request's own page; with no pull request, "Create PR" opens
 * GitHub's new pull request page. Resolving a GitHub thread calls REV-04's resolve and shows
 * "Comment resolved on GitHub"; the comments offer no "Hide" until comment states are built
 * (REV-12).
 * Children: PrSummaryHeader, ChecksList, DeploymentsList, PrCommentsList, ReviewersList.
 * Must handle: no PR yet (explain, offer Create PR), PR info loading, offline, no GitHub access
 * (explain how to sign in with `gh auth login`), and a repository without a GitHub remote (the tab
 * says checks need GitHub).
 * Test first: with a PR that has one failed check, the tab shows the failed check and a "Re-run
 * failed checks" button.
 */
import type { CommentId, WorkspaceId } from "@conducted/shared";
import { useState } from "react";
import { useServices } from "../../../core/context.tsx";
import { useActions, useDiffComments, useGitState, useSetting } from "../../../core/hooks.ts";
import type { GitState, PullRequest } from "../../../core/model.ts";
import { Button } from "../../../ui/Button.tsx";
import { EmptyState } from "../../../ui/EmptyState.tsx";
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

export function ChecksTab({ workspaceId }: ChecksTabProps) {
	const git = useGitState(workspaceId);
	const comments = useDiffComments(workspaceId);
	const actions = useActions();
	const services = useServices().services;
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
		void services.github.openOnGithub(workspaceId).then((result) => {
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
			toastError(title, { message: cause instanceof Error ? cause.message : String(cause) });
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
	const githubComments = commentList.filter((comment) => comment.author.kind === "github");

	const addCommentsToChat = (ids: CommentId[]) => {
		if (ids.length === 0) return;
		void runAction("Couldn't add the comments to the chat", () =>
			actions.comments.sendToChat(workspaceId, ids),
		);
	};

	const resolveComment = (id: CommentId, resolved: boolean) => {
		const comment = githubComments.find((entry) => entry.id === id);
		if (resolved && comment?.threadId != null) {
			void services.review.resolveOnGithub(id).then((result) => {
				if (!result.ok) {
					toastError("Couldn't resolve the comment", result.error);
					return;
				}
				toast.success("Comment resolved on GitHub");
			});
			return;
		}
		void runAction("Couldn't resolve the comment", () =>
			actions.comments.setResolved(id, resolved),
		);
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
			<PrCommentsList
				comments={githubComments}
				onAddToChat={addCommentsToChat}
				onResolve={resolveComment}
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
