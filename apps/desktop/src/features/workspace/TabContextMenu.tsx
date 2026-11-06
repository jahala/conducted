/**
 * @feature CHAT-01 Chat tab context menu; CHAT-16 Fork a chat from a turn
 * Owns: The right-click menu of a chat tab.
 * Behaviour: ui-map.md 3.2 (chat tab menu: Mark as read or unread, Rename chat, Fork to new tab,
 * Copy concise transcript, Copy full transcript, Copy link, Close tab, Close others).
 * Our design choice: The rename form is RenameDialog, the one rename dialog. 'Close tab' only reports
 * the choice (onClose); the tab strip closes the chat, so there is one close path and one error
 * toast. Copy session info is an internal item and is left out. Fork to new tab (CHAT-16) shows
 * only while the Experimental setting is on, and its action belongs to the tab strip. The two
 * transcript items copy the chat's stored turns (CHAT-17).
 * Must handle: Fork hidden while the setting is off; Close others with one tab open is disabled by
 * leaving its callback out; items show shortcuts from the command registry.
 * Test first: 'Rename chat' calls sessions.rename with the typed name.
 */

import type { SessionId, WorkspaceId } from "@conducted/shared";
import { type ReactElement, useState } from "react";
import { useActions, useLiveShortcut } from "../../core/hooks.ts";
import type { Session } from "../../core/model.ts";
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
	/** True while the Experimental 'Fork chat to new tab' setting is on (CHAT-16). */
	forkEnabled?: boolean;
	/** Forks the chat and opens the new tab. */
	onFork?: () => void;
}

export function TabContextMenu({
	sessionId,
	children,
	session,
	workspaceId,
	onClose,
	onCloseOthers,
	forkEnabled = false,
	onFork,
}: TabContextMenuProps) {
	const actions = useActions();
	const forkShortcut = useLiveShortcut("chat.fork");
	const transcriptShortcut = useLiveShortcut("chat.copyTranscript");
	const closeShortcut = useLiveShortcut("tab.close");
	const [renaming, setRenaming] = useState(false);

	const copyLink = async () => {
		if (workspaceId === undefined) return;
		const copied = await actions.app.copyText(buildDeepLink(workspaceId, sessionId));
		if (!copied.ok) toastError("Couldn't copy the link", copied.error);
	};

	const copyTranscript = async (detail: "concise" | "full") => {
		const copied = await actions.sessions.copyTranscript(sessionId, detail);
		if (!copied.ok) toastError("Couldn't copy the transcript", copied.error);
	};

	const unread = (session?.unreadCount ?? 0) > 0;

	const toggleRead = () => {
		const label = unread ? "Couldn't mark the chat as read" : "Couldn't mark the chat as unread";
		void (
			unread ? actions.sessions.markRead(sessionId) : actions.sessions.markUnread(sessionId)
		).then((result) => {
			if (!result.ok) toastError(label, result.error);
		});
	};

	return (
		<>
			<ContextMenu
				items={
					<>
						<ContextMenuItem onSelect={toggleRead}>
							{unread ? "Mark as read" : "Mark as unread"}
						</ContextMenuItem>
						<ContextMenuItem onSelect={() => setRenaming(true)}>Rename chat</ContextMenuItem>
						{forkEnabled ? (
							<ContextMenuItem
								disabled={onFork === undefined}
								shortcut={forkShortcut ?? undefined}
								onSelect={onFork}
							>
								Fork to new tab
							</ContextMenuItem>
						) : null}
						<ContextMenuSeparator />
						<ContextMenuItem
							shortcut={transcriptShortcut ?? undefined}
							onSelect={() => void copyTranscript("concise")}
						>
							Copy concise transcript
						</ContextMenuItem>
						<ContextMenuItem onSelect={() => void copyTranscript("full")}>
							Copy full transcript
						</ContextMenuItem>
						<ContextMenuItem disabled={workspaceId === undefined} onSelect={() => void copyLink()}>
							Copy link
						</ContextMenuItem>
						<ContextMenuSeparator />
						<ContextMenuItem shortcut={closeShortcut ?? undefined} onSelect={onClose}>
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
