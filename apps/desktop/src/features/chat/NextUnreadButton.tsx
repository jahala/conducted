/**
 * @feature NAV-11 Next unread button
 * Owns: The 'Next unread' button in the chat, and the app-level handlers for 'Go to next unread'
 * and 'Next chat needing attention'.
 * Behaviour: ui-map.md 3.3 ('Next unread' button), 5.1 ('Go to next unread'), 5.4 (Cmd+Alt+L).
 * Our design choice: the button is hidden when there is nowhere to go, and its key hint follows a
 * rebind through the command registry. The handlers live in `NextUnreadController`, mounted once
 * at the app root, so both commands work from Home, Settings and a terminal tab too.
 * Must handle: Nothing unread or waiting (hidden); the target is in another workspace (navigates
 * there); the target is the current chat (skipped, see next-unread.ts).
 * Test first: With one other chat unread the button shows and click navigates to that chat.
 */
import type { SessionId } from "@conducted/shared";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useMemo } from "react";
import { useStore } from "zustand";
import { useCommandHandler } from "../../app/command-dispatcher.ts";
import { useServices } from "../../core/context.tsx";
import { useLiveShortcut } from "../../core/hooks.ts";
import type { Workspace } from "../../core/model.ts";
import { sessionWaitsForUser } from "../../core/services/sessions.ts";
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

/** The next chat needing the user, plus a way to open it. Shared with the app-level controller. */
function useNextUnread(currentSessionId: SessionId | null): {
	target: UnreadTarget | null;
	goTo: (target: UnreadTarget) => boolean;
} {
	const { services } = useServices();
	const navigate = useNavigate();
	const workspaces = useStore(services.workspace.store, (state) => state.workspacesById);
	const sessions = useStore(services.sessions.store, (state) => state.sessions);
	const byWorkspace = useStore(services.sessions.store, (state) => state.byWorkspace);
	const openInteractions = useStore(services.sessions.store, (state) => state.openInteractions);
	const liveStates = useStore(services.sessions.store, (state) => state.liveStates);

	const target = useMemo(() => {
		const candidates: UnreadCandidate[] = Object.values(workspaces).map((workspace: Workspace) => {
			const ids = byWorkspace[workspace.id] ?? [];
			const chats = ids.flatMap((id) => {
				const session = sessions[id];
				return session === undefined ? [] : [session];
			});
			const waitingSessionIds = new Set(
				ids.filter((id) => sessionWaitsForUser({ openInteractions, liveStates }, id)),
			);
			return { workspace, sessions: chats, waitingSessionIds };
		});
		const currentSession = currentSessionId === null ? undefined : sessions[currentSessionId];
		const current =
			currentSession === undefined
				? null
				: { workspaceId: currentSession.workspaceId, sessionId: currentSession.id };
		return chooseNextUnread({ candidates, current });
	}, [byWorkspace, currentSessionId, liveStates, openInteractions, sessions, workspaces]);

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

	return { target, goTo };
}

/** The chat on screen, from the route. Null on Home, Settings and every other route. */
function useCurrentSessionId(): SessionId | null {
	return useRouterState({
		select: (state) => {
			const search = state.location.search as { sessionId?: unknown } | undefined;
			return typeof search?.sessionId === "string" ? (search.sessionId as SessionId) : null;
		},
	});
}

/**
 * Registers the two global navigation commands once, at the app root. Both work with no chat open.
 */
export function NextUnreadController() {
	const currentSessionId = useCurrentSessionId();
	const { target, goTo } = useNextUnread(currentSessionId);
	useCommandHandler("chat.nextNeedingAttention", "area", () =>
		target === null ? false : goTo(target),
	);
	useCommandHandler("nav.nextUnread", "base", () => (target === null ? false : goTo(target)));
	return null;
}

export function NextUnreadButton({ currentSessionId }: NextUnreadButtonProps) {
	const { target, goTo } = useNextUnread(currentSessionId);
	const shortcut = useLiveShortcut("chat.nextNeedingAttention");

	if (target === null) return null;

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
