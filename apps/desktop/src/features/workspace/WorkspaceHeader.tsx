/**
 * @feature NAV-10 Workspace header
 * Owns: The header at the top of the centre: breadcrumb (repo, branch, target branch), workspace
 * name with rename and actions, the Open in menu, and the right panel toggle. The repo's icon is
 * PRJ-05's RepoIconAvatar, the same one the sidebar rows show.
 * Behaviour: ui-map.md 3.1 (breadcrumb with target branch picker, workspace name with 'Rename
 * workspace' and 'Workspace actions', directory chip and 'Open in...' button, right edge 'Toggle
 * right sidebar'), 5.3 (branch name menu: Copy, Rename).
 * Our design choice: Follow, avatars and cloud status are cloud features and are left out. The
 * target branch is chosen through the shared name dialog because the branch list belongs to WS-02.
 * The header starts after <TitleBarInset> and is a window drag region owned by the layout. The
 * branch menu advertises and handles its C and R keys.
 * Must handle: Loading and error (small inline states, the rest of the screen stays); placeholder
 * branch name (shown muted until the first message renames it); a long name truncates; archived
 * workspace (no Open in); a folder path that copies; the toggle button reflects rightPanelOpen.
 * Test first: Renders the workspace name and the Open in menu; the toggle button reflects
 * rightPanelOpen.
 */
import type { RepoId, WorkspaceId } from "@conducted/shared";
import { useState } from "react";
import { useActions, useRepos, useWorkspace } from "../../core/hooks.ts";
import { Button } from "../../ui/Button.tsx";
import { ContextMenu, ContextMenuItem } from "../../ui/ContextMenu.tsx";
import { cn } from "../../ui/cn.ts";
import { ChevronDownIcon, FolderPlusIcon, PencilIcon, SidebarRightIcon } from "../../ui/icons.tsx";
import { NotBuiltYet } from "../../ui/not-built-yet.tsx";
import { toastError } from "../../ui/Toast.tsx";
import { OpenInMenu } from "../open-in/OpenInMenu.tsx";
import { RepoIconAvatar } from "../sidebar/RepoIcon.tsx";
import { RenameDialog } from "./RenameDialog.tsx";
import { WorkspaceActionsMenu } from "./WorkspaceActionsMenu.tsx";
import type { RightPanelControls } from "./WorkspaceLayout.tsx";
import { WorkspaceRenameDialog } from "./WorkspaceRenameDialog.tsx";
import { workspaceName } from "./workspace-name.ts";

export interface WorkspaceHeaderProps {
	repoId: RepoId;
	workspaceId: WorkspaceId;
	controls: RightPanelControls;
}

export function WorkspaceHeader({ repoId, workspaceId, controls }: WorkspaceHeaderProps) {
	const workspace = useWorkspace(workspaceId);
	const repos = useRepos();
	const actions = useActions();
	const [renamingWorkspace, setRenamingWorkspace] = useState(false);
	const [renamingBranch, setRenamingBranch] = useState(false);
	const [targetOpen, setTargetOpen] = useState(false);

	const data = workspace.state === "ready" ? workspace.data : null;
	const repo = repos.state === "ready" ? repos.data.find((item) => item.id === repoId) : undefined;
	const archived = data?.state === "archived";
	const name = data === null ? "" : workspaceName(data);
	const branch = data?.branch ?? "";

	const copy = (title: string, text: string) => {
		void actions.app.copyText(text).then((result) => {
			if (!result.ok) toastError(title, result.error);
		});
	};

	const saveTarget = (next: string) => actions.workspaces.setTargetBranch(workspaceId, next);

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
			<div className="flex min-w-0 items-center gap-1.5">
				{repo === undefined ? null : <RepoIconAvatar repo={repo} className="size-5 text-2xs" />}
				<span className="max-w-32 truncate text-sm text-fg-muted">{repo?.name ?? ""}</span>
			</div>

			<span aria-hidden="true" className="text-fg-subtle">
				/
			</span>

			<ContextMenu
				items={
					<>
						<ContextMenuItem
							shortcut="C"
							onSelect={() => copy("Couldn't copy the branch", branch)}
							onKeyDown={(event) => {
								if (event.key.toLowerCase() !== "c") return;
								event.preventDefault();
								copy("Couldn't copy the branch", branch);
							}}
						>
							Copy
						</ContextMenuItem>
						<ContextMenuItem
							disabled={archived || branch === ""}
							shortcut="R"
							onSelect={() => setRenamingBranch(true)}
							onKeyDown={(event) => {
								if (event.key.toLowerCase() !== "r" || archived || branch === "") return;
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
					className={cn(
						"max-w-48 truncate rounded-sm px-1 text-sm hover:bg-hover",
						data?.branchIsPlaceholder ? "text-fg-subtle" : "text-fg",
					)}
					title={branch}
				>
					{branch === "" ? "No branch" : branch}
				</button>
			</ContextMenu>

			<Button variant="ghost" size="sm" onClick={() => setTargetOpen(true)}>
				Target branch: {data?.targetBranch ?? ""}
				<ChevronDownIcon />
			</Button>

			<div className="flex min-w-0 items-center gap-1">
				<span className="max-w-56 truncate text-sm font-medium text-fg" title={name}>
					{name}
				</span>
				<Button
					variant="ghost"
					size="sm"
					className="w-7 px-0"
					aria-label="Rename workspace"
					disabled={archived}
					onClick={() => setRenamingWorkspace(true)}
				>
					<PencilIcon />
				</Button>
				<WorkspaceActionsMenu workspaceId={workspaceId}>
					<Button variant="ghost" size="sm" className="w-7 px-0" aria-label="Workspace actions">
						<ChevronDownIcon />
					</Button>
				</WorkspaceActionsMenu>
			</div>

			{archived ? null : (
				<>
					<Button
						variant="ghost"
						size="sm"
						title="Copy folder path"
						onClick={() => data !== null && copy("Couldn't copy the folder path", data.path)}
					>
						<FolderPlusIcon />
						<span className="max-w-32 truncate">{data?.directoryName ?? ""}</span>
					</Button>
					<NotBuiltYet area="Open in" variant="inline">
						<OpenInMenu workspaceId={workspaceId} />
					</NotBuiltYet>
				</>
			)}

			<div className="ml-auto flex items-center gap-1">
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

			<WorkspaceRenameDialog
				workspaceId={workspaceId}
				open={renamingWorkspace}
				onOpenChange={setRenamingWorkspace}
			/>
			<RenameDialog
				open={renamingBranch}
				onOpenChange={setRenamingBranch}
				title="Rename branch"
				initialName={branch}
				onSubmit={(next) => actions.git.renameBranch(workspaceId, next)}
			/>
			<RenameDialog
				open={targetOpen}
				onOpenChange={setTargetOpen}
				title="Target branch"
				initialName={data?.targetBranch ?? ""}
				fieldLabel="Branch"
				submitLabel="Save"
				onSubmit={saveTarget}
			/>
		</div>
	);
}
