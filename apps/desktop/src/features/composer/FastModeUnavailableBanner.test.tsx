/**
 * @feature CHAT-30 Fast mode unavailable banner
 * Tests the warning's copy and dismiss control, that it has no Add credit button (the research
 * does not give the page Conductor's opens), and the composer that shows it.
 */
import { idleLiveState, type SessionConfig } from "@conducted/protocol";
import { ok, type SessionId } from "@conducted/shared";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../../test/dom-polyfills.ts";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, seedWorkspace, type TestContainer } from "../../test/container.ts";
import { Composer } from "./Composer.tsx";
import { FastModeUnavailableBanner } from "./FastModeUnavailableBanner.tsx";

afterEach(cleanup);

const MESSAGE = "Fast mode is disabled because extra usage is out of credits.";
const chatId = "chat-1" as SessionId;

const config = (over: Partial<SessionConfig> = {}): SessionConfig => ({
	agent: "claude",
	model: "default",
	effort: "high",
	fastMode: true,
	planMode: false,
	requireToolApproval: false,
	additionalDirectories: [],
	appTools: { diffComments: true, progressUpdates: true, setTargetBranch: true },
	...over,
});

const wrapperFor = (test: TestContainer) => {
	return ({ children }: { children: ReactNode }) => (
		<ServicesProvider container={test.container}>{children}</ServicesProvider>
	);
};

const banner = (over: { fastModeRequested?: boolean; fastModeAvailable?: boolean } = {}) => (
	<FastModeUnavailableBanner
		sessionId={chatId}
		fastModeRequested={over.fastModeRequested ?? true}
		fastModeAvailable={over.fastModeAvailable ?? false}
	/>
);

describe("CHAT-30 Fast mode unavailable banner", () => {
	it("shows the sentence and a dismiss control, and no Add credit button", () => {
		const test = createTestContainer();
		try {
			render(banner(), { wrapper: wrapperFor(test) });
			expect(screen.getByText(MESSAGE)).toBeTruthy();
			expect(screen.queryByRole("button", { name: "Add credit" })).toBeNull();
			expect(screen.getByRole("button", { name: "Dismiss fast mode warning" })).toBeTruthy();
		} finally {
			test.close();
		}
	});

	it("shows nothing while fast mode is available", () => {
		const test = createTestContainer();
		try {
			render(banner({ fastModeAvailable: true }), { wrapper: wrapperFor(test) });
			expect(screen.queryByText(MESSAGE)).toBeNull();
		} finally {
			test.close();
		}
	});

	it("shows nothing when the user did not ask for fast mode", () => {
		const test = createTestContainer();
		try {
			render(banner({ fastModeRequested: false }), { wrapper: wrapperFor(test) });
			expect(screen.queryByText(MESSAGE)).toBeNull();
		} finally {
			test.close();
		}
	});

	it("stays dismissed until fast mode becomes available and fails again", () => {
		const test = createTestContainer();
		try {
			const view = render(banner(), { wrapper: wrapperFor(test) });
			fireEvent.click(screen.getByRole("button", { name: "Dismiss fast mode warning" }));
			expect(screen.queryByText(MESSAGE)).toBeNull();

			view.rerender(banner());
			expect(screen.queryByText(MESSAGE)).toBeNull();

			view.rerender(banner({ fastModeAvailable: true }));
			expect(screen.queryByText(MESSAGE)).toBeNull();

			view.rerender(banner());
			expect(screen.getByText(MESSAGE)).toBeTruthy();
		} finally {
			test.close();
		}
	});

	it("opens no page: its one control is the dismiss button", () => {
		const test = createTestContainer();
		// seam: CHAT-30 the browser is outside the app; the test checks that nothing asks for it.
		const openUrl = vi
			.spyOn(test.container.actions.app, "openUrl")
			.mockResolvedValue(ok(undefined));
		try {
			render(banner(), { wrapper: wrapperFor(test) });
			const controls = screen.getAllByRole("button");
			expect(controls.map((control) => control.getAttribute("aria-label"))).toEqual([
				"Dismiss fast mode warning",
			]);
			for (const control of controls) fireEvent.click(control);
			expect(openUrl).not.toHaveBeenCalled();
		} finally {
			test.close();
		}
	});

	it("is dismissed for its own chat only", () => {
		const test = createTestContainer();
		try {
			const view = render(banner(), { wrapper: wrapperFor(test) });
			fireEvent.click(screen.getByRole("button", { name: "Dismiss fast mode warning" }));
			expect(screen.queryByText(MESSAGE)).toBeNull();

			view.rerender(
				<FastModeUnavailableBanner
					sessionId={"chat-2" as SessionId}
					fastModeRequested
					fastModeAvailable={false}
				/>,
			);
			expect(screen.getByText(MESSAGE)).toBeTruthy();
		} finally {
			test.close();
		}
	});
});

describe("CHAT-30 Fast mode unavailable banner in the composer", () => {
	const mount = async () => {
		const test = createTestContainer();
		const workspace = await seedWorkspace(test.container);
		const session = await test.container.services.sessions.create(workspace.id, config());
		if (!session.ok) throw new Error("could not create a chat");
		const wrapper = wrapperFor(test);
		const live = (over: typeof idleLiveState) =>
			test.container.services.sessions.store.setState((state) => ({
				liveStates: { ...state.liveStates, [session.value.id]: over },
			}));
		return { test, session: session.value, wrapper, live };
	};

	it("shows the warning for a fast-mode chat whose account is out of credits", async () => {
		const { test, session, wrapper, live } = await mount();
		try {
			render(<Composer workspaceId={session.workspaceId} sessionId={session.id} />, {
				wrapper,
			});
			expect(screen.queryByText(MESSAGE)).toBeNull();
			act(() => live({ ...idleLiveState, fastModeAvailable: false }));
			expect(await screen.findByText(MESSAGE)).toBeTruthy();
		} finally {
			test.close();
		}
	});

	it("keeps the editor focused when the warning appears", async () => {
		const { test, session, wrapper, live } = await mount();
		try {
			render(<Composer workspaceId={session.workspaceId} sessionId={session.id} />, {
				wrapper,
			});
			const editor = screen.getByLabelText("composer");
			editor.focus();
			act(() => live({ ...idleLiveState, fastModeAvailable: false }));
			await screen.findByText(MESSAGE);
			expect(document.activeElement).toBe(editor);
		} finally {
			test.close();
		}
	});

	it("keeps the warning dismissed while the chat stays open", async () => {
		const { test, session, wrapper, live } = await mount();
		try {
			render(<Composer workspaceId={session.workspaceId} sessionId={session.id} />, {
				wrapper,
			});
			act(() => live({ ...idleLiveState, fastModeAvailable: false }));
			fireEvent.click(screen.getByRole("button", { name: "Dismiss fast mode warning" }));
			expect(screen.queryByText(MESSAGE)).toBeNull();
			act(() => live({ ...idleLiveState, status: "working", fastModeAvailable: false }));
			expect(screen.queryByText(MESSAGE)).toBeNull();
		} finally {
			test.close();
		}
	});
});
