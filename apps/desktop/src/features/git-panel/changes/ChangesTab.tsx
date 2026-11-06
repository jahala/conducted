/**
 * @feature REV-01 Changes tab
 * Owns: the Changes tab body. The toolbar (filter, flat or folder view, diff scope), the changed
 * file list, and the empty states. Clicking a file opens a file tab in diff mode.
 * Behaviour: ui-map.md 3.6, "Changes" paragraph; services-map.md 3.3 (what the list is made of)
 * and 3.4.1 (the diff scopes).
 * Data: useChangedFiles(workspaceId, scope), useGitState (conflicts, rebase underway),
 * useStack (the stacked pull requests), useSetting("github_stacked_prs_enabled"), useWorkspace and
 * useRepoConfig (the trunk is the target branch without its remote), useActions().git.discardFile,
 * and the GitHub service's mark ready for a stack entry's own pull request number.
 * Children: ChangesToolbar, StackView, ScopeBackBar, ChangedFileList, ChangesEmpty.
 * Keyboard: ArrowUp and ArrowDown move the selected file (in ChangedFileList). The command
 * "Open the diff view" (Cmd+Shift+D, or the user's rebind) opens the selected file's diff through
 * the command dispatcher. Moving between comments (Cmd+Alt+J and K) belongs to REV-03.
 * Discard is offered for the whole-branch scopes and the uncommitted view: it puts a file back to
 * the target branch, which would be a surprise from a one-commit view.
 * Must handle: loading (skeleton rows), an error with its message (the list reloads by itself on
 * the next poll), no git status (rebase or merge underway), no changes, a filter that matches
 * nothing, untracked files cut off at the cap, a very long list (virtualised), conflicted files
 * first, and a scope change while a request is in flight (only the newest answer may update the
 * list), a stack read before the workspace or its settings load (the stack waits, so the trunk is
 * never a guessed name), and Ready for review on a stack entry that is not the workspace's own pull
 * request (that entry's number is marked ready). The Viewed mark belongs to REV-02; this tab leaves
 * its checkbox out until that store exists. A per-turn view offers Discard changes and says that reverting one file to a turn is
 * not supported yet (CHAT-15), instead of discarding a file against the branch.
 * Test first: with three ChangedFile rows and the filter "src/a", only the matching row renders.
 */
import type { RepoId, WorkspaceId } from "@conducted/shared";
import { useState } from "react";
import { useCommandHandler } from "../../../app/command-dispatcher.ts";
import type { DiffScope } from "../../../core/api.ts";
import { useServices } from "../../../core/context.tsx";
import {
	useActions,
	useBranchCommits,
	useChangedFiles,
	useGitState,
	useRepoConfig,
	useSetting,
	useStack,
	useWorkspace,
	useWorkspaceStatus,
} from "../../../core/hooks.ts";
import { branchNameWithoutRemote } from "../../../core/services/git.ts";
import { remoteNameFromConfig } from "../../../core/services/workspace.ts";
import { Skeleton } from "../../../ui/Skeleton.tsx";
import { toast, toastError } from "../../../ui/Toast.tsx";
import { ChangedFileList } from "./ChangedFileList.tsx";
import { ChangesEmpty } from "./ChangesEmpty.tsx";
import { ChangesToolbar } from "./ChangesToolbar.tsx";
import { buildChangedTree, filterChangedFiles } from "./changed-file-tree.ts";
import { ScopeBackBar } from "./ScopeBackBar.tsx";
import { StackView } from "./StackView.tsx";

export interface ChangesTabProps {
	workspaceId: WorkspaceId;
	scope: DiffScope;
	onScopeChange: (scope: DiffScope) => void;
	/** Opens a file tab in diff mode for the file, using the current scope. */
	onOpenFile: (path: string) => void;
}

const NO_FOLDERS: ReadonlySet<string> = new Set();

function LoadingRows() {
	return (
		<div role="status" aria-label="Loading changes" className="space-y-1 p-2">
			{["a", "b", "c", "d", "e"].map((key) => (
				<Skeleton key={key} className="h-6 w-full" />
			))}
		</div>
	);
}

function scopeTitle(scope: DiffScope, commits: { sha: string; subject: string }[]): string {
	if (scope.kind === "commit") {
		return (
			commits.find((commit) => commit.sha === scope.sha)?.subject ??
			`Commit ${scope.sha.slice(0, 7)}`
		);
	}
	return "One turn";
}

/**
 * The stack view, drawn once the workspace and its repository settings are loaded, so the trunk is
 * the workspace's own target branch without its remote, never a guessed name.
 */
function StackSection({
	workspaceId,
	repoId,
	targetBranch,
	agentRunning,
}: {
	workspaceId: WorkspaceId;
	repoId: RepoId;
	targetBranch: string;
	agentRunning: boolean;
}) {
	const stack = useStack(workspaceId);
	const config = useRepoConfig(repoId);
	const actions = useActions();
	const { services } = useServices();
	if (stack.state !== "ready" || stack.data.length === 0 || config.state !== "ready") return null;
	// A remote name git cannot use also fails the stack read, so this only guards the type.
	const remote = remoteNameFromConfig(config.data);
	if (!remote.ok) return null;

	const checkout = (branch: string) => {
		void actions.git.switchBranch(workspaceId, branch).then((result) => {
			if (!result.ok) toastError("Couldn't switch branch", result.error);
		});
	};
	// Each entry is its own pull request, so the clicked entry's number is the one marked ready.
	const markReady = (prNumber: number) => {
		void services.github.markReady(workspaceId, prNumber).then((result) => {
			if (!result.ok) toastError("Couldn't mark the pull request ready", result.error);
		});
	};

	return (
		<StackView
			trunk={branchNameWithoutRemote(targetBranch, remote.value)}
			entries={stack.data}
			onCheckout={checkout}
			onMarkReady={markReady}
			agentRunning={agentRunning}
		/>
	);
}

export function ChangesTab({ workspaceId, scope, onScopeChange, onOpenFile }: ChangesTabProps) {
	const files = useChangedFiles(workspaceId, scope);
	const git = useGitState(workspaceId);
	const commits = useBranchCommits(workspaceId);
	const stacksEnabled = useSetting<boolean>("github_stacked_prs_enabled");
	const workspace = useWorkspace(workspaceId);
	const status = useWorkspaceStatus(workspaceId);
	const actions = useActions();

	const [filter, setFilter] = useState("");
	const [view, setView] = useState<"flat" | "folders">("flat");
	const [collapsedFolders, setCollapsedFolders] = useState<ReadonlySet<string>>(NO_FOLDERS);
	const [selectedPath, setSelectedPath] = useState<string | null>(null);

	const allFiles = files.state === "ready" ? files.data : [];
	const filtered = filterChangedFiles(allFiles, filter);
	const nodes = buildChangedTree(filtered, view, collapsedFolders);
	const selected =
		selectedPath !== null && filtered.some((file) => file.path === selectedPath)
			? selectedPath
			: null;
	const commitList = commits.state === "ready" ? commits.data : [];
	const agentRunning = status?.kind === "agent" && status.label === "working";

	// Cmd+Shift+D (or the user's rebind) opens the selected file's diff. With no file selected the
	// command passes on to the next handler.
	useCommandHandler("review.openDiff", "area", () => {
		if (selected === null) return false;
		onOpenFile(selected);
		return true;
	});

	const toggleFolder = (folderPath: string) => {
		setCollapsedFolders((current) => {
			const next = new Set(current);
			if (next.has(folderPath)) next.delete(folderPath);
			else next.add(folderPath);
			return next;
		});
	};

	const discard = (path: string) => {
		if (scope.kind === "turn") {
			toast.error("Reverting to a turn is not supported yet.");
			return;
		}
		void actions.git.discardFile(workspaceId, path).then((result) => {
			if (!result.ok) toastError("Couldn't discard the changes", result.error);
		});
	};

	const narrowed = scope.kind === "commit" || scope.kind === "turn";
	const operation = git.state === "ready" ? git.data.operation : "none";
	// The polling snapshot's untracked flag only fits scopes that include the working tree.
	const includesWorkingTree =
		scope.kind === "branch" || scope.kind === "target" || scope.kind === "uncommitted";

	const body = (() => {
		if (operation !== "none") {
			return <ChangesEmpty reason="operation_in_progress" operation={operation} />;
		}
		if (git.state === "error") {
			return <ChangesEmpty reason="no_git_status" message={git.error.message} />;
		}
		if (files.state === "loading") return <LoadingRows />;
		if (files.state === "error") {
			return <ChangesEmpty reason="no_git_status" message={files.error.message} />;
		}
		if (allFiles.length === 0) return <ChangesEmpty reason="no_changes" />;
		if (filtered.length === 0) {
			return <ChangesEmpty reason="filter_no_match" onClearFilter={() => setFilter("")} />;
		}
		return (
			<div className="flex min-h-0 flex-1 flex-col">
				<ChangedFileList
					nodes={nodes}
					selectedPath={selected}
					onSelect={setSelectedPath}
					onOpen={onOpenFile}
					onToggleFolder={toggleFolder}
					collapsedFolders={collapsedFolders}
					onDiscard={scope.kind === "commit" ? undefined : discard}
				/>
				{git.state === "ready" && git.data.untrackedFilesTruncated && includesWorkingTree ? (
					<ChangesEmpty reason="untracked_truncated" />
				) : null}
			</div>
		);
	})();

	return (
		<div className="flex h-full min-h-0 flex-col">
			<ChangesToolbar
				workspaceId={workspaceId}
				filter={filter}
				onFilterChange={setFilter}
				view={view}
				onViewChange={setView}
				scope={scope}
				onScopeChange={onScopeChange}
			/>
			{stacksEnabled === true && workspace.state === "ready" ? (
				<StackSection
					workspaceId={workspaceId}
					repoId={workspace.data.repoId}
					targetBranch={workspace.data.targetBranch}
					agentRunning={agentRunning}
				/>
			) : null}
			{narrowed ? (
				<ScopeBackBar
					label={scopeTitle(scope, commitList)}
					onBack={() => onScopeChange({ kind: "branch" })}
				/>
			) : null}
			{body}
		</div>
	);
}
