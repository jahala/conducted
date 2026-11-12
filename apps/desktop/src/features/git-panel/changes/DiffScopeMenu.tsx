/**
 * @feature REV-01 Diff scope menu
 * Owns: the menu that chooses what the Changes tab compares: the whole branch, a target branch,
 * only uncommitted changes, one commit, or one agent turn.
 * Behaviour: ui-map.md 3.6, Changes options menu; services-map.md 3.4.1 (what each scope diffs).
 * Data: useGitState for the branch, useBranchCommits for the commit entries and useBranches for
 * the target picker.
 * On all changes the trigger is an icon with the tooltip "Options", as Conductor's toolbar has it;
 * a narrowed scope names itself on the trigger.
 * Entries, in order: Current branch, Target branch (opens TargetBranchPicker), All changes,
 * Uncommitted changes (Cmd+Alt+U, shows "N files changed"), then one entry per commit with its
 * message, short hash, author and date. Per-turn entries are not part of the issue's scope. A
 * range of stack pull requests is chosen in the stack view, not here; the trigger names it
 * "Changes in #N" or "Changes in N PRs" (PR-08).
 * Must handle: a branch with no commits ahead (commit list empty state), a branch list that fails
 * to load (the submenu says so and the rest of the panel keeps working), no file count while the
 * git state is loading, and the shortcut hint following the user's rebind.
 * Test first: choosing a commit entry calls onChange with { kind: "commit", sha }.
 */
import type { RepoId, WorkspaceId } from "@conducted/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { DiffScope } from "../../../core/api.ts";
import {
	useBranchCommits,
	useBranches,
	useGitState,
	useLiveShortcut,
	useWorkspace,
} from "../../../core/hooks.ts";
import { Button } from "../../../ui/Button.tsx";
import { ChevronDownIcon, MoreVerticalIcon } from "../../../ui/icons.tsx";
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
import { NotBuiltYet } from "../../../ui/not-built-yet.tsx";
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
		case "range": {
			// Conductor's words for a stack range (PR-08).
			const [only] = scope.prNumbers;
			return scope.prNumbers.length === 1 && only !== undefined
				? `Changes in #${only}`
				: `Changes in ${scope.prNumbers.length} PRs`;
		}
	}
}

const scopeValue = (scope: DiffScope): string => scope.kind;

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
	const queryClient = useQueryClient();
	return (
		<TargetBranchPicker
			branches={branches.state === "ready" ? branches.data : []}
			current={current}
			onSelect={onSelect}
			loading={branches.state === "loading"}
			error={branches.state === "error" ? branches.error.message : null}
			onRetry={() => {
				void queryClient.invalidateQueries({ queryKey: ["git", "branches", repoId] });
			}}
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
	// A failed branch list stays inside the submenu, so the rest of the panel keeps working.
	return (
		<NotBuiltYet area="Target branch" variant="inline" resetKey={workspaceId}>
			<BranchList repoId={workspace.data.repoId} current={current} onSelect={onSelect} />
		</NotBuiltYet>
	);
}

export function DiffScopeMenu({ workspaceId, scope, onChange }: DiffScopeMenuProps) {
	const [open, setOpen] = useState(false);
	const git = useGitState(workspaceId);
	const commits = useBranchCommits(workspaceId);
	const currentBranch = git.state === "ready" ? git.data.branch : "";
	const uncommitted = git.state === "ready" ? git.data.uncommittedFiles : null;
	const shortcut = useLiveShortcut("review.showUncommitted");

	const choose = (next: DiffScope) => {
		onChange(next);
		setOpen(false);
	};

	const commitList = commits.state === "ready" ? commits.data : [];

	return (
		<Menu open={open} onOpenChange={setOpen}>
			<MenuTrigger asChild>
				{scope.kind === "branch" ? (
					// Conductor's trigger on all changes: an icon with the tooltip "Options".
					<Button
						variant="ghost"
						size="xs"
						aria-label="Diff scope"
						title="Options"
						className="w-6 px-0 text-fg-muted"
					>
						<MoreVerticalIcon className="size-3" />
					</Button>
				) : (
					<Button variant="ghost" size="sm" aria-label="Diff scope">
						<span className="max-w-48 truncate">{scopeLabel(scope)}</span>
						<ChevronDownIcon className="size-3 text-fg-muted" />
					</Button>
				)}
			</MenuTrigger>
			<MenuContent
				align="end"
				className="max-h-96 w-80 max-w-[calc(100vw-1rem)] overflow-y-auto"
				aria-label="Diff scope"
			>
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
							{uncommitted === null ? null : (
								<span className="text-xs text-fg-muted">{countLabel(uncommitted)}</span>
							)}
							{shortcut === null ? null : (
								<span className="text-xs tracking-widest text-fg-subtle">{shortcut}</span>
							)}
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
