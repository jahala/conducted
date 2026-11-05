/**
 * @feature NAV-10 New tab menu
 * Owns: The '+' button and its menu: New chat (or New chat, same files), Browser, Local terminal.
 * Behaviour: ui-map.md 3.2 ('+' new tab menu, Cmd+T; buttons disable at the tab limit; big
 * terminal mode creates a centre terminal with its startup command).
 * Our design choice: The three actions come from useNewTab, so this menu, the empty tab group and
 * Cmd+T behave the same. The browser item waits for the workspace's port.
 * Must handle: At the tab limit (items disabled, the menu says why); creating fails (toast with the
 * message); the new tab becomes active; a workspace without a chat still offers New chat; no port
 * yet (Browser disabled).
 * Test first: Choosing 'Local terminal' calls terminals.create and sets the terminal tab in the
 * URL.
 */
import type { WorkspaceId } from "@conducted/shared";
import { useState } from "react";
import { Button } from "../../ui/Button.tsx";
import { PlusIcon } from "../../ui/icons.tsx";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "../../ui/Menu.tsx";
import { useNewTab } from "./useNewTab.tsx";
import type { WorkspaceSearch } from "./workspace-search.ts";

export interface NewTabMenuProps {
	workspaceId: WorkspaceId;
	atTabLimit: boolean;
	onSearchChange: (patch: Partial<WorkspaceSearch>) => void;
}

export function NewTabMenu({ workspaceId, atTabLimit, onSearchChange }: NewTabMenuProps) {
	const [open, setOpen] = useState(false);
	const newTab = useNewTab({ workspaceId, onSearchChange });

	const startChat = async (sameFiles: boolean) => {
		if (await newTab.newChat(sameFiles)) setOpen(false);
	};

	const startTerminal = async () => {
		if (await newTab.newTerminal()) setOpen(false);
	};

	const openBrowser = () => {
		if (newTab.openBrowser()) setOpen(false);
	};

	return (
		<Menu open={open} onOpenChange={setOpen}>
			<MenuTrigger asChild>
				<Button variant="ghost" size="sm" className="w-7 px-0" aria-label="New tab">
					<PlusIcon />
				</Button>
			</MenuTrigger>
			<MenuContent aria-label="New tab">
				<MenuItem disabled={atTabLimit} onSelect={() => void startChat(false)}>
					New chat
				</MenuItem>
				{newTab.hasRecentChat ? (
					<MenuItem disabled={atTabLimit} onSelect={() => void startChat(true)}>
						New chat, same files
					</MenuItem>
				) : null}
				<MenuItem disabled={atTabLimit || !newTab.browserAvailable} onSelect={openBrowser}>
					Browser
				</MenuItem>
				<MenuItem disabled={atTabLimit} onSelect={() => void startTerminal()}>
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
