/**
 * @feature DATA-01 Query hook contract for screens
 * Owns: the chat hooks and the session-store helpers they share.
 * Behaviour: services-map.md 1.3; core/hooks.ts states the contract.
 * Must handle: a chat that no longer exists, a session whose events have not arrived.
 * Test first: the test for a hook body lives with the feature that implements it.
 */
import { appError, notImplemented } from "@conducted/shared";
import { useMemo, useSyncExternalStore } from "react";
import { useStore } from "zustand";
import type { Loadable, Queries } from "../api.ts";
import { useServices } from "../context.tsx";
import type { ChatView, Session } from "../model.ts";
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

function sessionsOf(
	state: SessionsState,
	workspaceId: string,
	closed: boolean,
): Loadable<Session[]> {
	if (state.loadError != null) return { state: "error", error: state.loadError };
	if (!state.loaded) return { state: "loading" };
	if (closed) {
		const data = Object.values(state.sessions)
			.filter((session) => session.workspaceId === workspaceId && session.closedAt !== null)
			.sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0));
		return { state: "ready", data };
	}
	const ids = state.byWorkspace[workspaceId] ?? [];
	const data = ids.flatMap((id) => {
		const session = state.sessions[id];
		return session === undefined ? [] : [session];
	});
	return { state: "ready", data };
}

export const useSessions: Queries["useSessions"] = (workspaceId) => {
	const state = useSessionSlice((value) => value);
	return sessionsOf(state, workspaceId, false);
};
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
		if (state.events[sessionId] === undefined) return { state: "loading" };
		const data = sessions.chatView(sessionId);
		return data === null ? { state: "loading" } : { state: "ready", data };
	}, [state, sessionId, sessions]);
};
export const useClosedSessions: Queries["useClosedSessions"] = (workspaceId) => {
	const state = useSessionSlice((value) => value);
	return sessionsOf(state, workspaceId, true);
};
export const usePlans: Queries["usePlans"] = () => notImplemented("CHAT-26");
