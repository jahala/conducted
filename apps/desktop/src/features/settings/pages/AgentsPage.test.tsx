import type { AgentInstall } from "@conducted/protocol";
import { ok } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../../test/dom-polyfills.ts";

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
		expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
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

		fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

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
});
