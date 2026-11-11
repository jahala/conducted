/**
 * @feature NAV-10 Workspace header
 * Owns: The header at the top of the centre: the repo with its menu (Repository settings, Open on
 * GitHub), the branch without the user's prefix with its Copy and Rename menu,
 * the "···" popover that changes the target branch, the folder's name, the Open in menu, and the
 * right panel toggle. The repo's icon is PRJ-05's RepoIconAvatar, the same one the sidebar rows show.
 * Behaviour: ui-map.md 3.1 and 5.3 (branch name menu: Copy, Rename). Measured in Conductor 0.92.1
 * (renderApp @5513500-5521500, nPi, u0o, Kpo): left, the repo, a chevron, the branch (a click
 * renames it; right click offers Copy C and Rename R), and an ellipsis button whose popover holds
 * "Target branch" and its picker; right, the folder name in small muted text when it differs from
 * the branch, the Open in button with no label, and "Toggle right sidebar". Conductor's header has
 * no workspace name, rename button or actions menu: those live on the sidebar row (D098) and, for
 * a cloud workspace, in CLOUD-15's popover.
 * Our design choice: Follow and avatars are organisation features and are left out. A local
 * workspace keeps the repository and branch here; for a cloud workspace the left part is CLOUD-15's
 * one identity button (CloudWorkspaceStatus), which opens its status, meters, agent cost and
 * Restart popover, as Conductor's cloud header does. The branch is renamed through the shared name
 * dialog. The header starts after <TitleBarInset> and is a window drag region owned by the layout.
 * The branch menu advertises and handles its C and R keys.
 * Must handle: Loading and error (small inline states, the rest of the screen stays); placeholder
 * branch name (shown muted until the first message renames it); a long name truncates; archived
 * workspace (no Open in, and the target branch says it cannot change); the toggle button reflects
 * rightPanelOpen.
 * Test first: Renders the branch and the Open in menu; the toggle button reflects rightPanelOpen.
 */
import type { RepoId, WorkspaceId } from "@conducted/shared";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { githubRepositoryFromRemote } from "../../core/github-text.ts";
import { useActions, useBranches, useRepos, useWorkspace } from "../../core/hooks.ts";
import type { Repo } from "../../core/model.ts";
import { isArchivedWorkspace } from "../../core/status/archived.ts";
import { Button } from "../../ui/Button.tsx";
import { ContextMenu, ContextMenuItem } from "../../ui/ContextMenu.tsx";
import { cn } from "../../ui/cn.ts";
import {
	ArrowUpRightIcon,
	ChevronRightIcon,
	GearIcon,
	MoreHorizontalIcon,
	SidebarRightIcon,
} from "../../ui/icons.tsx";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "../../ui/Menu.tsx";
import { NotBuiltYet } from "../../ui/not-built-yet.tsx";
import { Popover } from "../../ui/Popover.tsx";
import { toastError } from "../../ui/Toast.tsx";
import { TargetBranchPicker } from "../git-panel/changes/TargetBranchPicker.tsx";
import { OpenInMenu } from "../open-in/OpenInMenu.tsx";
import { RepoIconAvatar } from "../sidebar/RepoIcon.tsx";
import { CloudWorkspaceStatus } from "./CloudWorkspaceStatus.tsx";
import { RenameDialog } from "./RenameDialog.tsx";
import { useBranchPrefix } from "./use-branch-prefix.ts";
import type { RightPanelControls } from "./WorkspaceLayout.tsx";
import { branchWithoutPrefix } from "./workspace-name.ts";

export interface WorkspaceHeaderProps {
	repoId: RepoId;
	workspaceId: WorkspaceId;
	controls: RightPanelControls;
}

export function WorkspaceHeader({ repoId, workspaceId, controls }: WorkspaceHeaderProps) {
	const workspace = useWorkspace(workspaceId);
	const repos = useRepos();
	const actions = useActions();
	const [renamingBranch, setRenamingBranch] = useState(false);
	const branchPrefix = useBranchPrefix();

	const data = workspace.state === "ready" ? workspace.data : null;
	const repo = repos.state === "ready" ? repos.data.find((item) => item.id === repoId) : undefined;
	const archived = data !== null && isArchivedWorkspace(data);
	const isCloud = data?.host.kind === "cloud";
	const branch = data?.branch ?? "";
	// Conductor shows the branch without the user's prefix; Copy and Rename keep the whole name.
	const shownBranch = branchWithoutPrefix(branch, branchPrefix);
	const canRename = !archived && branch !== "";

	const copy = (title: string, text: string) => {
		void actions.app.copyText(text).then((result) => {
			if (!result.ok) toastError(title, result.error);
		});
	};

	if (workspace.state === "loading") {
		return (
			<p role="status" aria-label="Loading workspace" className="px-3 text-sm text-fg-subtle">
				Loading workspace…
			</p>
		);
	}
	if (workspace.state === "error") {
		return (
			<p role="alert" className="px-3 text-sm text-danger">
				{workspace.error.message}
			</p>
		);
	}

	return (
		<div className="flex h-full min-w-0 items-center gap-2 px-2">
			{isCloud && data !== null ? (
				<CloudWorkspaceStatus workspaceId={workspaceId} restartDisabled={data.state !== "ready"} />
			) : null}
			<div className="flex min-w-0 shrink items-center gap-2 overflow-hidden">
				{isCloud ? null : (
					<>
						{repo === undefined ? null : <RepoMenu repo={repo} />}

						<ChevronRightIcon aria-hidden="true" className="size-3 shrink-0 text-fg-muted" />

						<ContextMenu
							items={
								<>
									<ContextMenuItem
										disabled={branch === ""}
										shortcut="C"
										onSelect={() => copy("Couldn't copy the branch", branch)}
										onKeyDown={(event) => {
											if (event.key.toLowerCase() !== "c" || branch === "") return;
											event.preventDefault();
											copy("Couldn't copy the branch", branch);
										}}
									>
										Copy
									</ContextMenuItem>
									<ContextMenuItem
										disabled={!canRename}
										shortcut="R"
										onSelect={() => setRenamingBranch(true)}
										onKeyDown={(event) => {
											if (event.key.toLowerCase() !== "r" || !canRename) return;
											event.preventDefault();
											setRenamingBranch(true);
										}}
									>
										Rename
									</ContextMenuItem>
								</>
							}
						>
							<button
								type="button"
								onClick={() => {
									if (canRename) setRenamingBranch(true);
								}}
								className={cn(
									"min-w-0 truncate rounded-sm px-1 text-sm font-medium",
									canRename ? "cursor-pointer" : "cursor-default",
									data?.branchIsPlaceholder ? "text-fg-subtle" : "text-fg-muted hover:text-fg",
								)}
								title={shownBranch}
							>
								{branch === "" ? "No branch" : shownBranch}
							</button>
						</ContextMenu>

						<TargetBranchPopover
							workspaceId={workspaceId}
							repoId={repoId}
							current={data?.targetBranch ?? ""}
							archived={archived}
						/>
					</>
				)}
			</div>

			<div className="ml-auto flex min-w-0 items-center gap-3">
				{data === null || archived || data.directoryName === branch ? null : (
					<span
						className="block min-w-0 max-w-40 shrink truncate text-xs text-fg-muted"
						title={data.directoryName}
					>
						{data.directoryName}
					</span>
				)}
				{archived ? null : (
					<NotBuiltYet area="Open in" variant="inline">
						<OpenInMenu workspaceId={workspaceId} />
					</NotBuiltYet>
				)}
				<Button
					variant="ghost"
					size="sm"
					className="w-7 px-0"
					aria-label="Toggle right sidebar"
					aria-pressed={controls.rightPanelOpen}
					onClick={controls.toggleRightPanel}
				>
					<SidebarRightIcon />
				</Button>
			</div>

			<RenameDialog
				open={renamingBranch}
				onOpenChange={setRenamingBranch}
				title="Rename branch"
				initialName={branch}
				onSubmit={(next) => actions.git.renameBranch(workspaceId, next)}
			/>
		</div>
	);
}

/**
 * Conductor's repository button at the start of the header (renderApp, the header's repository
 * menu): the repository's icon and name, opening "Repository settings" (the repository's Misc page)
 * and, for a GitHub remote, "Open on GitHub".
 */
function RepoMenu({ repo }: { repo: Repo }) {
	const navigate = useNavigate();
	const actions = useActions();
	const github = repo.remoteUrl === null ? null : githubRepositoryFromRemote(repo.remoteUrl);
	const githubUrl =
		github?.ok === true ? `https://github.com/${github.value.owner}/${github.value.name}` : null;
	return (
		<Menu>
			<MenuTrigger asChild>
				<button
					type="button"
					aria-label={repo.name}
					className="flex min-w-0 max-w-48 shrink-0 items-center gap-2 rounded-sm px-1 py-0.5 text-fg-muted transition-colors hover:bg-hover hover:text-fg"
				>
					<RepoIconAvatar repo={repo} />
					<span className="min-w-0 truncate text-sm font-medium">{repo.name}</span>
				</button>
			</MenuTrigger>
			<MenuContent align="start">
				<MenuItem
					icon={<GearIcon />}
					onSelect={() =>
						void navigate({
							to: "/settings/repos/$repoId/$page",
							params: { repoId: repo.id, page: "misc" },
						})
					}
				>
					Repository settings
				</MenuItem>
				{githubUrl === null ? null : (
					<MenuItem
						icon={<ArrowUpRightIcon />}
						onSelect={() =>
							void actions.app.openUrl(githubUrl).then((result) => {
								if (!result.ok) toastError("Couldn't open GitHub", result.error);
							})
						}
					>
						Open on GitHub
					</MenuItem>
				)}
			</MenuContent>
		</Menu>
	);
}

/**
 * Conductor's "···" beside the branch (Kpo, renderApp @5520600): a popover with the words
 * "Target branch" and the branch picker. An archived workspace cannot change it (Conductor's
 * reason, renderApp @2756439).
 */
function TargetBranchPopover({
	workspaceId,
	repoId,
	current,
	archived,
}: {
	workspaceId: WorkspaceId;
	repoId: RepoId;
	current: string;
	archived: boolean;
}) {
	const actions = useActions();
	const [open, setOpen] = useState(false);

	const choose = (branch: string) => {
		setOpen(false);
		if (branch === current) return;
		void actions.workspaces.setTargetBranch(workspaceId, branch).then((result) => {
			if (!result.ok) toastError("Couldn't change the target branch", result.error);
		});
	};

	return (
		<Popover
			open={open}
			onOpenChange={setOpen}
			align="start"
			className="p-3"
			trigger={
				<button
					type="button"
					aria-label="Target branch"
					className="ml-1 shrink-0 translate-y-px cursor-pointer text-fg-muted transition-colors hover:text-fg"
				>
					<MoreHorizontalIcon className="size-3" />
				</button>
			}
		>
			<div className="flex flex-col gap-2">
				<div className="flex items-center gap-2">
					<span className="text-sm text-fg-muted">Target branch</span>
					<span className="truncate font-mono text-xs text-fg">{current}</span>
				</div>
				{archived ? (
					<p className="text-xs text-fg-muted">
						Target branch cannot be changed for archived workspaces
					</p>
				) : open ? (
					<NotBuiltYet area="Target branch" variant="inline" resetKey={workspaceId}>
						<HeaderBranchList repoId={repoId} current={current} onSelect={choose} />
					</NotBuiltYet>
				) : null}
			</div>
		</Popover>
	);
}

function HeaderBranchList({
	repoId,
	current,
	onSelect,
}: {
	repoId: RepoId;
	current: string;
	onSelect: (branch: string) => void;
}) {
	const branches = useBranches(repoId);
	return (
		<TargetBranchPicker
			branches={branches.state === "ready" ? branches.data : []}
			current={current}
			onSelect={onSelect}
			loading={branches.state === "loading"}
			error={branches.state === "error" ? branches.error.message : null}
		/>
	);
}
