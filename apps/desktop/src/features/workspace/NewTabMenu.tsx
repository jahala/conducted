/**
 * @feature NAV-10 New tab menu
 * Owns: The '+' button and its menu: New chat (or New chat, same files), Browser, Local terminal.
 * Behaviour: ui-map.md 3.2 ('+' new tab menu, Cmd+T; buttons disable at the tab limit; big
 * terminal mode creates a centre terminal with its startup command).
 * Our design choice: "New chat, same files" reuses the newest open chat's config, so the new chat
 * starts with the same working directories. The browser tab starts on the workspace's own port.
 * Must handle: At the tab limit (items disabled, the menu says why); creating fails (toast with the
 * message); the new tab becomes active; a workspace without a chat still offers New chat.
 * Test first: Choosing 'Local terminal' calls terminals.create and sets the terminal tab in the
 * URL.
 */
import type { WorkspaceId } from "@conducted/shared";
import { useState } from "react";
import { useServices } from "../../core/context.tsx";
import { useActions, useSessions, useSetting, useWorkspace } from "../../core/hooks.ts";
import { Button } from "../../ui/Button.tsx";
import { PlusIcon } from "../../ui/icons.tsx";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "../../ui/Menu.tsx";
import { toastError } from "../../ui/Toast.tsx";
import type { WorkspaceSearch } from "./workspace-search.ts";

export interface NewTabMenuProps {
	workspaceId: WorkspaceId;
	atTabLimit: boolean;
	onSearchChange: (patch: Partial<WorkspaceSearch>) => void;
}

export function NewTabMenu({ workspaceId, atTabLimit, onSearchChange }: NewTabMenuProps) {
	const actions = useActions();
	const sessions = useServices().services.sessions;
	const openChats = useSessions(workspaceId);
	const workspace = useWorkspace(workspaceId);
	const bigTerminalMode = useSetting<boolean>("experimental_big_terminal_mode");
	const startupCommand = useSetting<string>("big_terminal_preset");
	const [open, setOpen] = useState(false);
	const [busy, setBusy] = useState(false);

	const newestChat = openChats.state === "ready" ? openChats.data[0] : undefined;

	const newChat = async (sameFiles: boolean) => {
		if (busy) return;
		setBusy(true);
		try {
			const created =
				sameFiles && newestChat !== undefined
					? await sessions.create(workspaceId, newestChat.config)
					: await sessions.createFromDefaults(workspaceId);
			if (!created.ok) {
				toastError("Couldn't start a chat", created.error);
				return;
			}
			setOpen(false);
			onSearchChange({ tab: "session", sessionId: created.value.id });
		} finally {
			setBusy(false);
		}
	};

	const newTerminal = async () => {
		if (busy) return;
		setBusy(true);
		try {
			const command = bigTerminalMode ? startupCommand.trim() : "";
			const created = await actions.terminals.create(
				workspaceId,
				command === "" ? undefined : { command },
			);
			if (!created.ok) {
				toastError("Couldn't open a terminal", created.error);
				return;
			}
			setOpen(false);
			onSearchChange({ tab: "terminal", terminalId: created.value.id });
		} finally {
			setBusy(false);
		}
	};

	const openBrowser = () => {
		const port = workspace.state === "ready" ? workspace.data.port : 0;
		const host = port > 0 ? `http://localhost:${port}` : "http://localhost";
		setOpen(false);
		onSearchChange({ tab: "browser", browserUrl: host });
	};

	return (
		<Menu open={open} onOpenChange={setOpen}>
			<MenuTrigger asChild>
				<Button variant="ghost" size="sm" className="w-7 px-0" aria-label="New tab">
					<PlusIcon />
				</Button>
			</MenuTrigger>
			<MenuContent aria-label="New tab">
				<MenuItem disabled={atTabLimit} onSelect={() => void newChat(false)}>
					New chat
				</MenuItem>
				{newestChat !== undefined ? (
					<MenuItem disabled={atTabLimit} onSelect={() => void newChat(true)}>
						New chat, same files
					</MenuItem>
				) : null}
				<MenuItem disabled={atTabLimit} onSelect={openBrowser}>
					Browser
				</MenuItem>
				<MenuItem disabled={atTabLimit} onSelect={() => void newTerminal()}>
					Local terminal
				</MenuItem>
				{atTabLimit ? (
					<>
						<MenuSeparator />
						<p className="px-2 py-1 text-xs text-fg-subtle">Close a tab before opening another.</p>
					</>
				) : null}
			</MenuContent>
		</Menu>
	);
}
