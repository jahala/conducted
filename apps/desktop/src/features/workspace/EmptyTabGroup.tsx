/**
 * @feature NAV-10 Empty tab group
 * Owns: What the centre shows when no tab is open: three buttons to start one.
 * Behaviour: ui-map.md 3.2 ('Empty group: three buttons New chat, Browser, Local terminal').
 * Our design choice: 'New chat' is the one primary button; all three actions come from useNewTab,
 * so the big-terminal preset behaves as it does in the '+' menu. The browser waits for a port.
 * Must handle: Creating fails (toast, buttons return); the workspace is archived (the gate shows
 * the archived notice instead); no port yet (Browser disabled).
 * Test first: Clicking 'New chat' calls sessions.create and sets tab=session with the new id in the
 * URL.
 */
import type { WorkspaceId } from "@conducted/shared";
import { useState } from "react";
import { Button } from "../../ui/Button.tsx";
import { GlobeIcon, TerminalIcon } from "../../ui/icons.tsx";
import { useNewTab } from "./useNewTab.tsx";
import type { WorkspaceSearch } from "./workspace-search.ts";

export interface EmptyTabGroupProps {
	workspaceId: WorkspaceId;
	onSearchChange: (patch: Partial<WorkspaceSearch>) => void;
}

export function EmptyTabGroup({ workspaceId, onSearchChange }: EmptyTabGroupProps) {
	const newTab = useNewTab({ workspaceId, onSearchChange });
	const [busy, setBusy] = useState<"chat" | "terminal" | null>(null);

	const newChat = async () => {
		setBusy("chat");
		try {
			await newTab.newChat(false);
		} finally {
			setBusy(null);
		}
	};

	const newTerminal = async () => {
		setBusy("terminal");
		try {
			await newTab.newTerminal();
		} finally {
			setBusy(null);
		}
	};

	const openBrowser = () => {
		newTab.openBrowser();
	};

	return (
		<div className="flex h-full w-full flex-col items-center justify-center gap-4 p-10 text-center">
			<div>
				<h2 className="text-xl font-medium text-fg">No tab is open</h2>
				<p className="mt-1 max-w-prose text-sm text-fg-muted">
					Start a chat, open the workspace's preview in a browser, or open a terminal.
				</p>
			</div>
			<div className="flex items-center gap-2">
				<Button variant="default" loading={busy === "chat"} onClick={() => void newChat()}>
					New chat
				</Button>
				<Button
					variant="secondary"
					disabled={!newTab.browserAvailable}
					title={newTab.browserAvailable ? undefined : "The workspace has no port yet."}
					onClick={openBrowser}
				>
					<GlobeIcon />
					Browser
				</Button>
				<Button
					variant="secondary"
					loading={busy === "terminal"}
					onClick={() => void newTerminal()}
				>
					<TerminalIcon />
					Local terminal
				</Button>
			</div>
		</div>
	);
}
