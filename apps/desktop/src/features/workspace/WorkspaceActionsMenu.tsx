/**
 * @feature NAV-10 Workspace actions menu
 * @feature CLOUD-10 Port forwarding from a cloud workspace to the Mac
 * Owns: The right-click menu of a workspace's sidebar row.
 * Behaviour: ui-map.md 3.1 ('Workspace actions' menu: mark as read or unread, pin or unpin, set
 * status, move to section, rename, copy link, link a pull request, archive or unarchive; the same
 * menu is the sidebar row's, renderApp @5558200-5563900), 3.10 ('Link pull request' dialog).
 * Conductor's workspace header holds no workspace name, rename button or actions menu (nPi,
 * renderApp @5518193): renaming the workspace and its actions live on the sidebar row (D098).
 * Our design choice: Cloud items (follow, reassign, share) are left out. Shortcut hints come from
 * the command registry. The items mount only while the menu is open, so a long sidebar pays for
 * one row's hooks, not every row's.
 * Must handle: Archived workspace (Unarchive instead of Archive, no Rename); unarchive that needs a
 * new branch name (a small dialog asks for one); a restore that lost uncommitted changes (the
 * warning from `runUnarchive`); mark as read or unread follows the chats' unread
 * count; move to section lists the known sections and 'New section...'; a failed action shows a toast.
 * Test first: Choosing Pin calls workspaces.setPinned(id, true); for a pinned workspace the item
 * reads Unpin.
 */

import type { Result, WorkspaceId } from "@conducted/shared";
import { messageOf, ok } from "@conducted/shared";
import type { ReactElement } from "react";
import { useState } from "react";
import { useStore } from "zustand";
import { useRunCommandHandlers } from "../../app/command-dispatcher.ts";
import { useServices } from "../../core/context.tsx";
import {
	useActions,
	useLiveShortcut,
	usePortForwards,
	useSessions,
	useWorkspace,
} from "../../core/hooks.ts";
import type { KanbanStatus, Section } from "../../core/model.ts";
import { buildDeepLink } from "../../core/services/notifications.ts";
import { isArchivedWorkspace } from "../../core/status/archived.ts";
import { AlertDialog, AlertDialogContent } from "../../ui/AlertDialog.tsx";
import {
	ContextMenu,
	ContextMenuItem,
	ContextMenuRadioGroup,
	ContextMenuRadioItem,
	ContextMenuSeparator,
	ContextMenuSub,
	ContextMenuSubContent,
	ContextMenuSubTrigger,
} from "../../ui/ContextMenu.tsx";
import { toastError } from "../../ui/Toast.tsx";
import { KANBAN_COLUMNS, KANBAN_STATUSES } from "../dashboard/kanban.ts";
import { SectionDialog } from "../sidebar/SectionDialog.tsx";
import { RenameDialog } from "./RenameDialog.tsx";
import { WorkspaceRenameDialog } from "./WorkspaceRenameDialog.tsx";
import { runUnarchive } from "./workspace-actions.ts";

export interface WorkspaceActionsMenuProps {
	workspaceId: WorkspaceId;
	/** The row that opens the menu on right click. */
	children: ReactElement;
}

export function WorkspaceActionsMenu({ workspaceId, children }: WorkspaceActionsMenuProps) {
	const [renaming, setRenaming] = useState(false);
	const [newSection, setNewSection] = useState(false);
	const [branchPrompt, setBranchPrompt] = useState(false);
	const [pausingForwarding, setPausingForwarding] = useState(false);
	const workspace = useWorkspace(workspaceId);
	const forwarding = usePortForwards(workspaceId);
	const actions = useActions();

	return (
		<>
			<ContextMenu
				items={
					<WorkspaceActionItems
						workspaceId={workspaceId}
						onRename={() => setRenaming(true)}
						onNewSection={() => setNewSection(true)}
						onNeedsBranchName={() => setBranchPrompt(true)}
						onPauseForwarding={() => setPausingForwarding(true)}
					/>
				}
			>
				{children}
			</ContextMenu>
			{renaming ? (
				<WorkspaceRenameDialog workspaceId={workspaceId} open onOpenChange={setRenaming} />
			) : null}
			{branchPrompt ? (
				<UnarchiveBranchDialog workspaceId={workspaceId} onOpenChange={setBranchPrompt} />
			) : null}
			{newSection ? <SectionDialog open onOpenChange={setNewSection} section={null} /> : null}
			{pausingForwarding ? (
				<AlertDialog open onOpenChange={setPausingForwarding}>
					<AlertDialogContent
						title="Pause port forwarding?"
						description="Every forward of this workspace stops, and its forwards are removed."
						confirmLabel="Pause"
						onConfirm={() => {
							void actions.portForwards.pauseWorkspace(workspaceId).then((result) => {
								if (!result.ok) toastError("Couldn't pause port forwarding", result.error);
							});
						}}
					/>
				</AlertDialog>
			) : null}
		</>
	);
}

function UnarchiveBranchDialog({
	workspaceId,
	onOpenChange,
}: {
	workspaceId: WorkspaceId;
	onOpenChange: (open: boolean) => void;
}) {
	const actions = useActions();
	const workspace = useWorkspace(workspaceId);
	const branch = workspace.state === "ready" ? workspace.data.branch : "";
	return (
		<RenameDialog
			open
			onOpenChange={onOpenChange}
			title="Unarchive workspace"
			initialName={branch}
			fieldLabel="Branch name"
			submitLabel="Unarchive"
			onSubmit={(name) =>
				runUnarchive(actions, workspaceId, { branchName: name, clearChats: false })
			}
		/>
	);
}

interface WorkspaceActionItemsProps {
	workspaceId: WorkspaceId;
	onRename: () => void;
	onNewSection: () => void;
	onNeedsBranchName: () => void;
	onPauseForwarding: () => void;
}

function WorkspaceActionItems({
	workspaceId,
	onRename,
	onNewSection,
	onNeedsBranchName,
	onPauseForwarding,
}: WorkspaceActionItemsProps) {
	const actions = useActions();
	const forwarding = usePortForwards(workspaceId);
	const runCommand = useRunCommandHandlers();
	const workspace = useWorkspace(workspaceId);
	const sessions = useSessions(workspaceId);
	const sections = useStore(useServices().services.sections.store, (state) => state.sections);
	const readShortcut = useLiveShortcut("sidebar.toggleRead");
	const pinShortcut = useLiveShortcut("sidebar.togglePin");
	const copyLinkShortcut = useLiveShortcut("workspace.copyLink");
	const linkPullRequestShortcut = useLiveShortcut("pr.link");
	const archiveShortcut = useLiveShortcut("workspace.archive");

	const data = workspace.state === "ready" ? workspace.data : null;
	const archived = data !== null && isArchivedWorkspace(data);
	const pinned = data?.pinnedAt != null;
	const unread =
		sessions.state === "ready" && sessions.data.some((session) => session.unreadCount > 0);

	// An action that returns a failed Result gets its toast. An action that throws (a placeholder
	// that is not built yet, such as mark as read) gets one too, so the user is never left guessing.
	const run = async (title: string, action: () => Promise<Result<unknown>>) => {
		try {
			const result = await action();
			if (!result.ok) toastError(title, result.error);
		} catch (caught) {
			toastError(title, { message: messageOf(caught) });
		}
	};

	const setStatus = (status: KanbanStatus) =>
		void run("Couldn't change the status", () =>
			actions.workspaces.setKanbanStatus(workspaceId, status),
		);

	const moveTo = (section: Section) =>
		void run("Couldn't move the workspace", () =>
			actions.sections.place(workspaceId, section.id, 0),
		);

	const startUnarchive = () =>
		void runUnarchive(actions, workspaceId, { branchName: null, clearChats: false }).then(
			(result) => {
				if (result.ok && result.value.needsBranchName) onNeedsBranchName();
			},
		);

	// The dialog's handler is registered by the workspace screen, so a menu pick runs it the
	// same way the key press would. Only a command with no screen handler goes to the service.
	const linkPullRequest = async (): Promise<Result<void>> => {
		if (runCommand("pr.link")) return ok(undefined);
		return actions.app.runCommand("pr.link");
	};

	return (
		<>
			<ContextMenuItem
				shortcut={readShortcut ?? undefined}
				onSelect={() =>
					void run(
						unread
							? "Couldn't mark the workspace as read"
							: "Couldn't mark the workspace as unread",
						() =>
							unread
								? actions.workspaces.markRead(workspaceId)
								: actions.workspaces.markUnread(workspaceId),
					)
				}
			>
				{unread ? "Mark as read" : "Mark as unread"}
			</ContextMenuItem>
			<ContextMenuItem
				shortcut={pinShortcut ?? undefined}
				onSelect={() =>
					void run(pinned ? "Couldn't unpin the workspace" : "Couldn't pin the workspace", () =>
						actions.workspaces.setPinned(workspaceId, !pinned),
					)
				}
			>
				{pinned ? "Unpin" : "Pin"}
			</ContextMenuItem>
			<ContextMenuSub>
				<ContextMenuSubTrigger>Set status</ContextMenuSubTrigger>
				<ContextMenuSubContent aria-label="Set status">
					<ContextMenuRadioGroup value={data?.kanbanStatus ?? ""}>
						{KANBAN_STATUSES.map((status) => (
							<ContextMenuRadioItem key={status} value={status} onSelect={() => setStatus(status)}>
								{KANBAN_COLUMNS[status].label}
							</ContextMenuRadioItem>
						))}
					</ContextMenuRadioGroup>
				</ContextMenuSubContent>
			</ContextMenuSub>
			<ContextMenuSub>
				<ContextMenuSubTrigger>Move to section</ContextMenuSubTrigger>
				<ContextMenuSubContent aria-label="Move to section">
					{sections.length === 0 ? (
						<ContextMenuItem disabled>No sections yet</ContextMenuItem>
					) : (
						sections.map((section) => (
							<ContextMenuItem key={section.id} onSelect={() => moveTo(section)}>
								{section.name}
							</ContextMenuItem>
						))
					)}
					<ContextMenuSeparator />
					<ContextMenuItem onSelect={onNewSection}>New section...</ContextMenuItem>
				</ContextMenuSubContent>
			</ContextMenuSub>
			<ContextMenuSeparator />
			{archived ? (
				<ContextMenuItem onSelect={startUnarchive}>Unarchive</ContextMenuItem>
			) : (
				<>
					<ContextMenuItem onSelect={onRename}>Rename</ContextMenuItem>
					<ContextMenuItem
						shortcut={copyLinkShortcut ?? undefined}
						onSelect={() =>
							void run("Couldn't copy the link", () =>
								actions.app.copyText(buildDeepLink(workspaceId, null)),
							)
						}
					>
						Copy link
					</ContextMenuItem>
					<ContextMenuItem
						shortcut={linkPullRequestShortcut ?? undefined}
						onSelect={() => void run("Couldn't link the pull request", linkPullRequest)}
					>
						Link pull request
					</ContextMenuItem>
					{data?.host.kind === "cloud" && forwarding.forwardingEnabled ? (
						<ContextMenuItem onSelect={onPauseForwarding}>Pause port forwarding</ContextMenuItem>
					) : null}
					<ContextMenuSeparator />
					<ContextMenuItem
						destructive
						shortcut={archiveShortcut ?? undefined}
						onSelect={() =>
							void run("Couldn't archive the workspace", () =>
								actions.workspaces.archive(workspaceId, { deleteBranch: false }),
							)
						}
					>
						Archive
					</ContextMenuItem>
				</>
			)}
		</>
	);
}
