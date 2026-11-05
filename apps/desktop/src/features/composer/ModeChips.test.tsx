import type { SessionConfig } from "@conducted/protocol";
import { appError, err, ok } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../../test/dom-polyfills.ts";
import { CommandDispatcher } from "../../app/command-dispatcher.ts";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, seedWorkspace } from "../../test/container.ts";
import { toast } from "../../ui/Toast.tsx";
import { ModeChips } from "./ModeChips.tsx";

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

const config = (over: Partial<SessionConfig> = {}): SessionConfig => ({
	agent: "claude",
	model: "default",
	effort: "high",
	fastMode: false,
	planMode: false,
	requireToolApproval: false,
	additionalDirectories: [],
	appTools: { diffComments: true, progressUpdates: true, setTargetBranch: true },
	...over,
});

const setup = async (over: Partial<SessionConfig> = {}) => {
	const test = createTestContainer();
	const workspace = await seedWorkspace(test.container);
	const created = await test.container.services.sessions.create(workspace.id, config(over));
	if (!created.ok) throw new Error("could not create a chat");
	const wrapper = ({ children }: { children: ReactNode }) => (
		<ServicesProvider container={test.container}>{children}</ServicesProvider>
	);
	return { test, session: created.value, wrapper };
};

describe("COMP-03 plan mode toggle", () => {
	it("turns plan mode on when the plan chip is clicked", async () => {
		const { test, session, wrapper } = await setup();
		try {
			const updateConfig = vi
				.spyOn(test.container.services.sessions, "updateConfig")
				.mockResolvedValue(ok(undefined));
			render(<ModeChips sessionId={session.id} />, { wrapper });
			fireEvent.click(screen.getByRole("button", { name: "Plan mode" }));
			await waitFor(() =>
				expect(updateConfig).toHaveBeenCalledWith(session.id, {
					...config(),
					planMode: true,
				}),
			);
		} finally {
			test.close();
		}
	});

	it("turns plan mode off when the chat is already in plan mode", async () => {
		const { test, session, wrapper } = await setup({ planMode: true });
		try {
			const updateConfig = vi
				.spyOn(test.container.services.sessions, "updateConfig")
				.mockResolvedValue(ok(undefined));
			render(<ModeChips sessionId={session.id} />, { wrapper });
			const chip = screen.getByRole("button", { name: "Plan mode" });
			expect(chip.getAttribute("aria-pressed")).toBe("true");
			fireEvent.click(chip);
			await waitFor(() =>
				expect(updateConfig).toHaveBeenCalledWith(session.id, {
					...config({ planMode: true }),
					planMode: false,
				}),
			);
		} finally {
			test.close();
		}
	});

	it("toggles plan mode on Shift+Tab while typing", async () => {
		const { test, session, wrapper } = await setup();
		try {
			test.container.services.sessions.store.setState({ viewingSessionId: session.id });
			const updateConfig = vi
				.spyOn(test.container.services.sessions, "updateConfig")
				.mockResolvedValue(ok(undefined));
			render(
				<CommandDispatcher>
					<ModeChips sessionId={session.id} />
					<div data-testid="message" contentEditable />
				</CommandDispatcher>,
				{ wrapper },
			);
			fireEvent.keyDown(screen.getByTestId("message"), { key: "Tab", shiftKey: true });
			await waitFor(() =>
				expect(updateConfig).toHaveBeenCalledWith(session.id, {
					...config(),
					planMode: true,
				}),
			);
		} finally {
			test.close();
		}
	});

	it("tells the user when plan mode cannot be saved", async () => {
		const { test, session, wrapper } = await setup();
		try {
			vi.spyOn(test.container.services.sessions, "updateConfig").mockResolvedValue(
				err(appError("sidecar_down", "The sidecar is not running.")),
			);
			const toastSpy = vi.spyOn(toast, "error").mockImplementation(() => "toast-id");
			render(<ModeChips sessionId={session.id} />, { wrapper });
			fireEvent.click(screen.getByRole("button", { name: "Plan mode" }));
			await waitFor(() =>
				expect(toastSpy).toHaveBeenCalledWith("Couldn't change plan mode", expect.anything()),
			);
		} finally {
			test.close();
		}
	});
});

describe("COMP-03 auto-accept edits toggle", () => {
	it("calls setAutoApproveEdits with the opposite state on each click", async () => {
		const { test, session, wrapper } = await setup();
		try {
			const setAutoApproveEdits = vi
				.spyOn(test.container.services.sessions, "setAutoApproveEdits")
				.mockResolvedValue(ok(undefined));
			render(<ModeChips sessionId={session.id} />, { wrapper });
			const chip = screen.getByRole("button", { name: "Auto-accept edits" });
			fireEvent.click(chip);
			await waitFor(() => expect(setAutoApproveEdits).toHaveBeenCalledWith(session.id, true));
			await waitFor(() => expect(chip.getAttribute("aria-pressed")).toBe("true"));
			fireEvent.click(chip);
			await waitFor(() => expect(setAutoApproveEdits).toHaveBeenCalledWith(session.id, false));
			await waitFor(() => expect(chip.getAttribute("aria-pressed")).toBe("false"));
		} finally {
			test.close();
		}
	});

	it("shows the 'Disable auto-accept edits' tooltip while it is on", async () => {
		const { test, session, wrapper } = await setup();
		try {
			vi.spyOn(test.container.services.sessions, "setAutoApproveEdits").mockResolvedValue(
				ok(undefined),
			);
			render(<ModeChips sessionId={session.id} />, { wrapper });
			const chip = screen.getByRole("button", { name: "Auto-accept edits" });
			fireEvent.click(chip);
			await waitFor(() => expect(chip.getAttribute("aria-pressed")).toBe("true"));
			fireEvent.focus(chip);
			const tooltip = await screen.findByRole("tooltip");
			expect(tooltip.textContent).toBe("Disable auto-accept edits");
		} finally {
			test.close();
		}
	});

	it("tells the user when auto-accept edits cannot be changed", async () => {
		const { test, session, wrapper } = await setup();
		try {
			vi.spyOn(test.container.services.sessions, "setAutoApproveEdits").mockResolvedValue(
				err(appError("sidecar_down", "The sidecar is not running.")),
			);
			const toastSpy = vi.spyOn(toast, "error").mockImplementation(() => "toast-id");
			render(<ModeChips sessionId={session.id} />, { wrapper });
			fireEvent.click(screen.getByRole("button", { name: "Auto-accept edits" }));
			await waitFor(() =>
				expect(toastSpy).toHaveBeenCalledWith(
					"Couldn't change auto-accept edits",
					expect.anything(),
				),
			);
			expect(
				screen.getByRole("button", { name: "Auto-accept edits" }).getAttribute("aria-pressed"),
			).toBe("false");
		} finally {
			test.close();
		}
	});
});

describe("COMP-03 agents without plan mode", () => {
	it("hides both toggles for an agent that has no plan or accept-edits mode", async () => {
		const { test, session, wrapper } = await setup({ agent: "codex" });
		try {
			render(<ModeChips sessionId={session.id} />, { wrapper });
			expect(screen.queryByRole("button", { name: "Plan mode" })).toBeNull();
			expect(screen.queryByRole("button", { name: "Auto-accept edits" })).toBeNull();
		} finally {
			test.close();
		}
	});
});
