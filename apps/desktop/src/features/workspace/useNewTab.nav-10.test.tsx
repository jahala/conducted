/**
 * @feature NAV-10 New tab actions
 * Owns: tests for the shared new-tab actions: one creation under two calls and the browser gate.
 * Test first: two new-chat calls at the same time while the first is pending create one chat.
 */
import type { WorkspaceId } from "@conducted/shared";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	createFromDefaults: vi.fn(),
	create: vi.fn(),
	createTerminal: vi.fn(),
	workspace: { state: "ready", data: { port: 5173 } },
	sessions: { state: "ready", data: [] },
}));

vi.mock("../../core/hooks.ts", () => ({
	useActions: () => ({ terminals: { create: state.createTerminal } }),
	useSessions: () => state.sessions,
	useWorkspace: () => state.workspace,
	useSetting: () => false,
}));

vi.mock("../../core/context.tsx", () => ({
	useServices: () => ({
		services: {
			sessions: {
				create: state.create,
				createFromDefaults: state.createFromDefaults,
			},
		},
	}),
}));

const { NewTabProvider, useNewTab } = await import("./useNewTab.tsx");

const workspaceId = "w1" as WorkspaceId;

const wrapper = ({ children }: { children: ReactNode }) => (
	<NewTabProvider>{children}</NewTabProvider>
);

beforeEach(() => {
	state.workspace = { state: "ready", data: { port: 5173 } };
	state.sessions = { state: "ready", data: [] };
	for (const fn of [state.createFromDefaults, state.create, state.createTerminal]) {
		fn.mockReset();
		fn.mockResolvedValue({ ok: true, value: { id: "new" } });
	}
});

afterEach(cleanup);

describe("NAV-10 useNewTab", () => {
	it("creates one chat when two callers ask at the same time", async () => {
		let finish: ((value: unknown) => void) | undefined;
		state.createFromDefaults.mockReturnValue(
			new Promise((resolve) => {
				finish = resolve;
			}),
		);
		const onSearchChange = vi.fn();
		const { result } = renderHook(
			() => ({
				first: useNewTab({ workspaceId, onSearchChange }),
				second: useNewTab({ workspaceId, onSearchChange }),
			}),
			{ wrapper },
		);

		act(() => {
			void result.current.first.newChat(false);
			void result.current.second.newChat(false);
		});
		expect(state.createFromDefaults).toHaveBeenCalledTimes(1);

		act(() => finish?.({ ok: true, value: { id: "s1" } }));
		await waitFor(() =>
			expect(onSearchChange).toHaveBeenCalledWith({ tab: "session", sessionId: "s1" }),
		);
	});

	it("will not invent a browser URL when the port is unknown", () => {
		state.workspace = { state: "ready", data: { port: 0 } };
		const onSearchChange = vi.fn();
		const { result } = renderHook(() => useNewTab({ workspaceId, onSearchChange }), {
			wrapper,
		});
		expect(result.current.browserAvailable).toBe(false);
		expect(result.current.openBrowser()).toBe(false);
		expect(onSearchChange).not.toHaveBeenCalled();
	});
});
