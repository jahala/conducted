/**
 * @feature REV-01 Diff scope menu
 * Owns: the menu that chooses what the Changes tab compares: the whole branch, a target branch,
 * only uncommitted changes, one commit, or one agent turn.
 * Behaviour: ui-map.md 3.6, Changes options menu; services-map.md 3.4.1 (what each scope diffs).
 * Data: useGitState for the branch, useBranchCommits for the commit entries and useBranches for
 * the target picker.
 * Entries, in order: Current branch, Target branch (opens TargetBranchPicker), All changes,
 * Uncommitted changes (Cmd+Alt+U, shows "N files changed"), then one entry per commit with its
 * message, short hash, author and date, and per-turn entries from the chat history.
 * Must handle: a branch with no commits ahead (commit list empty state), a very long commit list
 * (virtualised, newest first), a scope that no longer exists (a commit that was rewritten falls
 * back to the whole branch), and no upstream branch.
 * Test first: choosing a commit entry calls onChange with { kind: "commit", sha }.
 */
import type { RepoId, WorkspaceId } from "@conducted/shared";
import { useState } from "react";
import type { DiffScope } from "../../../core/api.ts";
import { useBranchCommits, useBranches, useGitState, useWorkspace } from "../../../core/hooks.ts";
import { formatShortcut, getCommand } from "../../../core/registries/commands.ts";
import { Button } from "../../../ui/Button.tsx";
import { ChevronDownIcon } from "../../../ui/icons.tsx";
import {
	Menu,
	MenuContent,
	MenuLabel,
	MenuRadioGroup,
	MenuRadioItem,
	MenuSeparator,
	MenuSub,
	MenuSubContent,
	MenuSubTrigger,
	MenuTrigger,
} from "../../../ui/Menu.tsx";
import { CommitScopeList } from "./CommitScopeList.tsx";
import { TargetBranchPicker } from "./TargetBranchPicker.tsx";

export interface DiffScopeMenuProps {
	workspaceId: WorkspaceId;
	scope: DiffScope;
	onChange: (scope: DiffScope) => void;
}

function scopeLabel(scope: DiffScope): string {
	switch (scope.kind) {
		case "branch":
			return "All changes";
		case "uncommitted":
			return "Uncommitted changes";
		case "target":
			return `Against ${scope.branch}`;
		case "commit":
			return `Commit ${scope.sha.slice(0, 7)}`;
		case "turn":
			return "One turn";
	}
}

const scopeValue = (scope: DiffScope): string => scope.kind;

const SHORTCUT = formatShortcut(getCommand("review.showUncommitted")?.defaultShortcuts[0] ?? "");

function countLabel(count: number): string {
	return `${count} ${count === 1 ? "file" : "files"} changed`;
}

function BranchList({
	repoId,
	current,
	onSelect,
}: {
	repoId: RepoId;
	current: string;
	onSelect: (branch: string) => void;
}) {
	const branches = useBranches(repoId);
	const offline = branches.state === "error";
	const list: string[] =
		branches.state === "ready" ? branches.data : current.length > 0 ? [current] : [];
	return (
		<TargetBranchPicker
			branches={list}
			current={current}
			onSelect={onSelect}
			loading={branches.state === "loading"}
			offline={offline}
		/>
	);
}

function TargetBranchSubmenu({
	workspaceId,
	current,
	onSelect,
}: {
	workspaceId: WorkspaceId;
	current: string;
	onSelect: (branch: string) => void;
}) {
	const workspace = useWorkspace(workspaceId);
	if (workspace.state !== "ready") {
		return <p className="px-2 py-2 text-sm text-fg-muted">Select target branch...</p>;
	}
	return <BranchList repoId={workspace.data.repoId} current={current} onSelect={onSelect} />;
}

export function DiffScopeMenu({ workspaceId, scope, onChange }: DiffScopeMenuProps) {
	const [open, setOpen] = useState(false);
	const git = useGitState(workspaceId);
	const commits = useBranchCommits(workspaceId);
	const currentBranch = git.state === "ready" ? git.data.branch : "";
	const uncommitted = git.state === "ready" ? git.data.uncommittedFiles : 0;

	const choose = (next: DiffScope) => {
		onChange(next);
		setOpen(false);
	};

	const commitList = commits.state === "ready" ? commits.data : [];

	return (
		<Menu open={open} onOpenChange={setOpen}>
			<MenuTrigger asChild>
				<Button variant="ghost" size="sm" aria-label="Diff scope">
					<span className="max-w-48 truncate">{scopeLabel(scope)}</span>
					<ChevronDownIcon className="size-3 text-fg-muted" />
				</Button>
			</MenuTrigger>
			<MenuContent className="max-h-96 w-80 overflow-y-auto" aria-label="Diff scope">
				<MenuRadioGroup value={scopeValue(scope)}>
					<MenuLabel>
						Current branch
						{currentBranch.length > 0 ? (
							<span className="ml-1 font-mono text-2xs normal-case text-fg-muted">
								{currentBranch}
							</span>
						) : null}
					</MenuLabel>
					<MenuRadioItem value="branch" onSelect={() => choose({ kind: "branch" })}>
						All changes
					</MenuRadioItem>
					<MenuRadioItem value="uncommitted" onSelect={() => choose({ kind: "uncommitted" })}>
						<span className="flex w-full items-center gap-2">
							<span className="flex-1">Uncommitted changes</span>
							<span className="text-xs text-fg-muted">{countLabel(uncommitted)}</span>
							<span className="text-xs tracking-widest text-fg-subtle">{SHORTCUT}</span>
						</span>
					</MenuRadioItem>
					<MenuSub>
						<MenuSubTrigger>Target branch</MenuSubTrigger>
						<MenuSubContent>
							<TargetBranchSubmenu
								workspaceId={workspaceId}
								current={scope.kind === "target" ? scope.branch : ""}
								onSelect={(branch) => choose({ kind: "target", branch })}
							/>
						</MenuSubContent>
					</MenuSub>
				</MenuRadioGroup>
				<MenuSeparator />
				<CommitScopeList
					commits={commitList}
					selectedSha={scope.kind === "commit" ? scope.sha : null}
					onSelect={(sha) => choose({ kind: "commit", sha })}
				/>
			</MenuContent>
		</Menu>
	);
}
