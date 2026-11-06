/**
 * @feature REV-01 GitPanel
 * @feature GIT-06 Cmd+Shift+L and the pull outcome toasts
 * @feature PR-05 Cmd+Shift+X sends the failing checks to the agent
 * @feature PR-06 Cmd+Shift+M merges the pull request
 * @feature GIT-17 Continue after a merge or from a detached HEAD
 * @feature GIT-14 Local-git forge: header state and the merge request to the agent
 * Owns: right panel, top half. A header (status chip and main action), a tab strip, and the
 * active tab: Artifacts (when its setting is on), All files, Changes or Checks. Entry point
 * embedded by the workspace screen.
 * Behaviour: ui-map.md 3.6 (tab strip, header, tabs), 5.4 (Cmd+Shift+X fix errors); frontend
 * layout in structure-map.md 3.2.
 * Data: useGitState, useWorkspaceStatus (agent working), useActions().
 * Children: GitHeader, GitPanelTabs, artifacts/ArtifactsTab, changes/ChangesTab, files/FilesTab,
 * checks/ChecksTab. Each unbuilt tab body sits in its own NotBuiltYet boundary, keyed by the tab,
 * so a tab that is not built or fails shows which feature it is while the header and the tab strip
 * stay usable. The Checks tab is marked failing when a check that blocks the merge failed
 * (checks-summary.ts, the header's rule). The Artifacts tab is kept by the panel itself, not by the
 * workspace URL, so the URL's `gitTab` still holds only the three tabs it already had. Any tab
 * change leaves Artifacts: choosing a tab, Cmd+Alt+U, and a URL that sets `gitTab` or `scope`. The
 * "Desktop" and "Chat" tabs of Conductor are cloud or team features and are left out.
 * The workspace URL state (workspace/workspace-search.ts) holds `gitTab`, `scope` and the open
 * file. The workspace screen passes them in through the optional props `tab`, `onTabChange`,
 * `scope`, `onScopeChange` and `onOpenFile`. A prop that is left out means the panel keeps that
 * value in its own state (and, without `onOpenFile`, cannot open a file tab).
 * Must handle: git state loading (skeleton header), git state error with retry, no git status
 * because a rebase or merge is underway (the Changes tab says so), the commands "Create PR",
 * "Commit and push", "Start an AI code review" and "Show uncommitted changes" handled only while
 * the panel is mounted, through the command dispatcher so a rebind applies, "Commit and push",
 * "Merge the pull request" (Cmd+Shift+M) and "Fix errors" (Cmd+Shift+X) only while the header
 * offers that action, one review request at a time per workspace, and a
 * workspace switch mid-request (the old request's result does not touch the new workspace's
 * dialog), and one header action at a time per workspace and action: the header button and the
 * Cmd+Shift+P, Cmd+Shift+Y, Cmd+Shift+L, Cmd+Shift+M and Cmd+Shift+X shortcuts share one
 * single-flight guard, so a second key press or click while the action runs is ignored. The
 * computed header offers Continue for a merged pull request or a detached HEAD. A Continue that
 * changed the branch but failed afterwards (the note, or saving the branch) still reads the git
 * state again, so the header stops offering it; whether the workspace already continued is the
 * git service's state, so a remount does not offer it again.
 * Test first: with a GitState of two uncommitted files the header reads "Uncommitted changes" and
 * the main action is "Commit and push".
 */
import type { WorkspaceId } from "@conducted/shared";
import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { useCommandHandler } from "../../app/command-dispatcher.ts";
import type { DiffScope } from "../../core/api.ts";
import { createSingleFlight } from "../../core/async/single-flight.ts";
import { useServices } from "../../core/context.tsx";
import {
	useActions,
	useGitState,
	useSetting,
	useWorkspace,
	useWorkspaceStatus,
} from "../../core/hooks.ts";
import type { GitPanelTab } from "../../core/model.ts";
import {
	CONTINUE_NOTE_FAILED_MESSAGE,
	PULL_UP_TO_DATE_MESSAGE,
	PULLED_LATEST_MESSAGE,
} from "../../core/services/git.ts";
import { forgeForRemoteUrl } from "../../core/services/github.ts";
import { capabilitiesFor } from "../../core/services/local-git-forge.ts";
import {
	computeGitHeader,
	type GitHeaderActionId,
	type GitHeaderInputs,
} from "../../core/status/git-header.ts";
import { Button } from "../../ui/Button.tsx";
import { NotBuiltYet } from "../../ui/not-built-yet.tsx";
import { Skeleton } from "../../ui/Skeleton.tsx";
import { toast, toastError } from "../../ui/Toast.tsx";
import { ArtifactsTab } from "./artifacts/ArtifactsTab.tsx";
import { ChangesTab } from "./changes/ChangesTab.tsx";
import { ChecksTab } from "./checks/ChecksTab.tsx";
import { summarizeChecks } from "./checks/checks-summary.ts";
import { FilesTab } from "./files/FilesTab.tsx";
import { GitHeader } from "./GitHeader.tsx";
import { GitPanelTabs, type GitPanelViewTab } from "./GitPanelTabs.tsx";
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

/** The header for a loaded git state. The model comes from computeGitHeader. */
function ComputedHeader({
	inputs,
	onAction,
}: {
	inputs: GitHeaderInputs;
	onAction: (action: GitHeaderActionId) => Promise<void>;
}) {
	const computed = computeGitHeader(inputs);
	// "Add all comments to chat" needs the review comment store (REV-03). Until it exists,
	// offer no button rather than one that silently does nothing.
	const model =
		computed.action?.id === "add_comments_to_chat" ? { ...computed, action: null } : computed;
	return <GitHeader model={model} onAction={onAction} />;
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
	const { services } = useServices();
	const gitService = services.git;
	const localGitForge = services.localGitForge;
	const localForgeEnabled = useSetting<boolean>("local_git_forge_enabled") === true;
	const workspace = useWorkspace(workspaceId);
	const repoRemoteUrl = useStore(services.repo.store, (state) =>
		workspace.state === "ready"
			? (state.reposById[workspace.data.repoId]?.remoteUrl ?? null)
			: undefined,
	);
	const automergeEnabled = useSetting<boolean>("automerge_enabled");
	const optionalChecksBlocking = useSetting<boolean>("treat_optional_checks_as_blocking");
	const artifactsTabEnabled = useSetting<boolean>("artifacts_tab_enabled");

	const [ownTab, setOwnTab] = useState<GitPanelTab>("changes");
	const [showArtifacts, setShowArtifacts] = useState(false);
	const [ownScope, setOwnScope] = useState<DiffScope>(DEFAULT_SCOPE);
	const [reviewPromptOpen, setReviewPromptOpen] = useState(false);
	const [reviewingFor, setReviewingFor] = useState<WorkspaceId | null>(null);
	const [reviewFlight] = useState(() => createSingleFlight());
	const [actionFlight] = useState(() => createSingleFlight());
	const currentWorkspace = useRef(workspaceId);
	currentWorkspace.current = workspaceId;
	const reviewBusy = reviewingFor === workspaceId;
	const tab = tabProp ?? ownTab;
	const artifactsVisible = artifactsTabEnabled === true && showArtifacts;
	const view: GitPanelViewTab = artifactsVisible ? "artifacts" : tab;
	const scope = scopeProp ?? ownScope;
	// A repository without a GitHub remote gets the local-git forge when the switch is on. The
	// forge reads its own git state; the panel only shows the newest answer it stored.
	const localForgeActive =
		localForgeEnabled &&
		repoRemoteUrl !== undefined &&
		forgeForRemoteUrl(repoRemoteUrl) === "local";
	const localForgeEntry = useStore(localGitForge.store, (state) => state.byWorkspace[workspaceId]);
	const localForgeInfo = localForgeActive ? (localForgeEntry?.info ?? null) : undefined;
	const localForgeError = localForgeActive ? (localForgeEntry?.error ?? null) : undefined;
	const gitSnapshot = git.state === "ready" ? git.data : null;
	const forge: "github" | "local" =
		localForgeActive || gitSnapshot?.pullRequestUnavailable === "not_github" ? "local" : "github";
	const forgeCapabilities = capabilitiesFor(forge);
	const headerInputs: GitHeaderInputs | null =
		git.state === "ready"
			? {
					git: git.data,
					agentWorking: status?.kind === "agent" && status.label === "working",
					forge,
					localForge: localForgeInfo,
					localForgeError,
					automergeSettingOn: automergeEnabled,
					treatOptionalChecksAsBlocking: optionalChecksBlocking,
					stack: null,
				}
			: null;

	// Any tab change leaves Artifacts: a shortcut or a link that asks for a tab must show it.
	const setTab = (next: GitPanelTab) => {
		setShowArtifacts(false);
		if (onTabChange !== undefined) onTabChange(next);
		if (tabProp === undefined) setOwnTab(next);
	};
	const selectView = (next: GitPanelViewTab) => {
		if (next === "artifacts") {
			setShowArtifacts(true);
			return;
		}
		setTab(next);
	};
	const setScope = (next: DiffScope) => {
		if (onScopeChange !== undefined) onScopeChange(next);
		if (scopeProp === undefined) setOwnScope(next);
	};

	// A new workspace starts with the review prompt closed and the Artifacts tab hidden.
	// biome-ignore lint/correctness/useExhaustiveDependencies: the workspace id is the trigger.
	useEffect(() => {
		setReviewPromptOpen(false);
		setShowArtifacts(false);
	}, [workspaceId]);

	// A tab or scope the URL sets (a link from the chat, Back or Forward) shows that tab, so the
	// Artifacts tab, which the URL does not hold, gives way to it.
	const urlScopeKey = scopeProp === undefined ? null : JSON.stringify(scopeProp);
	// biome-ignore lint/correctness/useExhaustiveDependencies: the URL's tab and scope are the trigger.
	useEffect(() => {
		setShowArtifacts(false);
	}, [tabProp, urlScopeKey]);

	// Each new git snapshot on a local-git repository asks the forge to read its own ahead and
	// merge state. The service keeps only the newest answer, so a late one changes nothing.
	// biome-ignore lint/correctness/useExhaustiveDependencies: the snapshot reference is the trigger.
	useEffect(() => {
		if (!localForgeActive) return;
		void localGitForge.refresh(workspaceId);
	}, [gitSnapshot, localForgeActive, localGitForge, workspaceId]);

	// Cmd+Alt+U (or the user's rebind) shows uncommitted changes while the panel is mounted.
	useCommandHandler("review.showUncommitted", "area", () => {
		setTab("changes");
		setScope({ kind: "uncommitted" });
		return true;
	});

	const refresh = async (): Promise<void> => {
		const result = await gitService.refresh(workspaceId, "full");
		if (!result.ok) toastError("Couldn't read the git state", result.error);
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

	const runAction = async (action: GitHeaderActionId): Promise<void> => {
		const run = async (
			work: Promise<{ ok: boolean; error?: { message: string } }>,
			title: string,
		): Promise<void> => {
			const result = await work;
			if (!result.ok && result.error !== undefined) toastError(title, result.error);
		};
		switch (action) {
			case "create_pr":
				return run(actions.pullRequests.create(workspaceId), "Couldn't create the pull request");
			case "commit_and_push":
				return run(
					actions.git.commitAndPush(workspaceId),
					"Couldn't ask the agent to commit and push",
				);
			case "pull": {
				const result = await gitService.pull(workspaceId);
				if (!result.ok) {
					toastError("Couldn't pull", result.error);
					return;
				}
				// A pull reports what it did; the agent hand-off is already visible in the chat.
				if (result.value === "up_to_date") toast.success(PULL_UP_TO_DATE_MESSAGE);
				if (result.value === "fast_forwarded") toast.success(PULLED_LATEST_MESSAGE);
				return;
			}
			case "push":
				return run(actions.git.push(workspaceId), "Couldn't push");
			case "resolve":
				return run(actions.git.resolveConflicts(workspaceId), "Couldn't ask the agent to resolve");
			case "ready_for_review":
				return run(
					actions.pullRequests.markReady(workspaceId),
					"Couldn't mark the pull request ready",
				);
			case "fix_errors":
				return run(actions.pullRequests.fixErrors(workspaceId), "Couldn't send the failing checks");
			case "approve":
				return run(actions.pullRequests.approve(workspaceId), "Couldn't approve the pull request");
			case "merge":
			case "merge_stack":
				// Only the GitHub forge can merge on the remote. A repository without a GitHub remote
				// has the agent merge in the main worktree, like commit and push (GIT-14).
				return run(
					forgeCapabilities.merge
						? actions.pullRequests.merge(workspaceId)
						: localGitForge.mergeIntoTarget(workspaceId),
					forgeCapabilities.merge
						? "Couldn't merge the pull request"
						: "Couldn't ask the agent to merge",
				);
			case "toggle_automerge": {
				const pr = git.state === "ready" ? git.data.pullRequest : null;
				return run(
					actions.pullRequests.setAutoMerge(workspaceId, pr === null ? true : !pr.autoMergeEnabled),
					"Couldn't change auto-merge",
				);
			}
			case "add_comments_to_chat":
				// The header model above drops this action until REV-03 supplies sendToChat.
				return Promise.resolve();
			case "retry":
				return refresh();
			case "continue": {
				const result = await actions.git.continueOnNewBranch(workspaceId, null);
				if (result.ok) return refresh();
				// These two failures come after the branch changed, so the header must read it.
				const branchChanged =
					result.error.code === "continue_note_failed" ||
					result.error.code === "continue_branch_unsaved";
				if (branchChanged) await refresh();
				toastError(
					result.error.code === "continue_note_failed"
						? CONTINUE_NOTE_FAILED_MESSAGE
						: "Couldn't continue on a new branch",
					result.error,
				);
				return;
			}
		}
	};

	// The header button and the shortcuts all start an action here. While an action runs for a
	// workspace, the same action asked again (a second key press, or a click) gets the running
	// call's promise and starts nothing, so the agent is never sent the same message twice.
	const runGuarded = (action: GitHeaderActionId): Promise<void> =>
		actionFlight.run(`${workspaceId}:${action}`, () => runAction(action));

	// Cmd+Shift+P. The panel knows the active workspace, so the shortcut reaches the same action
	// as the header's Create PR button instead of a service that has no workspace to act on.
	useCommandHandler("git.createPr", "area", () => {
		void runGuarded("create_pr");
		return true;
	});

	// Cmd+Shift+Y reaches the same action as the header's Commit and push button, but only while
	// the header offers that action. A clean tree or an open PR has nothing to commit, so asking
	// the agent would spend a turn for nothing.
	useCommandHandler("git.commitAndPush", "area", () => {
		if (headerInputs !== null && computeGitHeader(headerInputs).action?.id === "commit_and_push") {
			void runGuarded("commit_and_push");
		}
		return true;
	});

	// Cmd+Shift+L reaches the same action as the header's Pull latest button.
	useCommandHandler("git.pullLatest", "area", () => {
		void runGuarded("pull");
		return true;
	});

	// Cmd+Shift+M reaches the same action as the header's merge button (the button shows this key
	// for both "merge" and "merge_stack"), and only while the header offers it: a pull request that
	// is not ready, or a viewer who cannot merge, gets no merge.
	useCommandHandler("pr.merge", "area", () => {
		const offered = headerInputs === null ? null : computeGitHeader(headerInputs).action?.id;
		if (offered === "merge" || offered === "merge_stack") void runGuarded(offered);
		return true;
	});

	// Cmd+Shift+X reaches the same action as the header's Fix errors button, only while the header
	// offers it: passing checks or a pending run is not something to send to the agent.
	useCommandHandler("pr.fixErrors", "area", () => {
		const offered = headerInputs === null ? null : computeGitHeader(headerInputs).action?.id;
		if (offered === "fix_errors") void runGuarded("fix_errors");
		return true;
	});

	const startReview = async (extraInstructions: string | null): Promise<void> => {
		// One review at a time per workspace: a second press or the dialog's Send must not start
		// another chat.
		const key = `review:${workspaceId}`;
		if (reviewFlight.isRunning(key)) return;
		setReviewingFor(workspaceId);
		try {
			const result = await reviewFlight.run(key, () =>
				actions.pullRequests.requestAiReview(workspaceId, extraInstructions),
			);
			if (!result.ok) {
				toastError("Couldn't start the review", result.error);
				return;
			}
			// The user may have moved to another workspace while the request ran.
			if (currentWorkspace.current === workspaceId) setReviewPromptOpen(false);
		} finally {
			setReviewingFor((current) => (current === workspaceId ? null : current));
		}
	};

	// Cmd+Shift+R starts the same review as the Review button.
	useCommandHandler("review.start", "area", () => {
		void startReview(null);
		return true;
	});

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
		if (headerInputs === null) return null;
		return <ComputedHeader key={workspaceId} inputs={headerInputs} onAction={runGuarded} />;
	})();

	const changedCount = git.state === "ready" ? git.data.changedFiles : 0;
	const checksFailing =
		git.state === "ready" &&
		git.data.pullRequest !== null &&
		summarizeChecks(git.data.pullRequest.checks, {
			treatOptionalAsBlocking: optionalChecksBlocking === true,
		}).overall === "failing";

	return (
		<div className="flex h-full min-h-0 flex-col">
			{header}
			<GitPanelTabs
				active={view}
				onSelect={selectView}
				showArtifacts={artifactsTabEnabled === true}
				changedCount={changedCount}
				checksFailing={checksFailing}
				reviewDisabled={reviewBusy || changedCount === 0}
				reviewDisabledReason={
					reviewBusy ? "A review is already running." : "There is nothing to review."
				}
				onReview={() => void startReview(null)}
				onReviewWithEdit={() => setReviewPromptOpen(true)}
			/>
			<div className="min-h-0 flex-1 overflow-hidden">
				{view === "artifacts" ? (
					<ArtifactsTab workspaceId={workspaceId} />
				) : view === "files" ? (
					<NotBuiltYet area="All files" resetKey={`${workspaceId}:files`}>
						<FilesTab workspaceId={workspaceId} onOpenFile={(path) => openFile(path, "edit")} />
					</NotBuiltYet>
				) : tab === "changes" ? (
					<ChangesTab
						workspaceId={workspaceId}
						scope={scope}
						onScopeChange={setScope}
						onOpenFile={(path) => openFile(path, "diff")}
					/>
				) : (
					<NotBuiltYet area="Checks" resetKey={`${workspaceId}:checks`}>
						<ChecksTab workspaceId={workspaceId} />
					</NotBuiltYet>
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
