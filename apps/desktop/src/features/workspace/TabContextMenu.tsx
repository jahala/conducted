/**
 * @feature CHAT-01 Chat tab context menu
 * Owns: The right-click menu of a chat tab.
 * Behaviour: ui-map.md 3.2 (chat tab menu: Mark as read or unread, Rename chat, Fork to new tab,
 * Copy concise transcript, Copy full transcript, Copy link, Close tab, Close others).
 * Our design choice: Copy session info is an internal item and is left out. Fork to new tab needs a
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
import { Button } from "../../ui/Button.tsx";
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from "../../ui/ContextMenu.tsx";
import { Dialog, DialogContent, DialogFooter } from "../../ui/Dialog.tsx";
import { toastError } from "../../ui/Toast.tsx";

export interface TabContextMenuProps {
	sessionId: SessionId;
	children: ReactElement;
	/** The chat's current state, for the read label, the link and the rename dialog. */
	session?: Session;
	/** The workspace the chat belongs to, for 'Copy link'. */
	workspaceId?: WorkspaceId;
	/** Called after the chat is closed, so the tab strip can remove its tab. */
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
	const [name, setName] = useState(session?.title ?? "");
	const [busy, setBusy] = useState(false);

	const copyLink = async () => {
		if (workspaceId === undefined) return;
		const copied = await actions.app.copyText(buildDeepLink(workspaceId, sessionId));
		if (!copied.ok) toastError("Couldn't copy the link", copied.error);
	};

	const close = async () => {
		const closed = await actions.sessions.close(sessionId);
		if (!closed.ok) {
			toastError("Couldn't close the chat", closed.error);
			return;
		}
		onClose?.();
	};

	const rename = async () => {
		if (busy) return;
		setBusy(true);
		try {
			const renamed = await actions.sessions.rename(sessionId, name);
			if (!renamed.ok) {
				toastError("Couldn't rename the chat", renamed.error);
				return;
			}
			setRenaming(false);
		} finally {
			setBusy(false);
		}
	};

	const unread = (session?.unreadCount ?? 0) > 0;

	return (
		<>
			<ContextMenu
				items={
					<>
						<ContextMenuItem disabled>{unread ? "Mark as read" : "Mark as unread"}</ContextMenuItem>
						<ContextMenuItem
							onSelect={() => {
								setName(session?.title ?? "");
								setRenaming(true);
							}}
						>
							Rename chat
						</ContextMenuItem>
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
						<ContextMenuItem shortcut={shortcutOf("tab.close")} onSelect={() => void close()}>
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
			<Dialog open={renaming} onOpenChange={setRenaming}>
				<DialogContent
					title="Rename chat"
					onConfirm={() => void rename()}
					className="max-w-md"
					size="md"
				>
					<label className="flex flex-col gap-1.5 text-sm font-medium text-fg">
						Name
						<input
							// The chat's current name is selected so typing replaces it.
							autoFocus
							value={name}
							onChange={(event) => setName(event.target.value)}
							onFocus={(event) => event.target.select()}
							className="h-8 rounded-md border border-border-strong bg-canvas px-3 text-sm text-fg outline-none placeholder:text-fg-subtle focus:border-accent"
						/>
					</label>
					<DialogFooter>
						<Button variant="ghost" onClick={() => setRenaming(false)}>
							Cancel
						</Button>
						<Button
							variant="default"
							loading={busy}
							disabled={name.trim().length === 0}
							onClick={() => void rename()}
						>
							Rename
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
