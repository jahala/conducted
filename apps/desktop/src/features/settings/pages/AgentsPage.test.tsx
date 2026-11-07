import type { AgentInstall } from "@conducted/protocol";
import { appError, err, ok } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
	const login = vi.fn();
	const refresh = vi.fn();
	const finishLogin = vi.fn();
	const cancelLogin = vi.fn();
	const copyText = vi.fn();
	const openUrl = vi.fn();
	return {
		installs: { state: "ready", data: [] } as {
			state: "ready";
			data: AgentInstall[];
		},
		login,
		refresh,
		finishLogin,
		cancelLogin,
		copyText,
		openUrl,
		toast: vi.fn(),
		toastError: vi.fn(),
		actions: {
			agents: { login, refresh, finishLogin, cancelLogin },
			app: { copyText, openUrl },
		},
	};
});

vi.mock("../../../core/hooks.ts", () => ({
	useAgentInstalls: () => state.installs,
	useActions: () => state.actions,
	useViewingSessionId: () => null,
	useMcpServers: () => ({ state: "ready", data: [] }),
	useSetting: () => false,
}));

vi.mock("../../../ui/Toast.tsx", () => ({
	toast: state.toast,
	toastError: state.toastError,
}));

const { AgentsPage } = await import("./AgentsPage.tsx");

const install = (changes: Partial<AgentInstall> & Pick<AgentInstall, "agent">): AgentInstall => ({
	installed: true,
	...changes,
});

beforeEach(() => {
	state.installs = { state: "ready", data: [] };
	state.login
		.mockReset()
		.mockResolvedValue(ok({ loginId: "login-1", instructions: "Open the page and sign in." }));
	state.refresh.mockReset().mockResolvedValue(ok(undefined));
	state.finishLogin.mockReset().mockResolvedValue(ok({ outcome: "signed_in", message: null }));
	state.cancelLogin.mockReset().mockResolvedValue(ok(undefined));
	state.copyText.mockReset().mockResolvedValue(ok(undefined));
	state.openUrl.mockReset().mockResolvedValue(ok(undefined));
	state.toast.mockReset();
	state.toastError.mockReset();
});

afterEach(cleanup);

describe("SET-03 AgentsPage", () => {
	it("shows install help and no sign-in button for Codex when it is not installed", () => {
		state.installs = {
			state: "ready",
			data: [install({ agent: "codex", installed: false })],
		};
		render(<AgentsPage />);

		expect(screen.getByRole("heading", { name: "Codex" })).toBeTruthy();
		expect(screen.getByText("Install Codex on this Mac, then choose Refresh.")).toBeTruthy();
		expect(screen.queryByRole("button", { name: /Sign in|Run codex login/ })).toBeNull();
	});

	it("filters the cards by name and says when nothing matches", () => {
		state.installs = {
			state: "ready",
			data: [
				install({ agent: "claude", authenticated: false }),
				install({ agent: "codex", authenticated: false }),
			],
		};
		render(<AgentsPage />);
		const search = screen.getByLabelText("Search providers");

		fireEvent.change(search, { target: { value: "codex" } });
		expect(screen.getByRole("heading", { name: "Codex" })).toBeTruthy();
		expect(screen.queryByRole("heading", { name: "Claude Code" })).toBeNull();

		fireEvent.change(search, { target: { value: "nothing here" } });
		expect(screen.getByText("No providers match your search.")).toBeTruthy();
	});

	it("starts a sign-in and shows the agent's instructions", async () => {
		state.installs = {
			state: "ready",
			data: [install({ agent: "claude", authenticated: false })],
		};
		render(<AgentsPage />);

		fireEvent.click(screen.getByRole("button", { name: "Run claude /login" }));

		await waitFor(() => expect(state.login).toHaveBeenCalledWith("claude", undefined));
		expect(await screen.findByText("Open the page and sign in.")).toBeTruthy();
	});

	it("checks the install list when it opens", () => {
		render(<AgentsPage />);

		expect(state.refresh).toHaveBeenCalled();
	});

	it("leads with install help when no agent program is found", () => {
		state.installs = { state: "ready", data: [] };
		render(<AgentsPage />);

		expect(screen.getByText("No agent programs found")).toBeTruthy();
	});

	it("does not cancel a sign-in that already finished", async () => {
		state.installs = {
			state: "ready",
			data: [install({ agent: "claude", authenticated: false })],
		};
		state.login.mockResolvedValue(
			ok({
				loginId: "login-1",
				instructions: "Run claude setup-token, then paste the code.",
				command: "claude setup-token",
			}),
		);
		let finished = false;
		state.finishLogin.mockImplementation(async () => {
			finished = true;
			return ok({ outcome: "signed_in", message: null });
		});
		state.refresh.mockImplementation(async () => {
			if (finished) {
				state.installs = {
					state: "ready",
					data: [install({ agent: "claude", authenticated: true })],
				};
			}
			return ok(undefined);
		});

		const { rerender } = render(<AgentsPage />);
		fireEvent.click(screen.getByRole("button", { name: "Run claude /login" }));
		expect(await screen.findByText("claude setup-token")).toBeTruthy();
		fireEvent.change(screen.getByLabelText("Paste code from Claude"), {
			target: { value: "code-123" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Finish sign-in" }));

		await waitFor(() => expect(state.finishLogin).toHaveBeenCalledWith("login-1", "code-123"));
		await waitFor(() => expect(state.refresh).toHaveBeenCalledTimes(2));
		rerender(<AgentsPage />);
		await waitFor(() => expect(screen.queryByText("Sign in to Claude Code")).toBeNull());

		expect(state.cancelLogin).not.toHaveBeenCalled();
	});

	it("shows the Codex device code, its copy message and the ChatGPT toast", async () => {
		state.installs = {
			state: "ready",
			data: [install({ agent: "codex", authenticated: false })],
		};
		state.login.mockResolvedValue(
			ok({
				loginId: "login-codex",
				instructions: "Open the page and enter this code.",
				userCode: "ABCD-1234",
				verificationUrl: "https://example.com/device",
			}),
		);
		let finish: ((value: unknown) => void) | undefined;
		state.finishLogin.mockImplementation(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		let signedIn = false;
		state.refresh.mockImplementation(async () => {
			if (signedIn) {
				state.installs = {
					state: "ready",
					data: [install({ agent: "codex", authenticated: true, authMethod: "chatgpt" })],
				};
			}
			return ok(undefined);
		});

		const { rerender } = render(<AgentsPage />);
		fireEvent.click(screen.getByRole("button", { name: "Run codex login" }));
		expect(await screen.findByText("ABCD-1234")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
		await waitFor(() =>
			expect(state.toast).toHaveBeenCalledWith("Copied Codex verification code."),
		);

		signedIn = true;
		finish?.(ok({ outcome: "signed_in", message: null }));
		await waitFor(() => expect(state.finishLogin).toHaveBeenCalledWith("login-codex", undefined));
		await waitFor(() => expect(state.refresh).toHaveBeenCalledTimes(2));
		rerender(<AgentsPage />);
		await waitFor(() =>
			expect(state.toast).toHaveBeenCalledWith("Codex now uses your ChatGPT plan"),
		);

		expect(state.cancelLogin).not.toHaveBeenCalled();
	});

	it("does not claim nothing is installed when the search hides the installed agents", () => {
		state.installs = {
			state: "ready",
			data: [
				install({ agent: "claude", authenticated: false }),
				install({ agent: "codex", installed: false }),
			],
		};
		render(<AgentsPage />);

		fireEvent.change(screen.getByLabelText("Search providers"), { target: { value: "codex" } });

		expect(screen.queryByText(/No agent programs were found/)).toBeNull();
	});

	it("cancels the first sign-in before a retry starts another", async () => {
		state.installs = {
			state: "ready",
			data: [install({ agent: "codex", authenticated: false })],
		};
		state.login
			.mockReset()
			.mockResolvedValueOnce(ok({ loginId: "login-1", instructions: "Enter the code." }))
			.mockResolvedValueOnce(ok({ loginId: "login-2", instructions: "Enter the new code." }));
		state.finishLogin
			.mockReset()
			.mockResolvedValueOnce(err(appError("login_timeout", "The sign-in timed out.")))
			.mockReturnValue(new Promise(() => {}));

		render(<AgentsPage />);
		fireEvent.click(screen.getByRole("button", { name: "Run codex login" }));
		expect(await screen.findByText("The sign-in timed out.")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));

		await waitFor(() => expect(state.cancelLogin).toHaveBeenCalledWith("login-1"));
		await waitFor(() => expect(state.login).toHaveBeenCalledTimes(2));
		expect(await screen.findByText("Enter the new code.")).toBeTruthy();
		expect(state.cancelLogin.mock.invocationCallOrder[0]).toBeLessThan(
			state.login.mock.invocationCallOrder[1] ?? 0,
		);
	});
});
