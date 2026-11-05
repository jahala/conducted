/**
 * @feature NAV-10 Workspace actions menu
 * Owns: The one menu of workspace actions. The header uses the dropdown surface now; the sidebar
 * row can show the same items through the context surface.
 * Behaviour: ui-map.md 3.1 ('Workspace actions' menu: mark as read or unread, pin or unpin, set
 * status, move to section, rename, copy link, archive or unarchive).
 * Our design choice: One list, two surfaces: the items come from a single component so both menus
 * always agree. Cloud items (follow, reassign, share) are left out. Shortcut hints come from the
 * command registry.
 * Must handle: Archived workspace (Unarchive instead of Archive, no Rename); mark as read or unread
 * follows the chats' unread count; move to section lists the known sections and 'New section...'; a
 * failed action shows a toast.
 * Test first: Choosing Pin calls workspaces.setPinned(id, true); for a pinned workspace the item
 * reads Unpin.
 */
import type { WorkspaceId } from "@conducted/shared";
import type { ReactElement, ReactNode } from "react";
import { useState } from "react";
import { useStore } from "zustand";
import { useServices } from "../../core/context.tsx";
import { useActions, useSessions, useWorkspace } from "../../core/hooks.ts";
import type { KanbanStatus, Section } from "../../core/model.ts";
import { formatShortcut, getCommand } from "../../core/registries/commands.ts";
import { buildDeepLink } from "../../core/services/notifications.ts";
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
import { RenameDialog } from "./RenameDialog.tsx";

export interface WorkspaceActionsMenuProps {
	workspaceId: WorkspaceId;
	/** The button or row that opens the menu. */
	children: ReactNode;
	surface: "dropdown" | "context";
}

const STATUS_LABELS: readonly { status: KanbanStatus; label: string }[] = [
	{ status: "backlog", label: "Backlog" },
	{ status: "in_progress", label: "In progress" },
	{ status: "in_review", label: "In review" },
	{ status: "done", label: "Done" },
	{ status: "canceled", label: "Canceled" },
];

const shortcutOf = (id: string): string | undefined => {
	const command = getCommand(id);
	const first = command?.defaultShortcuts[0];
	return first === undefined ? undefined : formatShortcut(first);
};

export function WorkspaceActionsMenu({
	workspaceId,
	children,
	surface,
}: WorkspaceActionsMenuProps) {
	const actions = useActions();
	const workspace = useWorkspace(workspaceId);
	const sessions = useSessions(workspaceId);
	const sections = useStore(useServices().services.sections.store, (state) => state.sections);
	const [renaming, setRenaming] = useState(false);
	const [newSection, setNewSection] = useState(false);

	const data = workspace.state === "ready" ? workspace.data : null;
	const archived = data?.state === "archived";
	const pinned = data?.pinnedAt != null;
	const unread =
		sessions.state === "ready" && sessions.data.some((session) => session.unreadCount > 0);

	const run = async (title: string, action: () => Promise<{ ok: boolean; error?: unknown }>) => {
		try {
			const result = await action();
			if (!result.ok) {
				toastError(title, result.error as { message: string });
			}
		} catch (caught) {
			toastError(title, caught instanceof Error ? caught : { message: String(caught) });
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

	const items = (Parts: {
		Item: typeof MenuItem | typeof ContextMenuItem;
		Separator: typeof MenuSeparator | typeof ContextMenuSeparator;
		Sub: typeof MenuSub | typeof ContextMenuSub;
		SubTrigger: typeof MenuSubTrigger | typeof ContextMenuSubTrigger;
		SubContent: typeof MenuSubContent | typeof ContextMenuSubContent;
		RadioGroup: typeof MenuRadioGroup | typeof ContextMenuRadioGroup;
		RadioItem: typeof MenuRadioItem | typeof ContextMenuRadioItem;
	}): ReactNode => {
		const { Item, Separator, Sub, SubTrigger, SubContent, RadioGroup, RadioItem } = Parts;
		return (
			<>
				<Item
					shortcut={shortcutOf("sidebar.toggleRead")}
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
				</Item>
				<Item
					shortcut={shortcutOf("sidebar.togglePin")}
					onSelect={() =>
						void run(pinned ? "Couldn't unpin the workspace" : "Couldn't pin the workspace", () =>
							actions.workspaces.setPinned(workspaceId, !pinned),
						)
					}
				>
					{pinned ? "Unpin" : "Pin"}
				</Item>
				<Sub>
					<SubTrigger>Set status</SubTrigger>
					<SubContent aria-label="Set status">
						<RadioGroup value={data?.kanbanStatus ?? ""}>
							{STATUS_LABELS.map(({ status, label }) => (
								<RadioItem key={status} value={status} onSelect={() => setStatus(status)}>
									{label}
								</RadioItem>
							))}
						</RadioGroup>
					</SubContent>
				</Sub>
				<Sub>
					<SubTrigger>Move to section</SubTrigger>
					<SubContent aria-label="Move to section">
						{sections.length === 0 ? (
							<Item disabled>No sections yet</Item>
						) : (
							sections.map((section) => (
								<Item key={section.id} onSelect={() => moveTo(section)}>
									{section.name}
								</Item>
							))
						)}
						<Separator />
						<Item onSelect={() => setNewSection(true)}>New section...</Item>
					</SubContent>
				</Sub>
				<Separator />
				{archived ? (
					<Item
						onSelect={() =>
							void run("Couldn't unarchive the workspace", () =>
								actions.workspaces.unarchive(workspaceId, {
									branchName: null,
									clearChats: false,
								}),
							)
						}
					>
						Unarchive
					</Item>
				) : (
					<>
						<Item onSelect={() => setRenaming(true)}>Rename</Item>
						<Item
							shortcut={shortcutOf("workspace.copyLink")}
							onSelect={() =>
								void run("Couldn't copy the link", () =>
									actions.app.copyText(buildDeepLink(workspaceId, null)),
								)
							}
						>
							Copy link
						</Item>
						<Separator />
						<Item
							destructive
							shortcut={shortcutOf("workspace.archive")}
							onSelect={() =>
								void run("Couldn't archive the workspace", () =>
									actions.workspaces.archive(workspaceId, { deleteBranch: false }),
								)
							}
						>
							Archive
						</Item>
					</>
				)}
			</>
		);
	};

	const menu = (
		<>
			{surface === "dropdown" ? (
				<Menu>
					<MenuTrigger asChild>{children}</MenuTrigger>
					<MenuContent aria-label="Workspace actions">
						{items({
							Item: MenuItem,
							Separator: MenuSeparator,
							Sub: MenuSub,
							SubTrigger: MenuSubTrigger,
							SubContent: MenuSubContent,
							RadioGroup: MenuRadioGroup,
							RadioItem: MenuRadioItem,
						})}
					</MenuContent>
				</Menu>
			) : (
				<ContextMenu
					items={items({
						Item: ContextMenuItem,
						Separator: ContextMenuSeparator,
						Sub: ContextMenuSub,
						SubTrigger: ContextMenuSubTrigger,
						SubContent: ContextMenuSubContent,
						RadioGroup: ContextMenuRadioGroup,
						RadioItem: ContextMenuRadioItem,
					})}
				>
					{children as ReactElement}
				</ContextMenu>
			)}
			<RenameDialog
				open={renaming}
				onOpenChange={setRenaming}
				title="Rename workspace"
				initialName={data?.displayName ?? ""}
				onSubmit={async (name) => {
					const result = await actions.workspaces.rename(workspaceId, name);
					if (!result.ok) throw new Error(result.error.message);
				}}
			/>
			<RenameDialog
				open={newSection}
				onOpenChange={setNewSection}
				title="New section"
				initialName=""
				onSubmit={async (name) => {
					const result = await actions.sections.create(name, null);
					if (!result.ok) throw new Error(result.error.message);
				}}
			/>
		</>
	);

	return menu;
}
