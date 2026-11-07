/**
 * @feature NAV-10 New tab actions
 * Owns: starting a chat, a terminal or the browser tab from any of the three places that offer it.
 * Behaviour: ui-map.md 3.2 ('+' menu, empty tab group, Cmd+T; big terminal mode creates a centre
 * terminal with its startup command; the browser opens the workspace's own port).
 * Our design choice: One hook so the three callers behave the same. A NewTabProvider shares one
 * single-flight across them, so Cmd+T during a menu click cannot start two chats. The browser is
 * offered only once the workspace has a port; without one the action reports why instead of
 * inventing a localhost URL.
 * Must handle: creating fails (toast, no tab); a second request while one runs (the same promise,
 * one creation); the workspace with no port yet (browser unavailable); a workspace without a chat
 * (New chat still works).
 * Test first: two new-chat calls at the same time while the first is pending create one chat.
 */
import type { WorkspaceId } from "@conducted/shared";
import { createContext, type ReactNode, useContext, useRef, useState } from "react";
import { createSingleFlight, type SingleFlight } from "../../core/async/single-flight.ts";
import { useServices } from "../../core/context.tsx";
import { useActions, useSessions, useSetting, useWorkspace } from "../../core/hooks.ts";
import { toastError } from "../../ui/Toast.tsx";
import type { WorkspaceSearch } from "./workspace-search.ts";

const NewTabFlightContext = createContext<SingleFlight | null>(null);

/** Shares one single-flight with every new-tab caller below it. */
export function NewTabProvider({ children }: { children: ReactNode }) {
	const [flight] = useState(createSingleFlight);
	return <NewTabFlightContext.Provider value={flight}>{children}</NewTabFlightContext.Provider>;
}

export interface NewTabActions {
	newChat: (sameFiles?: boolean) => Promise<boolean>;
	newTerminal: () => Promise<boolean>;
	openBrowser: () => boolean;
	/** False until the workspace has a port, so the caller can disable Browser. */
	browserAvailable: boolean;
	/** True when there is a chat to copy the files from. */
	hasRecentChat: boolean;
	/** "Cloud terminal" in a cloud workspace, "Local terminal" on the Mac (CLOUD-09). */
	terminalLabel: "Cloud terminal" | "Local terminal";
}

export function useNewTab({
	workspaceId,
	onSearchChange,
}: {
	workspaceId: WorkspaceId;
	onSearchChange: (patch: Partial<WorkspaceSearch>) => void;
}): NewTabActions {
	const actions = useActions();
	const sessions = useServices().services.sessions;
	const openChats = useSessions(workspaceId);
	const workspace = useWorkspace(workspaceId);
	const bigTerminalMode = useSetting<boolean>("experimental_big_terminal_mode");
	const startupCommand = useSetting<string>("big_terminal_preset");
	const provided = useContext(NewTabFlightContext);
	const local = useRef<SingleFlight | null>(null);
	if (local.current === null) local.current = createSingleFlight();
	const flight = provided ?? local.current;

	const newestChat = openChats.state === "ready" ? openChats.data[0] : undefined;
	const port = workspace.state === "ready" ? workspace.data.port : 0;
	const browserAvailable = port > 0;
	const cloudWorkspace = workspace.state === "ready" && workspace.data.host?.kind === "cloud";
	const keyPrefix = `workspace:${workspaceId}`;

	const newChat = (sameFiles = false): Promise<boolean> =>
		flight.run(`${keyPrefix}:newChat`, async () => {
			const created =
				sameFiles && newestChat !== undefined
					? await sessions.create(workspaceId, newestChat.config)
					: await sessions.createFromDefaults(workspaceId);
			if (!created.ok) {
				toastError("Couldn't start a chat", created.error);
				return false;
			}
			onSearchChange({ tab: "session", sessionId: created.value.id });
			return true;
		});

	const newTerminal = (): Promise<boolean> =>
		flight.run(`${keyPrefix}:newTerminal`, async () => {
			const command =
				bigTerminalMode && startupCommand !== null && startupCommand.trim() !== ""
					? { command: startupCommand.trim() }
					: undefined;
			const created = await actions.terminals.create(workspaceId, command);
			if (!created.ok) {
				toastError("Couldn't open a terminal", created.error);
				return false;
			}
			onSearchChange({ tab: "terminal", terminalId: created.value.id });
			return true;
		});

	const openBrowser = (): boolean => {
		if (!browserAvailable) {
			toastError("Couldn't open the browser", {
				message: "The workspace has no port yet. Open it once the port is known.",
			});
			return false;
		}
		onSearchChange({ tab: "browser", browserUrl: `http://localhost:${port}` });
		return true;
	};

	return {
		newChat,
		newTerminal,
		openBrowser,
		browserAvailable,
		hasRecentChat: newestChat !== undefined,
		terminalLabel: cloudWorkspace ? "Cloud terminal" : "Local terminal",
	};
}
