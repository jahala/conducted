/**
 * @feature REV-01 GitPanel
 * Owns: right panel, top half. A header (status chip and main action), a tab strip, and the
 * active tab: All files, Changes or Checks. Entry point embedded by the workspace screen.
 * Behaviour: ui-map.md 3.6 (tab strip, header, tabs); frontend layout in structure-map.md 3.2.
 * Data: useGitState, useWorkspaceStatus (agent working), useActions().
 * Children: GitHeader, GitPanelTabs, changes/ChangesTab, files/FilesTab, checks/ChecksTab.
 * The "Artifacts", "Desktop" and "Chat" tabs of Conductor are cloud or team features and are left
 * out.
 * The workspace URL state (workspace/workspace-search.ts) holds `gitTab`, `scope` and the open
 * file. The workspace screen passes them in through the optional props `tab`, `onTabChange`,
 * `scope`, `onScopeChange` and `onOpenFile`. A prop that is left out means the panel keeps that
 * value in its own state (and, without `onOpenFile`, cannot open a file tab).
 * Must handle: git state loading (skeleton header), git state error with retry, archived workspace
 * ("files are not available"), a workspace still initializing, no git status because a rebase or
 * merge is underway ("Finish rebasing or merging to see changes"), keyboard shortcuts for the
 * header actions only while the panel is mounted, and a workspace switch mid-request (only the
 * newest result may change state).
 * Test first: with a GitState of two uncommitted files the header reads "Uncommitted changes" and
 * the main action is "Commit and push".
 */
import type { WorkspaceId } from "@conducted/shared";
import { useEffect, useState } from "react";
import type { DiffScope } from "../../core/api.ts";
import { useServices } from "../../core/context.tsx";
import { useActions, useGitState, useSetting, useWorkspaceStatus } from "../../core/hooks.ts";
import type { GitPanelTab } from "../../core/model.ts";
import { computeGitHeader, type GitHeaderActionId } from "../../core/status/git-header.ts";
import { Button } from "../../ui/Button.tsx";
import { Skeleton } from "../../ui/Skeleton.tsx";
import { toastError } from "../../ui/Toast.tsx";
import { ChangesTab } from "./changes/ChangesTab.tsx";
import { ChecksTab } from "./checks/ChecksTab.tsx";
import { FilesTab } from "./files/FilesTab.tsx";
import { GitHeader } from "./GitHeader.tsx";
import { GitPanelTabs } from "./GitPanelTabs.tsx";
import { ReviewPromptDialog } from "./ReviewPromptDialog.tsx";

export interface GitPanelProps {
	workspaceId: WorkspaceId;
	tab?: GitPanelTab;
	onTabChange?: (tab: GitPanelTab) => void;
	scope?: DiffScope;
	onScopeChange?: (scope: DiffScope) => void;
	/** Opens a file in a center tab, as a diff or in the editor. */
	onOpenFile?: (path: string, mode: "diff" | "edit") => void;
}

const DEFAULT_SCOPE: DiffScope = { kind: "branch" };

function HeaderSkeleton() {
	return (
		<div role="status" aria-label="Loading git state" className="flex h-10 items-center gap-2 px-3">
			<Skeleton className="h-5 w-24" />
			<Skeleton className="ml-auto h-7 w-28" />
		</div>
	);
}

export function GitPanel({
	workspaceId,
	tab: tabProp,
	onTabChange,
	scope: scopeProp,
	onScopeChange,
	onOpenFile,
}: GitPanelProps) {
	const git = useGitState(workspaceId);
	const status = useWorkspaceStatus(workspaceId);
	const actions = useActions();
	const gitService = useServices().services.git;
	const automergeEnabled = useSetting<boolean>("automerge_enabled");
	const optionalChecksBlocking = useSetting<boolean>("treat_optional_checks_as_blocking");

	const [ownTab, setOwnTab] = useState<GitPanelTab>("changes");
	const [ownScope, setOwnScope] = useState<DiffScope>(DEFAULT_SCOPE);
	const [reviewPromptOpen, setReviewPromptOpen] = useState(false);
	const tab = tabProp ?? ownTab;
	const scope = scopeProp ?? ownScope;

	const setTab = (next: GitPanelTab) => {
		if (onTabChange !== undefined) onTabChange(next);
		if (tabProp === undefined) setOwnTab(next);
	};
	const setScope = (next: DiffScope) => {
		if (onScopeChange !== undefined) onScopeChange(next);
		if (scopeProp === undefined) setOwnScope(next);
	};

	// Cmd+Alt+U shows uncommitted changes from anywhere in the panel.
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.metaKey && event.altKey && event.key.toLowerCase() === "u") {
				event.preventDefault();
				setTab("changes");
				setScope({ kind: "uncommitted" });
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	});

	const refresh = () => {
		void gitService.refresh(workspaceId, "full").then((result) => {
			if (!result.ok) toastError("Couldn't read the git state", result.error);
		});
	};

	const openFile = (path: string, mode: "diff" | "edit") => {
		if (onOpenFile !== undefined) {
			onOpenFile(path, mode);
			return;
		}
		void actions.files.open(workspaceId, path, mode, scope).then((result) => {
			if (!result.ok) toastError("Couldn't open the file", result.error);
		});
	};

	const runAction = (action: GitHeaderActionId) => {
		const run = (work: Promise<{ ok: boolean; error?: { message: string } }>, title: string) => {
			void work.then((result) => {
				if (!result.ok && result.error !== undefined) toastError(title, result.error);
			});
		};
		switch (action) {
			case "create_pr":
				run(actions.pullRequests.create(workspaceId), "Couldn't create the pull request");
				break;
			case "commit_and_push":
				run(actions.git.commitAndPush(workspaceId), "Couldn't ask the agent to commit and push");
				break;
			case "pull":
				run(actions.git.pull(workspaceId), "Couldn't pull");
				break;
			case "push":
				run(actions.git.push(workspaceId), "Couldn't push");
				break;
			case "resolve":
				run(actions.git.resolveConflicts(workspaceId), "Couldn't ask the agent to resolve");
				break;
			case "ready_for_review":
				run(actions.pullRequests.markReady(workspaceId), "Couldn't mark the pull request ready");
				break;
			case "fix_errors":
				run(actions.pullRequests.fixErrors(workspaceId), "Couldn't send the failing checks");
				break;
			case "approve":
				run(actions.pullRequests.approve(workspaceId), "Couldn't approve the pull request");
				break;
			case "merge":
			case "merge_stack":
				run(actions.pullRequests.merge(workspaceId), "Couldn't merge the pull request");
				break;
			case "toggle_automerge": {
				const pr = git.state === "ready" ? git.data.pullRequest : null;
				run(
					actions.pullRequests.setAutoMerge(workspaceId, pr === null ? true : !pr.autoMergeEnabled),
					"Couldn't change auto-merge",
				);
				break;
			}
			case "add_comments_to_chat":
				break;
			case "retry":
				refresh();
				break;
		}
	};

	const startReview = (extraInstructions: string | null) => {
		void actions.pullRequests.requestAiReview(workspaceId, extraInstructions).then((result) => {
			if (!result.ok) {
				toastError("Couldn't start the review", result.error);
				return;
			}
			setReviewPromptOpen(false);
		});
	};

	const header = (() => {
		if (git.state === "loading") return <HeaderSkeleton />;
		if (git.state === "error") {
			return (
				<div className="flex h-10 items-center gap-2 border-b border-separator px-3">
					<p className="min-w-0 flex-1 truncate text-sm text-danger">
						Couldn't read the git state.
					</p>
					<Button size="sm" variant="outline" onClick={refresh}>
						Retry
					</Button>
				</div>
			);
		}
		const model = computeGitHeader({
			git: git.data,
			agentWorking: status?.kind === "agent" && status.label === "working",
			forge: git.data.pullRequestUnavailable === "not_github" ? "local" : "github",
			automergeSettingOn: automergeEnabled,
			treatOptionalChecksAsBlocking: optionalChecksBlocking,
			stack: null,
		});
		return <GitHeader model={model} onAction={runAction} />;
	})();

	const changedCount = git.state === "ready" ? git.data.changedFiles : 0;
	const checksFailing =
		git.state === "ready" &&
		git.data.pullRequest !== null &&
		git.data.pullRequest.checks.some((check) => check.state === "failure");

	return (
		<div className="flex h-full min-h-0 flex-col">
			{header}
			<GitPanelTabs
				active={tab}
				onSelect={setTab}
				changedCount={changedCount}
				checksFailing={checksFailing}
				reviewDisabled={changedCount === 0}
				onReview={() => startReview(null)}
				onReviewWithEdit={() => setReviewPromptOpen(true)}
			/>
			<div className="min-h-0 flex-1 overflow-hidden">
				{tab === "files" ? (
					<FilesTab workspaceId={workspaceId} onOpenFile={(path) => openFile(path, "edit")} />
				) : tab === "changes" ? (
					<ChangesTab
						workspaceId={workspaceId}
						scope={scope}
						onScopeChange={setScope}
						onOpenFile={(path) => openFile(path, "diff")}
					/>
				) : (
					<ChecksTab workspaceId={workspaceId} />
				)}
			</div>
			<ReviewPromptDialog
				open={reviewPromptOpen}
				onOpenChange={setReviewPromptOpen}
				onSend={startReview}
			/>
		</div>
	);
}
