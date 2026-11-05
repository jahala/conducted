/**
 * @feature NAV-11 Next unread button
 * Owns: The 'Next unread' button in the chat, and the handlers for 'Go to next unread' and 'Next
 * chat needing attention' while a chat is open.
 * Behaviour: ui-map.md 3.3 ('Next unread' button), 5.1 ('Go to next unread'), 5.4 (Cmd+Alt+L).
 * Our design choice: the button is hidden when there is nowhere to go, and its key hint follows a
 * rebind through the command registry.
 * Must handle: Nothing unread (hidden); the target is in another workspace (navigates there); the
 * target is the current chat (skipped, see next-unread.ts).
 * Test first: With one other chat unread the button shows and click navigates to that chat.
 */
import { idleLiveState } from "@conducted/protocol";
import type { SessionId } from "@conducted/shared";
import { useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { useStore } from "zustand";
import { useCommandHandler } from "../../app/command-dispatcher.ts";
import { useServices } from "../../core/context.tsx";
import { useLiveShortcut } from "../../core/hooks.ts";
import { deriveWorkspaceStatus } from "../../core/status/workspace-status.ts";
import { Button } from "../../ui/Button.tsx";
import { Kbd } from "../../ui/Kbd.tsx";
import {
	chooseNextUnread,
	type UnreadCandidate,
	type UnreadTarget,
} from "../sidebar/next-unread.ts";

export interface NextUnreadButtonProps {
	currentSessionId: SessionId;
}

export function NextUnreadButton({ currentSessionId }: NextUnreadButtonProps) {
	const { services } = useServices();
	const navigate = useNavigate();
	const workspaces = useStore(services.workspace.store, (state) => state.workspacesById);
	const setup = useStore(services.workspace.store, (state) => state.setup);
	const sessions = useStore(services.sessions.store, (state) => state.sessions);
	const byWorkspace = useStore(services.sessions.store, (state) => state.byWorkspace);
	const liveStates = useStore(services.sessions.store, (state) => state.liveStates);
	const cancelling = useStore(services.sessions.store, (state) => state.cancelling);
	const shortcut = useLiveShortcut("chat.nextNeedingAttention");

	const target = useMemo(() => {
		const candidates: UnreadCandidate[] = Object.values(workspaces).map((workspace) => {
			const ids = byWorkspace[workspace.id] ?? [];
			const chats = ids.flatMap((id) => {
				const session = sessions[id];
				return session === undefined ? [] : [session];
			});
			const status = deriveWorkspaceStatus({
				state: workspace.state,
				settingUp: setup[workspace.id] === "running",
				chats: ids.map((id) => ({
					liveState: liveStates[id] ?? idleLiveState,
					cancelling: cancelling[id] === true,
					closed: sessions[id]?.closedAt != null,
				})),
				git: null,
			});
			return { workspace, status, sessions: chats };
		});
		const currentSession = sessions[currentSessionId];
		const current =
			currentSession === undefined
				? null
				: { workspaceId: currentSession.workspaceId, sessionId: currentSessionId };
		return chooseNextUnread({ candidates, current });
	}, [byWorkspace, cancelling, currentSessionId, liveStates, sessions, setup, workspaces]);

	const goTo = (next: UnreadTarget): boolean => {
		const workspace = workspaces[next.workspaceId];
		if (workspace === undefined) return false;
		void navigate({
			to: "/repository/$repositoryId/workspace/$workspaceId",
			params: { repositoryId: workspace.repoId, workspaceId: workspace.id },
			search: { tab: "session", sessionId: next.sessionId } as never,
		});
		return true;
	};

	useCommandHandler("chat.nextNeedingAttention", "area", () =>
		target === null ? false : goTo(target),
	);
	useCommandHandler("nav.nextUnread", "base", () => (target === null ? false : goTo(target)));

	if (target === null) return null;
	const workspace = workspaces[target.workspaceId];
	if (workspace === undefined) return null;

	return (
		<Button
			variant="secondary"
			size="sm"
			aria-label="Next unread"
			title={shortcut === null ? "Next unread" : `Next unread (${shortcut})`}
			onClick={() => goTo(target)}
		>
			<span>Next unread</span>
			{shortcut === null ? null : <Kbd>{shortcut}</Kbd>}
		</Button>
	);
}
