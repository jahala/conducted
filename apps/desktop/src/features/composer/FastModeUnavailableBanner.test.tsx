/**
 * @feature CHAT-30 Fast mode unavailable banner
 * Tests the warning's copy and dismiss control, the Add credit link, and the composer that shows it.
 */
import { idleLiveState, type SessionConfig } from "@conducted/protocol";
import { appError, err, ok, type SessionId } from "@conducted/shared";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../../test/dom-polyfills.ts";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, seedWorkspace, type TestContainer } from "../../test/container.ts";
import { Composer } from "./Composer.tsx";
import { FastModeUnavailableBanner } from "./FastModeUnavailableBanner.tsx";

afterEach(cleanup);

const MESSAGE = "Fast mode is disabled because extra usage is out of credits.";
const USAGE_URL = "https://claude.ai/settings/usage";
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
	it("shows the sentence with Add credit and a dismiss control", () => {
		const test = createTestContainer();
		try {
			render(banner(), { wrapper: wrapperFor(test) });
			expect(screen.getByText(MESSAGE)).toBeTruthy();
			expect(screen.getByRole("button", { name: "Add credit" })).toBeTruthy();
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

	it("opens the Claude usage page from Add credit", async () => {
		const test = createTestContainer();
		const openUrl = vi
			.spyOn(test.container.actions.app, "openUrl")
			.mockResolvedValue(ok(undefined));
		try {
			render(banner(), { wrapper: wrapperFor(test) });
			fireEvent.click(screen.getByRole("button", { name: "Add credit" }));
			await waitFor(() => expect(openUrl).toHaveBeenCalledWith(USAGE_URL));
		} finally {
			test.close();
		}
	});

	it("shows the failure beside Add credit when the page cannot be opened", async () => {
		const test = createTestContainer();
		vi.spyOn(test.container.actions.app, "openUrl").mockResolvedValue(
			err(appError("open_url_failed", "The link could not be opened.")),
		);
		try {
			render(banner(), { wrapper: wrapperFor(test) });
			fireEvent.click(screen.getByRole("button", { name: "Add credit" }));
			const alert = await screen.findByRole("alert");
			expect(alert.textContent).toBe("The link could not be opened.");
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
