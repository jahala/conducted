/**
 * @feature WS-03 Setup tab
 * Owns: tests for showing a failure log and sending the failure to the chat once.
 * Test first: kind "failed" shows the failure log and a fix action that calls the chat action once.
 */
import type { TerminalId, WorkspaceId } from "@conducted/shared";
import { appError, err, ok } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Loadable } from "../../../core/api.ts";
import type { Session, SetupView, Workspace } from "../../../core/model.ts";

const state = vi.hoisted(() => ({
	setup: { state: "loading" } as Loadable<SetupView>,
	workspace: { state: "loading" } as Loadable<Workspace>,
	sessions: { state: "ready", data: [] } as Loadable<Session[]>,
	send: vi.fn(),
	cancelSetup: vi.fn(),
	retrySetup: vi.fn(),
	remove: vi.fn(),
	navigate: vi.fn(),
	readSetupLog: vi.fn(),
	toastError: vi.fn(),
	toast: vi.fn(),
}));

vi.mock("../../../core/hooks.ts", () => ({
	useSetupState: () => state.setup,
	useWorkspace: () => state.workspace,
	useSessions: () => state.sessions,
	useActions: () => ({
		sessions: { send: state.send },
		workspaces: { retrySetup: state.retrySetup, remove: state.remove },
	}),
}));

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => state.navigate,
}));

vi.mock("../../../core/context.tsx", () => {
	// One object for every render, as the real container gives.
	const services = {
		services: { workspace: { readSetupLog: state.readSetupLog, cancelSetup: state.cancelSetup } },
	};
	return { useServices: () => services };
});

vi.mock("../../../ui/Toast.tsx", () => ({
	toast: Object.assign(state.toast, { error: state.toast }),
	toastError: state.toastError,
}));

vi.mock("../../terminal/TerminalView.tsx", () => ({
	TerminalView: (props: { terminalId: string }) => (
		<div data-testid="setup-terminal">{props.terminalId}</div>
	),
}));

const { SetupTab } = await import("./SetupTab.tsx");

const workspaceId = "w1" as WorkspaceId;

const workspace = (overrides: Partial<Workspace> = {}): Workspace =>
	({
		id: workspaceId,
		state: "ready",
		activeSessionId: null,
		...overrides,
	}) as Workspace;

const session = { id: "s1" } as Session;

const failed = (overrides: Partial<SetupView> = {}): SetupView => ({
	state: "failed",
	hasScript: true,
	exitCode: 1,
	filesCopied: 3,
	terminalId: "t1" as TerminalId,
	log: "saved",
	interruptedReason: null,
	...overrides,
});

beforeEach(() => {
	state.setup = { state: "ready", data: failed() };
	state.workspace = { state: "ready", data: workspace() };
	state.sessions = { state: "ready", data: [session] };
	state.send.mockReset();
	state.send.mockResolvedValue(ok(undefined));
	state.cancelSetup.mockReset();
	state.cancelSetup.mockResolvedValue(ok(undefined));
	state.retrySetup.mockReset();
	state.retrySetup.mockResolvedValue(ok(undefined));
	state.remove.mockReset();
	state.remove.mockResolvedValue(ok(undefined));
	state.readSetupLog.mockReset();
	state.readSetupLog.mockResolvedValue(ok("setup output"));
	state.toastError.mockReset();
	state.toast.mockReset();
});

afterEach(cleanup);

describe("WS-03 Setup tab", () => {
	it("shows the failure log and sends the fix prompt to the chat once", async () => {
		render(<SetupTab workspaceId={workspaceId} />);

		expect(screen.getByTestId("setup-terminal").textContent).toBe("t1");
		fireEvent.click(screen.getByRole("button", { name: "Ask agent to fix" }));

		await waitFor(() => expect(state.send).toHaveBeenCalledTimes(1));
		expect(state.send.mock.calls[0]?.[0]).toBe("s1");
		expect(state.send.mock.calls[0]?.[1]).toContain("setup script failed");
	});

	it("runs setup again from the completed state", async () => {
		state.setup = {
			state: "ready",
			data: failed({ state: "completed", exitCode: 0, terminalId: "t2" as TerminalId }),
		};
		render(<SetupTab workspaceId={workspaceId} />);

		fireEvent.click(screen.getByRole("button", { name: "Run again" }));

		await waitFor(() => expect(state.retrySetup).toHaveBeenCalledWith(workspaceId));
	});

	it("offers Retry and Delete when the workspace's initialization failed", async () => {
		state.workspace = { state: "ready", data: workspace({ state: "failed" }) };
		state.setup = {
			state: "ready",
			data: failed({ state: "idle", hasScript: false, terminalId: null, log: "missing" }),
		};
		render(<SetupTab workspaceId={workspaceId} />);

		expect(screen.getByText("Workspace initialization failed")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Delete" }));
		await waitFor(() => expect(state.remove).toHaveBeenCalledWith(workspaceId));

		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		await waitFor(() => expect(state.retrySetup).toHaveBeenCalledWith(workspaceId));
	});

	it("offers Add setup script when the repository has none", () => {
		state.setup = {
			state: "ready",
			data: failed({ state: "idle", hasScript: false, terminalId: null, log: "missing" }),
		};
		render(<SetupTab workspaceId={workspaceId} />);

		expect(screen.getByRole("button", { name: "Add manually" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Ask agent" })).toBeTruthy();
	});

	it("disables the agent action without a chat", () => {
		state.sessions = { state: "ready", data: [] };
		render(<SetupTab workspaceId={workspaceId} />);

		expect(
			(screen.getByRole("button", { name: "Ask agent to fix" }) as HTMLButtonElement).disabled,
		).toBe(true);
	});

	it("stops a running setup through cancelSetup", async () => {
		state.setup = {
			state: "ready",
			data: failed({ state: "running", exitCode: null, log: "live" }),
		};
		render(<SetupTab workspaceId={workspaceId} />);

		fireEvent.click(screen.getByRole("button", { name: "Stop" }));

		await waitFor(() => expect(state.cancelSetup).toHaveBeenCalledWith(workspaceId));
	});

	it("toasts Failed to attach setup logs when the log cannot be read", async () => {
		state.readSetupLog.mockResolvedValue(err(appError("setup_log_missing", "missing")));
		render(<SetupTab workspaceId={workspaceId} />);

		fireEvent.click(screen.getByRole("button", { name: "Ask agent to fix" }));

		await waitFor(() =>
			expect(state.toastError.mock.calls[0]?.[0]).toBe("Failed to attach setup logs"),
		);
		expect(state.send).toHaveBeenCalledTimes(1);
	});

	it("toasts Failed to attach setup context when the chat send fails", async () => {
		state.send.mockResolvedValue(err(appError("session_not_ready", "no chat")));
		render(<SetupTab workspaceId={workspaceId} />);

		fireEvent.click(screen.getByRole("button", { name: "Ask agent to fix" }));

		await waitFor(() =>
			expect(state.toastError.mock.calls[0]?.[0]).toBe("Failed to attach setup context"),
		);
	});

	it("toasts the setup failure message when Run again fails", async () => {
		state.setup = {
			state: "ready",
			data: failed({ state: "completed", exitCode: 0, terminalId: "t2" as TerminalId }),
		};
		state.retrySetup.mockResolvedValue(err(appError("setup_failed", "failed")));
		render(<SetupTab workspaceId={workspaceId} />);

		fireEvent.click(screen.getByRole("button", { name: "Run again" }));

		await waitFor(() =>
			expect(state.toast.mock.calls[0]?.[0]).toBe(
				"Setup script failed. Check the setup tab for logs.",
			),
		);
	});

	it("shows the real reason when Run again fails for another cause", async () => {
		state.setup = {
			state: "ready",
			data: failed({ state: "completed", exitCode: 0, terminalId: "t2" as TerminalId }),
		};
		state.retrySetup.mockResolvedValue(
			err(appError("workspace_unknown", "That workspace is gone.")),
		);
		render(<SetupTab workspaceId={workspaceId} />);

		fireEvent.click(screen.getByRole("button", { name: "Run again" }));

		await waitFor(() => expect(state.toastError).toHaveBeenCalled());
		expect(state.toastError.mock.calls[0]?.[0]).toBe("Couldn't run setup again");
		expect(state.toastError.mock.calls[0]?.[1]).toEqual({
			code: "workspace_unknown",
			message: "That workspace is gone.",
		});
		expect(state.toast).not.toHaveBeenCalled();
	});

	it("keeps Run again usable when there is no chat to ask", () => {
		state.sessions = { state: "ready", data: [] };
		render(<SetupTab workspaceId={workspaceId} />);

		expect((screen.getByRole("button", { name: "Run again" }) as HTMLButtonElement).disabled).toBe(
			false,
		);
	});

	describe("a saved log without a live terminal", () => {
		const saved = () => failed({ terminalId: null, log: "saved" as const });

		it("shows the saved log", async () => {
			state.setup = { state: "ready", data: saved() };
			render(<SetupTab workspaceId={workspaceId} />);
			expect(await screen.findByText("setup output")).toBeTruthy();
		});

		it("shows why the log could not be read, and reads it again on Retry", async () => {
			state.setup = { state: "ready", data: saved() };
			state.readSetupLog.mockResolvedValueOnce(err(appError("db_error", "database is locked")));
			render(<SetupTab workspaceId={workspaceId} />);

			expect(await screen.findByText("database is locked")).toBeTruthy();
			fireEvent.click(screen.getByRole("button", { name: "Retry" }));

			expect(await screen.findByText("setup output")).toBeTruthy();
			expect(state.readSetupLog).toHaveBeenCalledTimes(2);
		});
	});

	it("does not call a log expired while setup is only detecting the script", () => {
		state.setup = {
			state: "ready",
			data: failed({ state: "detecting", terminalId: null, log: "missing", exitCode: null }),
		};
		render(<SetupTab workspaceId={workspaceId} />);

		expect(screen.queryByText(/expired/)).toBeNull();
		expect(screen.getByText("Looking for the repository's setup script.")).toBeTruthy();
	});

	it("puts the end of the setup log into the fix request", async () => {
		state.readSetupLog.mockResolvedValue(ok("one\ntwo\nthree"));
		render(<SetupTab workspaceId={workspaceId} />);

		fireEvent.click(screen.getByRole("button", { name: "Ask agent to fix" }));

		await waitFor(() => expect(state.send).toHaveBeenCalledTimes(1));
		const prompt = state.send.mock.calls[0]?.[1] as string;
		expect(prompt).toContain("one\ntwo\nthree");
		expect(prompt).not.toContain("Setup tab");
	});
});
