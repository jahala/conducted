/**
 * @feature DATA-01 Chat list hooks
 * Behaviour: services-map.md 1.3; core/hooks.ts says a hook re-renders only when its slice changes.
 * Test first: streaming events for a chat do not re-render the chat list of its workspace.
 */
import { idleLiveState } from "@conducted/protocol";
import { appError, type SessionId, type WorkspaceId } from "@conducted/shared";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { createStore } from "zustand/vanilla";
import { ServicesProvider } from "./context.tsx";
import { useClosedSessions, useSessions } from "./hooks.ts";
import type { Session } from "./model.ts";
import type { SessionsState } from "./services/sessions.ts";

const workspaceId = "w1" as WorkspaceId;

const session = (id: string, closedAt: number | null): Session =>
	({ id: id as SessionId, workspaceId, title: id, closedAt }) as Session;

const baseState = (overrides: Partial<SessionsState> = {}): SessionsState => ({
	loaded: true,
	sessions: {},
	byWorkspace: {},
	liveStates: {},
	cancelling: {},
	events: {},
	progress: {},
	sending: {},
	openInteractions: {},
	viewingSessionId: null,
	...overrides,
});

function render<T>(state: SessionsState, hook: () => T) {
	const store = createStore<SessionsState>(() => state);
	let renders = 0;
	const view = renderHook(
		() => {
			renders += 1;
			return hook();
		},
		{
			wrapper: ({ children }: { children: ReactNode }) => (
				<ServicesProvider container={{ services: { sessions: { store } } } as never}>
					{children}
				</ServicesProvider>
			),
		},
	);
	return { store, view, renders: () => renders };
}

describe("DATA-01 useSessions", () => {
	it("lists the open chats of the workspace in store order", () => {
		const a = session("a", null);
		const b = session("b", null);
		const closed = session("c", 5);
		const { view } = render(
			baseState({
				sessions: { a, b, c: closed },
				byWorkspace: { w1: ["b" as SessionId, "a" as SessionId, "c" as SessionId] },
			}),
			() => useSessions(workspaceId),
		);
		// The store lists a closed chat only if the service left it in `byWorkspace`; the hook
		// shows what the store lists.
		expect(view.result.current).toEqual({ state: "ready", data: [b, a, closed] });
	});

	it("reports the load error and the loading state", () => {
		const failure = appError("db", "locked");
		const errored = render(baseState({ loadError: failure }), () => useSessions(workspaceId));
		expect(errored.view.result.current).toEqual({ state: "error", error: failure });
		const loading = render(baseState({ loaded: false }), () => useSessions(workspaceId));
		expect(loading.view.result.current).toEqual({ state: "loading" });
	});

	it("does not re-render or change its result when only streaming state changes", () => {
		const a = session("a", null);
		const { store, view, renders } = render(
			baseState({ sessions: { a }, byWorkspace: { w1: ["a" as SessionId] } }),
			() => useSessions(workspaceId),
		);
		const before = view.result.current;
		const rendersBefore = renders();

		act(() => {
			store.setState({
				liveStates: { a: idleLiveState },
				events: { a: [] },
				progress: { a: { steps: [] } },
			});
		});

		expect(renders()).toBe(rendersBefore);
		expect(view.result.current).toBe(before);
	});

	it("updates when a chat row changes", () => {
		const a = session("a", null);
		const { store, view } = render(
			baseState({ sessions: { a }, byWorkspace: { w1: ["a" as SessionId] } }),
			() => useSessions(workspaceId),
		);

		const renamed = { ...a, title: "renamed" };
		act(() => {
			store.setState({ sessions: { a: renamed } });
		});

		expect(view.result.current).toEqual({ state: "ready", data: [renamed] });
	});
});

describe("DATA-01 useClosedSessions", () => {
	it("lists closed chats of the workspace, latest closed first, and ignores streaming state", () => {
		const open = session("a", null);
		const older = session("b", 5);
		const newer = session("c", 9);
		const { store, view, renders } = render(
			baseState({ sessions: { a: open, b: older, c: newer } }),
			() => useClosedSessions(workspaceId),
		);
		expect(view.result.current).toEqual({ state: "ready", data: [newer, older] });
		const rendersBefore = renders();

		act(() => {
			store.setState({ liveStates: { a: idleLiveState } });
		});

		expect(renders()).toBe(rendersBefore);
	});
});
