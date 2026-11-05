/**
 * @feature CHAT-01 Chat tab context menu
 * Owns: The right-click menu of a chat tab.
 * Behaviour: ui-map.md 3.2 (chat tab menu: Mark as read or unread, Rename chat, Fork to new tab,
 * Copy concise transcript, Copy full transcript, Copy link, Close tab, Close others).
 * Our design choice: The rename form is RenameDialog, the one rename dialog. 'Close tab' only reports
 * the choice (onClose); the tab strip closes the chat, so there is one close path and one error
 * toast. Copy session info is an internal item and is left out. Fork to new tab needs a
 * checkpoint and is disabled without one. Mark as read or unread waits for NAV-11 and the two
 * transcript items wait for CHAT-17, so those items stay disabled until their services exist.
 * Must handle: Fork disabled without a checkpoint; Close others with one tab open is disabled by
 * leaving its callback out; items show shortcuts from the command registry.
 * Test first: 'Rename chat' calls sessions.rename with the typed name.
 */

import type { SessionId, WorkspaceId } from "@conducted/shared";
import { type ReactElement, useState } from "react";
import { useActions } from "../../core/hooks.ts";
import type { Session } from "../../core/model.ts";
import { formatShortcut, getCommand } from "../../core/registries/commands.ts";
import { buildDeepLink } from "../../core/services/notifications.ts";
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from "../../ui/ContextMenu.tsx";
import { toastError } from "../../ui/Toast.tsx";
import { RenameDialog } from "./RenameDialog.tsx";

export interface TabContextMenuProps {
	sessionId: SessionId;
	children: ReactElement;
	/** The chat's current state, for the read label, the link and the rename dialog. */
	session?: Session;
	/** The workspace the chat belongs to, for 'Copy link'. */
	workspaceId?: WorkspaceId;
	/** Called when the user picks 'Close tab'. The tab strip closes the chat. */
	onClose?: () => void;
	/** Called by 'Close others'. Disabled when the tab strip has only this tab. */
	onCloseOthers?: () => void;
	/** True when the chat has a checkpoint to fork from. */
	canFork?: boolean;
}

const shortcutOf = (id: string): string | undefined => {
	const command = getCommand(id);
	const first = command?.defaultShortcuts[0];
	return first === undefined ? undefined : formatShortcut(first);
};

export function TabContextMenu({
	sessionId,
	children,
	session,
	workspaceId,
	onClose,
	onCloseOthers,
	canFork = false,
}: TabContextMenuProps) {
	const actions = useActions();
	const [renaming, setRenaming] = useState(false);

	const copyLink = async () => {
		if (workspaceId === undefined) return;
		const copied = await actions.app.copyText(buildDeepLink(workspaceId, sessionId));
		if (!copied.ok) toastError("Couldn't copy the link", copied.error);
	};

	const unread = (session?.unreadCount ?? 0) > 0;

	return (
		<>
			<ContextMenu
				items={
					<>
						<ContextMenuItem disabled>{unread ? "Mark as read" : "Mark as unread"}</ContextMenuItem>
						<ContextMenuItem onSelect={() => setRenaming(true)}>Rename chat</ContextMenuItem>
						<ContextMenuItem disabled={!canFork} shortcut={shortcutOf("chat.fork")}>
							Fork to new tab
						</ContextMenuItem>
						<ContextMenuSeparator />
						<ContextMenuItem disabled shortcut={shortcutOf("chat.copyTranscript")}>
							Copy concise transcript
						</ContextMenuItem>
						<ContextMenuItem disabled>Copy full transcript</ContextMenuItem>
						<ContextMenuItem disabled={workspaceId === undefined} onSelect={() => void copyLink()}>
							Copy link
						</ContextMenuItem>
						<ContextMenuSeparator />
						<ContextMenuItem shortcut={shortcutOf("tab.close")} onSelect={onClose}>
							Close tab
						</ContextMenuItem>
						<ContextMenuItem disabled={onCloseOthers === undefined} onSelect={onCloseOthers}>
							Close others
						</ContextMenuItem>
					</>
				}
			>
				{children}
			</ContextMenu>
			<RenameDialog
				open={renaming}
				onOpenChange={setRenaming}
				title="Rename chat"
				initialName={session?.title ?? ""}
				onSubmit={(name) => actions.sessions.rename(sessionId, name)}
			/>
		</>
	);
}
