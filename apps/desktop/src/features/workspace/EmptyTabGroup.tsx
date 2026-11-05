/**
 * @feature NAV-10 Empty tab group
 * Owns: What the centre shows when no tab is open: three buttons to start one.
 * Behaviour: ui-map.md 3.2 ('Empty group: three buttons New chat, Browser, Local terminal').
 * Our design choice: 'New chat' is the one primary button, and the browser opens the workspace's
 * own port. This screen shows whenever no tab is open.
 * Must handle: Creating fails (toast, buttons return); the workspace is archived (the gate shows
 * the archived notice instead).
 * Test first: Clicking 'New chat' calls sessions.create and sets tab=session with the new id in the
 * URL.
 */
import type { WorkspaceId } from "@conducted/shared";
import { useState } from "react";
import { useServices } from "../../core/context.tsx";
import { useActions, useWorkspace } from "../../core/hooks.ts";
import { Button } from "../../ui/Button.tsx";
import { GlobeIcon, TerminalIcon } from "../../ui/icons.tsx";
import { toastError } from "../../ui/Toast.tsx";
import type { WorkspaceSearch } from "./workspace-search.ts";

export interface EmptyTabGroupProps {
	workspaceId: WorkspaceId;
	onSearchChange: (patch: Partial<WorkspaceSearch>) => void;
}

export function EmptyTabGroup({ workspaceId, onSearchChange }: EmptyTabGroupProps) {
	const actions = useActions();
	const sessions = useServices().services.sessions;
	const workspace = useWorkspace(workspaceId);
	const [busy, setBusy] = useState<"chat" | "terminal" | null>(null);

	const newChat = async () => {
		if (busy !== null) return;
		setBusy("chat");
		try {
			const created = await sessions.createFromDefaults(workspaceId);
			if (!created.ok) {
				toastError("Couldn't start a chat", created.error);
				return;
			}
			onSearchChange({ tab: "session", sessionId: created.value.id });
		} finally {
			setBusy(null);
		}
	};

	const newTerminal = async () => {
		if (busy !== null) return;
		setBusy("terminal");
		try {
			const created = await actions.terminals.create(workspaceId);
			if (!created.ok) {
				toastError("Couldn't open a terminal", created.error);
				return;
			}
			onSearchChange({ tab: "terminal", terminalId: created.value.id });
		} finally {
			setBusy(null);
		}
	};

	const openBrowser = () => {
		const port = workspace.state === "ready" ? workspace.data.port : 0;
		const host = port > 0 ? `http://localhost:${port}` : "http://localhost";
		onSearchChange({ tab: "browser", browserUrl: host });
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
				<Button variant="secondary" onClick={openBrowser}>
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
