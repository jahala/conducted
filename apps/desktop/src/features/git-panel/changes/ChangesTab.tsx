/**
 * @feature REV-01 Changes tab
 * Owns: the Changes tab body. The toolbar (filter, flat or folder view, diff scope), the changed
 * file list, and the empty states. Clicking a file opens a file tab in diff mode.
 * Behaviour: ui-map.md 3.6, "Changes" paragraph; services-map.md 3.3 (what the list is made of)
 * and 3.4.1 (the diff scopes).
 * Data: useChangedFiles(workspaceId, scope), useGitState (conflicts, rebase underway),
 * useActions().git.discardFile.
 * Children: ChangesToolbar, ScopeBackBar, ChangedFileList, ChangesEmpty, StackView.
 * Keyboard: ArrowUp and ArrowDown move the selected file, Cmd+Alt+J and Cmd+Alt+K move between
 * comments, Cmd+Shift+D opens the selected file's diff (ui-map.md 3.6).
 * Must handle: loading (skeleton rows), error with retry, no git status (rebase or merge
 * underway), no changes, a filter that matches nothing, untracked files cut off at the cap, a very
 * long list (virtualised), conflicted files first, and a scope change while a request is in
 * flight (only the newest answer may update the list). The Viewed mark belongs to REV-02; this
 * tab leaves its checkbox out until that store exists.
 * Test first: with three ChangedFile rows and the filter "src/a", only the matching row renders.
 */
import type { WorkspaceId } from "@conducted/shared";
import { useEffect, useState } from "react";
import type { DiffScope } from "../../../core/api.ts";
import { useActions, useBranchCommits, useChangedFiles, useGitState } from "../../../core/hooks.ts";
import { Skeleton } from "../../../ui/Skeleton.tsx";
import { toastError } from "../../../ui/Toast.tsx";
import { ChangedFileList } from "./ChangedFileList.tsx";
import { ChangesEmpty } from "./ChangesEmpty.tsx";
import { ChangesToolbar } from "./ChangesToolbar.tsx";
import { buildChangedTree, filterChangedFiles } from "./changed-file-tree.ts";
import { ScopeBackBar } from "./ScopeBackBar.tsx";

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

export function ChangesTab({ workspaceId, scope, onScopeChange, onOpenFile }: ChangesTabProps) {
	const files = useChangedFiles(workspaceId, scope);
	const git = useGitState(workspaceId);
	const commits = useBranchCommits(workspaceId);
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

	// The command dispatcher opens the diff from anywhere; this keeps the panel working on its own.
	useEffect(() => {
		if (selected === null) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.metaKey && event.shiftKey && event.key.toLowerCase() === "d") {
				event.preventDefault();
				onOpenFile(selected);
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [selected, onOpenFile]);

	const toggleFolder = (folderPath: string) => {
		setCollapsedFolders((current) => {
			const next = new Set(current);
			if (next.has(folderPath)) next.delete(folderPath);
			else next.add(folderPath);
			return next;
		});
	};

	const discard = (path: string) => {
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
		if (git.state === "error") return <ChangesEmpty reason="no_git_status" />;
		if (files.state === "loading") return <LoadingRows />;
		if (files.state === "error") return <ChangesEmpty reason="no_git_status" />;
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
					onDiscard={discard}
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
