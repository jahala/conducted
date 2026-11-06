/**
 * @feature NAV-10 Workspace actions menu
 * Owns: The dropdown menu behind the header's 'Workspace actions' button.
 * Behaviour: ui-map.md 3.1 ('Workspace actions' menu: mark as read or unread, pin or unpin, set
 * status, move to section, rename, copy link, archive or unarchive).
 * Our design choice: One list for the header. Cloud items (follow, reassign, share) are left out.
 * Shortcut hints come from the command registry. The sidebar's right-click surface belongs to
 * NAV-03's workspace row, which is not wired yet.
 * Must handle: Archived workspace (Unarchive instead of Archive, no Rename); unarchive that needs a
 * new branch name (a small dialog asks for one); a restore that lost uncommitted changes (the
 * warning from `runUnarchive`); mark as read or unread follows the chats' unread
 * count; move to section lists the known sections and 'New section...'; a failed action shows a toast.
 * Test first: Choosing Pin calls workspaces.setPinned(id, true); for a pinned workspace the item
 * reads Unpin.
 */

import type { Result, WorkspaceId } from "@conducted/shared";
import { messageOf } from "@conducted/shared";
import type { ReactNode } from "react";
import { useState } from "react";
import { useStore } from "zustand";
import { useServices } from "../../core/context.tsx";
import { useActions, useLiveShortcut, useSessions, useWorkspace } from "../../core/hooks.ts";
import type { KanbanStatus, Section } from "../../core/model.ts";
import { buildDeepLink } from "../../core/services/notifications.ts";
import {
	Menu,
	MenuContent,
	MenuItem,
	MenuRadioGroup,
	MenuRadioItem,
	MenuSeparator,
	MenuSub,
	MenuSubContent,
	MenuSubTrigger,
	MenuTrigger,
} from "../../ui/Menu.tsx";
import { toastError } from "../../ui/Toast.tsx";
import { KANBAN_COLUMNS, KANBAN_STATUSES } from "../dashboard/kanban.ts";
import { SectionDialog } from "../sidebar/SectionDialog.tsx";
import { RenameDialog } from "./RenameDialog.tsx";
import { WorkspaceRenameDialog } from "./WorkspaceRenameDialog.tsx";
import { runUnarchive } from "./workspace-actions.ts";

export interface WorkspaceActionsMenuProps {
	workspaceId: WorkspaceId;
	/** The button that opens the menu. */
	children: ReactNode;
}

export function WorkspaceActionsMenu({ workspaceId, children }: WorkspaceActionsMenuProps) {
	const actions = useActions();
	const workspace = useWorkspace(workspaceId);
	const sessions = useSessions(workspaceId);
	const sections = useStore(useServices().services.sections.store, (state) => state.sections);
	const readShortcut = useLiveShortcut("sidebar.toggleRead");
	const pinShortcut = useLiveShortcut("sidebar.togglePin");
	const copyLinkShortcut = useLiveShortcut("workspace.copyLink");
	const archiveShortcut = useLiveShortcut("workspace.archive");
	const [renaming, setRenaming] = useState(false);
	const [newSection, setNewSection] = useState(false);
	const [branchPrompt, setBranchPrompt] = useState(false);

	const data = workspace.state === "ready" ? workspace.data : null;
	const archived = data?.state === "archived";
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
				if (result.ok && result.value.needsBranchName) setBranchPrompt(true);
			},
		);

	return (
		<>
			<Menu>
				<MenuTrigger asChild>{children}</MenuTrigger>
				<MenuContent aria-label="Workspace actions">
					<MenuItem
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
					</MenuItem>
					<MenuItem
						shortcut={pinShortcut ?? undefined}
						onSelect={() =>
							void run(pinned ? "Couldn't unpin the workspace" : "Couldn't pin the workspace", () =>
								actions.workspaces.setPinned(workspaceId, !pinned),
							)
						}
					>
						{pinned ? "Unpin" : "Pin"}
					</MenuItem>
					<MenuSub>
						<MenuSubTrigger>Set status</MenuSubTrigger>
						<MenuSubContent aria-label="Set status">
							<MenuRadioGroup value={data?.kanbanStatus ?? ""}>
								{KANBAN_STATUSES.map((status) => (
									<MenuRadioItem key={status} value={status} onSelect={() => setStatus(status)}>
										{KANBAN_COLUMNS[status].label}
									</MenuRadioItem>
								))}
							</MenuRadioGroup>
						</MenuSubContent>
					</MenuSub>
					<MenuSub>
						<MenuSubTrigger>Move to section</MenuSubTrigger>
						<MenuSubContent aria-label="Move to section">
							{sections.length === 0 ? (
								<MenuItem disabled>No sections yet</MenuItem>
							) : (
								sections.map((section) => (
									<MenuItem key={section.id} onSelect={() => moveTo(section)}>
										{section.name}
									</MenuItem>
								))
							)}
							<MenuSeparator />
							<MenuItem onSelect={() => setNewSection(true)}>New section...</MenuItem>
						</MenuSubContent>
					</MenuSub>
					<MenuSeparator />
					{archived ? (
						<MenuItem onSelect={startUnarchive}>Unarchive</MenuItem>
					) : (
						<>
							<MenuItem onSelect={() => setRenaming(true)}>Rename</MenuItem>
							<MenuItem
								shortcut={copyLinkShortcut ?? undefined}
								onSelect={() =>
									void run("Couldn't copy the link", () =>
										actions.app.copyText(buildDeepLink(workspaceId, null)),
									)
								}
							>
								Copy link
							</MenuItem>
							<MenuSeparator />
							<MenuItem
								destructive
								shortcut={archiveShortcut ?? undefined}
								onSelect={() =>
									void run("Couldn't archive the workspace", () =>
										actions.workspaces.archive(workspaceId, { deleteBranch: false }),
									)
								}
							>
								Archive
							</MenuItem>
						</>
					)}
				</MenuContent>
			</Menu>
			<WorkspaceRenameDialog workspaceId={workspaceId} open={renaming} onOpenChange={setRenaming} />
			<RenameDialog
				open={branchPrompt}
				onOpenChange={setBranchPrompt}
				title="Unarchive workspace"
				initialName={data?.branch ?? ""}
				fieldLabel="Branch name"
				submitLabel="Unarchive"
				onSubmit={(name) =>
					runUnarchive(actions, workspaceId, { branchName: name, clearChats: false })
				}
			/>
			<SectionDialog open={newSection} onOpenChange={setNewSection} section={null} />
		</>
	);
}
