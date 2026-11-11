/**
 * @feature CHAT-19 Notify when a chat finishes or needs the user
 * Owns: the app's URL scheme and the deep link it builds for a workspace and chat. The notification
 * service and the app's router share them.
 * Behaviour: services-map.md 6 (deep links).
 */
import type { SessionId, WorkspaceId } from "@conducted/shared";

export const DEEP_LINK_SCHEME = "conducted";

export const buildDeepLink = (workspaceId: WorkspaceId, sessionId: SessionId | null): string => {
	const params = new URLSearchParams({ id: workspaceId });
	if (sessionId !== null) params.set("session", sessionId);
	return `${DEEP_LINK_SCHEME}://workspace?${params.toString()}`;
};
