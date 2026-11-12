/**
 * @feature DATA-01 Query hook contract for screens
 * @feature CHAT-15 Revert to a turn: the count of files a reset puts back
 * @feature CHAT-26 Start a chat with earlier chats and plans: the workspace's plans
 * Owns: the chat hooks and the session-store helpers they share.
 * Behaviour: services-map.md 1.3; core/hooks.ts states the contract.
 * Must handle: a chat that no longer exists, a session whose events have not arrived.
 * Test first: the test for a hook body lives with the feature that implements it.
 */
import { type AppError, appError, type SessionId, type TurnId } from "@conducted/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useStore } from "zustand";
import type { Loadable, Queries } from "../api.ts";
import { useServices } from "../context.tsx";
import type { ChatView, PlanEntry, Session } from "../model.ts";
import type { SessionsState } from "../services/sessions.ts";

/** Reads one slice of a service's store and re-renders when it changes. */
function useSessionSlice<T>(select: (state: SessionsState) => T): T {
	const services = useServices();
	const store = services.services.sessions.store;
	return useSyncExternalStore(
		store.subscribe,
		() => select(store.getState()),
		() => select(store.getState()),
	);
}

function listOf(
	loaded: boolean,
	loadError: AppError | null | undefined,
	sessions: SessionsState["sessions"],
	ids: readonly SessionId[] | undefined,
	workspaceId: string,
	closed: boolean,
): Loadable<Session[]> {
	if (loadError != null) return { state: "error", error: loadError };
	if (!loaded) return { state: "loading" };
	if (closed) {
		const data = Object.values(sessions)
			.filter((session) => session.workspaceId === workspaceId && session.closedAt !== null)
			.sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0));
		return { state: "ready", data };
	}
	const data = (ids ?? []).flatMap((id) => {
		const session = sessions[id];
		return session === undefined ? [] : [session];
	});
	return { state: "ready", data };
}

/**
 * The chat list of one workspace. It reads only the slices the list depends on, so streaming
 * events, live states and drafts do not re-render it, and the result keeps its identity until a
 * chat row or the list itself changes.
 */
function useSessionList(workspaceId: string, closed: boolean): Loadable<Session[]> {
	const loaded = useSessionSlice((state) => state.loaded);
	const loadError = useSessionSlice((state) => state.loadError);
	const sessions = useSessionSlice((state) => state.sessions);
	const ids = useSessionSlice((state) => state.byWorkspace[workspaceId]);
	return useMemo(
		() => listOf(loaded, loadError, sessions, ids, workspaceId, closed),
		[loaded, loadError, sessions, ids, workspaceId, closed],
	);
}

export const useSessions: Queries["useSessions"] = (workspaceId) =>
	useSessionList(workspaceId, false);
export const useChat: Queries["useChat"] = (sessionId) => {
	const services = useServices();
	const sessions = services.services.sessions;
	const state = useSessionSlice((value) => value);
	useStore(services.services.followUpQueue.store, (queue) => queue.bySession[sessionId]);

	return useMemo<Loadable<ChatView>>(() => {
		if (state.loadError != null) return { state: "error", error: state.loadError };
		if (!state.loaded) return { state: "loading" };
		if (state.sessions[sessionId] === undefined) {
			return { state: "error", error: appError("session_unknown", "That chat no longer exists.") };
		}
		// Ready once the chat's last turns are read (CHAT-06).
		if (state.histories[sessionId] === undefined) return { state: "loading" };
		const data = sessions.chatView(sessionId);
		return data === null ? { state: "loading" } : { state: "ready", data };
	}, [state, sessionId, sessions]);
};
export const useClosedSessions: Queries["useClosedSessions"] = (workspaceId) =>
	useSessionList(workspaceId, true);

/**
 * The plans agents proposed in a workspace's chats, newest first (CHAT-26). Read when a screen
 * mounts or the workspace changes, so an empty chat opened after a new plan lists it. An answer
 * for a workspace the screen has left is dropped.
 */
export const usePlans: Queries["usePlans"] = (workspaceId) => {
	const sessions = useServices().services.sessions;
	const [plans, setPlans] = useState<{ workspaceId: string; value: Loadable<PlanEntry[]> }>({
		workspaceId,
		value: { state: "loading" },
	});
	useEffect(() => {
		let current = true;
		void sessions.listPlans(workspaceId).then((result) => {
			if (!current) return;
			setPlans({
				workspaceId,
				value: result.ok
					? { state: "ready", data: result.value }
					: { state: "error", error: result.error },
			});
		});
		return () => {
			current = false;
		};
	}, [sessions, workspaceId]);
	return plans.workspaceId === workspaceId ? plans.value : { state: "loading" };
};

const changedSinceTurnKey = (sessionId: SessionId, turnId: TurnId) =>
	["checkpoint", sessionId, turnId, "changed-since"] as const;

/**
 * Reads the count with the checkpointer's diff each time a screen asks for it. It does not poll:
 * the reset dialog asks once when it opens.
 */
export const useChangedSinceTurn: Queries["useChangedSinceTurn"] = (sessionId, turnId) => {
	const checkpoint = useServices().services.checkpoint;
	const query = useQuery<number, AppError>({
		queryKey: changedSinceTurnKey(sessionId, turnId),
		queryFn: async () => {
			const result = await checkpoint.changedSinceTurn(sessionId, turnId);
			if (!result.ok) throw result.error;
			return result.value;
		},
		staleTime: 0,
	});
	if (query.isError && query.error !== null) return { state: "error", error: query.error };
	if (query.data === undefined) return { state: "loading" };
	return { state: "ready", data: query.data };
};
