import type { SessionConfig } from "@conducted/protocol";
import { appError, err, ok } from "@conducted/shared";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandDispatcher } from "../../app/command-dispatcher.ts";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, seedWorkspace, type TestContainer } from "../../test/container.ts";
import { toast } from "../../ui/Toast.tsx";
import { ModeChips } from "./ModeChips.tsx";
import { PlusMenu } from "./PlusMenu.tsx";

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

interface SidecarRequest {
	id?: number;
	method?: string;
	params?: unknown;
}

const sidecarRequests = (test: TestContainer): SidecarRequest[] =>
	test.memory.controls.sidecarSent.flatMap((line) => {
		try {
			return [JSON.parse(line) as SidecarRequest];
		} catch {
			return [];
		}
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

// Conductor keeps plan mode in the "+" menu and shows the auto-accept chip only while it is on
// (D098). These tests used to click a plan chip and an always-visible auto-accept toggle.
const noop = () => {};

const renderWithPlus = (sessionId: Parameters<typeof ModeChips>[0]["sessionId"]) => (
	<CommandDispatcher>
		<ModeChips sessionId={sessionId} />
		<PlusMenu
			sessionId={sessionId}
			onAddAttachment={noop}
			onLinkIssue={noop}
			onLinkWorkspaces={noop}
			onAddSnippet={noop}
			onInsertSnippet={noop}
		/>
	</CommandDispatcher>
);

const choosePlusItem = async (name: string) => {
	fireEvent.keyDown(
		screen.getByRole("button", { name: "Add attachments, link issues, and more" }),
		{
			key: "Enter",
		},
	);
	fireEvent.click(await screen.findByRole("menuitem", { name: new RegExp(`^${name}`) }));
};

const turnAutoAcceptOn = (test: TestContainer, sessionId: string) =>
	test.container.services.sessions.store.setState({ autoAcceptEdits: { [sessionId]: true } });

describe("COMP-03 plan mode toggle", () => {
	it("turns plan mode on from the + menu", async () => {
		const { test, session, wrapper } = await setup();
		try {
			const updateConfig = vi
				.spyOn(test.container.services.sessions, "updateConfig")
				.mockResolvedValue(ok(undefined));
			render(renderWithPlus(session.id), { wrapper });
			expect(screen.queryByRole("button", { name: "Plan mode" })).toBeNull();
			await choosePlusItem("Plan mode");
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

	it("turns plan mode off from the + menu when the chat is already in plan mode", async () => {
		const { test, session, wrapper } = await setup({ planMode: true });
		try {
			const updateConfig = vi
				.spyOn(test.container.services.sessions, "updateConfig")
				.mockResolvedValue(ok(undefined));
			render(renderWithPlus(session.id), { wrapper });
			await choosePlusItem("Exit plan mode");
			expect(screen.queryByRole("button", { name: "Plan mode" })).toBeNull();
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
			render(renderWithPlus(session.id), { wrapper });
			await choosePlusItem("Plan mode");
			await waitFor(() =>
				expect(toastSpy).toHaveBeenCalledWith("Couldn't change plan mode", expect.anything()),
			);
		} finally {
			test.close();
		}
	});
});

describe("COMP-03 auto-accept edits chip", () => {
	it("shows only while auto-accept is on, and a click turns it off", async () => {
		const { test, session, wrapper } = await setup();
		try {
			const setAutoApproveEdits = vi.spyOn(test.container.services.sessions, "setAutoApproveEdits");
			render(<ModeChips sessionId={session.id} />, { wrapper });
			expect(screen.queryByRole("button", { name: "Auto-accept edits" })).toBeNull();
			act(() => turnAutoAcceptOn(test, session.id));
			const chip = await screen.findByRole("button", { name: "Auto-accept edits" });
			setAutoApproveEdits.mockResolvedValue(ok(undefined));
			fireEvent.click(chip);
			await waitFor(() => expect(setAutoApproveEdits).toHaveBeenCalledWith(session.id, false));
		} finally {
			test.close();
		}
	});

	it("sends the change to the sidecar over the JSON-RPC connection and then hides", async () => {
		const { test, session, wrapper } = await setup();
		try {
			const started = await test.container.sidecar.start();
			expect(started.ok).toBe(true);
			turnAutoAcceptOn(test, session.id);
			render(<ModeChips sessionId={session.id} />, { wrapper });
			const chip = screen.getByRole("button", { name: "Auto-accept edits" });
			fireEvent.click(chip);
			await waitFor(() =>
				expect(sidecarRequests(test).some((sent) => sent.method === "setAutoApproveEdits")).toBe(
					true,
				),
			);
			const request = sidecarRequests(test).find((sent) => sent.method === "setAutoApproveEdits");
			if (request?.id === undefined) throw new Error("no setAutoApproveEdits request");
			expect(request.params).toEqual({ sessionId: session.id, enabled: false });
			test.memory.controls.emitSidecarLine(
				JSON.stringify({ jsonrpc: "2.0", id: request.id, result: {} }),
			);
			await waitFor(() =>
				expect(screen.queryByRole("button", { name: "Auto-accept edits" })).toBeNull(),
			);
		} finally {
			test.container.sidecar.stop();
			test.close();
		}
	});

	it("shows the 'Disable auto-accept edits' tooltip", async () => {
		const { test, session, wrapper } = await setup();
		try {
			turnAutoAcceptOn(test, session.id);
			render(<ModeChips sessionId={session.id} />, { wrapper });
			const chip = screen.getByRole("button", { name: "Auto-accept edits" });
			fireEvent.focus(chip);
			const tooltip = await screen.findByRole("tooltip");
			expect(tooltip.textContent).toBe("Disable auto-accept edits");
		} finally {
			test.close();
		}
	});

	it("tells the user when auto-accept edits cannot be changed, and keeps the chip", async () => {
		const { test, session, wrapper } = await setup();
		try {
			vi.spyOn(test.container.services.sessions, "setAutoApproveEdits").mockResolvedValue(
				err(appError("sidecar_down", "The sidecar is not running.")),
			);
			const toastSpy = vi.spyOn(toast, "error").mockImplementation(() => "toast-id");
			turnAutoAcceptOn(test, session.id);
			render(<ModeChips sessionId={session.id} />, { wrapper });
			fireEvent.click(screen.getByRole("button", { name: "Auto-accept edits" }));
			await waitFor(() =>
				expect(toastSpy).toHaveBeenCalledWith(
					"Couldn't change auto-accept edits",
					expect.anything(),
				),
			);
			expect(screen.getByRole("button", { name: "Auto-accept edits" })).toBeTruthy();
		} finally {
			test.close();
		}
	});
});

describe("COMP-03 agents without plan mode", () => {
	it("hides both toggles for an agent that has no plan or accept-edits mode", async () => {
		const { test, session, wrapper } = await setup({ agent: "codex" });
		try {
			turnAutoAcceptOn(test, session.id);
			render(<ModeChips sessionId={session.id} />, { wrapper });
			expect(screen.queryByRole("button", { name: "Plan mode" })).toBeNull();
			expect(screen.queryByRole("button", { name: "Auto-accept edits" })).toBeNull();
		} finally {
			test.close();
		}
	});
});
