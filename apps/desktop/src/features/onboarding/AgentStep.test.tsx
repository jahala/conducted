import type { AgentInstall, AgentLogin } from "@conducted/protocol";
import { ok, type Result } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, type TestContainer } from "../../test/container.ts";
import { AgentStep } from "./AgentStep.tsx";

afterEach(cleanup);

const install = (changes: AgentInstall): AgentInstall => changes;

function setup(installs: AgentInstall[]) {
	const test = createTestContainer();
	const refresh = vi
		.spyOn(test.container.services.agentCatalog, "refresh")
		.mockResolvedValue(ok(undefined));
	test.container.services.agentCatalog.setInstalls(installs);
	render(
		<ServicesProvider container={test.container}>
			<AgentStep />
		</ServicesProvider>,
	);
	return { test, refresh };
}

function close(test: TestContainer) {
	test.close();
}

describe("APP-02 onboarding agents step", () => {
	it("marks a signed-in Claude Ready and a missing Codex Not installed", async () => {
		const { test } = setup([
			install({
				agent: "claude",
				installed: true,
				authenticated: true,
				version: "1.2.3",
			}),
			install({ agent: "codex", installed: false }),
		]);
		try {
			const claude = await screen.findByRole("listitem", { name: "Claude Code" });
			expect(within(claude).getByText("Ready")).toBeTruthy();
			expect(within(claude).getByText("Version 1.2.3")).toBeTruthy();
			const codex = screen.getByRole("listitem", { name: "Codex" });
			expect(within(codex).getByText("Not installed")).toBeTruthy();
			expect(screen.getAllByText("Ready")).toHaveLength(1);
		} finally {
			close(test);
		}
	});

	it("shows a spinner for each program while detection runs", () => {
		const test = createTestContainer();
		const refresh = vi
			.spyOn(test.container.services.agentCatalog, "refresh")
			.mockResolvedValue(ok(undefined));
		try {
			render(
				<ServicesProvider container={test.container}>
					<AgentStep />
				</ServicesProvider>,
			);
			expect(screen.getByRole("status", { name: "Checking Claude Code" })).toBeTruthy();
			expect(screen.getByRole("status", { name: "Checking Pi" })).toBeTruthy();
			expect(refresh).toHaveBeenCalled();
		} finally {
			close(test);
		}
	});

	it("starts a sign-in flow and shows its link and code", async () => {
		const { test } = setup([
			install({ agent: "claude", installed: true, authenticated: false, version: "1.0.0" }),
		]);
		const login = vi.spyOn(test.container.services.agentCatalog, "login").mockResolvedValue(
			ok({
				loginId: "login-1",
				instructions: "Finish the sign-in in your browser.",
				url: "https://example.com/sign-in",
				userCode: "ABCD-1234",
			}),
		);
		try {
			const claude = await screen.findByRole("listitem", { name: "Claude Code" });
			fireEvent.click(within(claude).getByRole("button", { name: "Sign in" }));
			await waitFor(() => expect(login).toHaveBeenCalledWith("claude", undefined));
			expect(await screen.findByText("Finish the sign-in in your browser.")).toBeTruthy();
			expect(screen.getByText("ABCD-1234")).toBeTruthy();
			expect(screen.getByRole("button", { name: "Open browser" })).toBeTruthy();
			expect(screen.getByLabelText("Code from Claude Code")).toBeTruthy();
		} finally {
			close(test);
		}
	});

	it("keeps the newest sign-in panel when two starts overlap", async () => {
		const { test } = setup([
			install({ agent: "claude", installed: true, authenticated: false }),
			install({ agent: "codex", installed: true, authenticated: false }),
		]);
		let resolveClaude: (value: Result<AgentLogin>) => void = () => {};
		const claudeLogin = new Promise<Result<AgentLogin>>((resolve) => {
			resolveClaude = resolve;
		});
		vi.spyOn(test.container.services.agentCatalog, "login").mockImplementation((agent) =>
			agent === "claude"
				? claudeLogin
				: Promise.resolve(
						ok({
							loginId: "codex-1",
							instructions: "Codex started first.",
						}),
					),
		);
		try {
			const claude = await screen.findByRole("listitem", { name: "Claude Code" });
			const codex = screen.getByRole("listitem", { name: "Codex" });
			fireEvent.click(within(claude).getByRole("button", { name: "Sign in" }));
			fireEvent.click(within(codex).getByRole("button", { name: "Sign in" }));
			expect(await screen.findByText("Codex started first.")).toBeTruthy();
			resolveClaude(
				ok({
					loginId: "claude-1",
					instructions: "Claude started later.",
				}),
			);
			await waitFor(() => expect(screen.queryByText("Claude started later.")).toBeNull());
			expect(screen.getByText("Codex started first.")).toBeTruthy();
		} finally {
			close(test);
		}
	});

	it("explains how to install an agent when none are installed", async () => {
		const { test } = setup([
			install({ agent: "claude", installed: false }),
			install({ agent: "codex", installed: false }),
			install({ agent: "cursor", installed: false }),
			install({ agent: "acp", acpAgent: "opencode", installed: false }),
			install({ agent: "acp", acpAgent: "pi", installed: false }),
		]);
		try {
			expect(
				await screen.findByText(/No agent programs were found\. Install one on this Mac/),
			).toBeTruthy();
			expect(screen.getByRole("button", { name: "Refresh" })).toBeTruthy();
		} finally {
			close(test);
		}
	});

	it("shows the detection error with a retry that checks again", async () => {
		const test = createTestContainer();
		const refresh = vi
			.spyOn(test.container.services.agentCatalog, "refresh")
			.mockResolvedValue(ok(undefined));
		test.container.services.agentCatalog.store.setState({
			installs: { state: "error", error: { code: "detect_failed", message: "No login shell." } },
		});
		try {
			render(
				<ServicesProvider container={test.container}>
					<AgentStep />
				</ServicesProvider>,
			);
			expect(await screen.findByText("Couldn't check the agent programs")).toBeTruthy();
			expect(screen.getByText("No login shell.")).toBeTruthy();
			const calls = refresh.mock.calls.length;
			fireEvent.click(screen.getByRole("button", { name: "Try again" }));
			await waitFor(() => expect(refresh.mock.calls.length).toBeGreaterThan(calls));
		} finally {
			close(test);
		}
	});
});
