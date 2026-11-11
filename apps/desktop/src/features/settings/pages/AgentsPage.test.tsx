/**
 * @feature SET-03 Agents page
 * Owns: tests for the Agents page over the real container: install help, search, the sign-in flows
 * and their toasts. The sidecar's sign-in calls are the seam: the catalogue's login, finish,
 * cancel and refresh are spied, and the install list goes through the catalogue's own store.
 * Test first: starts a sign-in and shows the agent's instructions.
 */
import type { AgentInstall } from "@conducted/protocol";
import { appError, err, ok } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Container } from "../../../core/container.ts";
import { ServicesProvider } from "../../../core/context.tsx";
import { createTestContainer, type TestContainer } from "../../../test/container.ts";
import { Toaster, toast } from "../../../ui/Toast.tsx";
import { AgentsPage } from "./AgentsPage.tsx";

let test: TestContainer | undefined;

afterEach(() => {
	cleanup();
	toast.dismiss();
	vi.restoreAllMocks();
	test?.close();
	test = undefined;
});

const install = (changes: Partial<AgentInstall> & Pick<AgentInstall, "agent">): AgentInstall => ({
	installed: true,
	...changes,
});

/** The real container with the sidecar's sign-in calls spied, showing `installs`. */
function harness(installs: AgentInstall[]) {
	test = createTestContainer();
	const container: Container = test.container;
	const catalog = container.services.agentCatalog;
	const spies = {
		login: vi
			.spyOn(catalog, "login")
			.mockResolvedValue(ok({ loginId: "login-1", instructions: "Open the page and sign in." })),
		refresh: vi.spyOn(catalog, "refresh").mockResolvedValue(ok(undefined)),
		finishLogin: vi
			.spyOn(catalog, "finishLogin")
			.mockResolvedValue(ok({ outcome: "signed_in", message: null })),
		cancelLogin: vi.spyOn(catalog, "cancelLogin").mockResolvedValue(ok(undefined)),
	};
	catalog.setInstalls(installs);
	const page = () => (
		<ServicesProvider container={container}>
			<AgentsPage />
			<Toaster />
		</ServicesProvider>
	);
	return { container, catalog, spies, page };
}

describe("SET-03 AgentsPage", () => {
	it("shows install help and no sign-in button for Codex when it is not installed", () => {
		const { page } = harness([install({ agent: "codex", installed: false })]);
		render(page());

		expect(screen.getByRole("heading", { name: "Codex" })).toBeTruthy();
		expect(screen.getByText("Install Codex on this Mac, then choose Refresh.")).toBeTruthy();
		// The page has a title and no subtitle, as Conductor's does (D098).
		expect(screen.queryByText(/Install status, versions/)).toBeNull();
		expect(screen.queryByRole("button", { name: /Sign in|Run codex login/ })).toBeNull();
	});

	it("filters the cards by name and says when nothing matches", () => {
		const { page } = harness([
			install({ agent: "claude", authenticated: false }),
			install({ agent: "codex", authenticated: false }),
		]);
		render(page());
		const search = screen.getByLabelText("Search providers");

		fireEvent.change(search, { target: { value: "codex" } });
		expect(screen.getByRole("heading", { name: "Codex" })).toBeTruthy();
		expect(screen.queryByRole("heading", { name: "Claude Code" })).toBeNull();

		fireEvent.change(search, { target: { value: "nothing here" } });
		expect(screen.getByText("No providers match your search.")).toBeTruthy();
	});

	it("starts a sign-in and shows the agent's instructions", async () => {
		const { page, spies } = harness([install({ agent: "claude", authenticated: false })]);
		render(page());

		fireEvent.click(screen.getByRole("button", { name: "Run claude /login" }));

		await waitFor(() => expect(spies.login).toHaveBeenCalledWith("claude", undefined));
		expect(await screen.findByText("Open the page and sign in.")).toBeTruthy();
	});

	it("checks the install list when it opens", () => {
		const { page, spies } = harness([]);
		render(page());

		expect(spies.refresh).toHaveBeenCalled();
	});

	it("waits on Refresh until the check settles, and says when it failed", async () => {
		const { page, spies } = harness([install({ agent: "claude", authenticated: true })]);
		render(page());
		await waitFor(() => expect(spies.refresh).toHaveBeenCalledTimes(1));
		let settle: (value: Awaited<ReturnType<typeof spies.refresh>>) => void = () => undefined;
		spies.refresh.mockImplementation(
			() =>
				new Promise((resolve) => {
					settle = resolve;
				}),
		);

		const refresh = screen.getByRole("button", { name: "Refresh" }) as HTMLButtonElement;
		fireEvent.click(refresh);
		await waitFor(() => expect(refresh.disabled).toBe(true));

		settle(err(appError("sidecar_unavailable", "The sidecar is not running.")));
		await waitFor(() => expect(refresh.disabled).toBe(false));
		expect(await screen.findByText("Couldn't refresh the agents")).toBeTruthy();
	});

	it("leads with install help when no agent program is found", () => {
		const { page } = harness([]);
		render(page());

		expect(screen.getByText("No agent programs found")).toBeTruthy();
	});

	it("does not cancel a sign-in that already finished", async () => {
		const { page, spies, catalog } = harness([install({ agent: "claude", authenticated: false })]);
		spies.login.mockResolvedValue(
			ok({
				loginId: "login-1",
				instructions: "Run claude setup-token, then paste the code.",
				command: "claude setup-token",
			}),
		);
		let finished = false;
		spies.finishLogin.mockImplementation(async () => {
			finished = true;
			return ok({ outcome: "signed_in", message: null });
		});
		spies.refresh.mockImplementation(async () => {
			if (finished) catalog.setInstalls([install({ agent: "claude", authenticated: true })]);
			return ok(undefined);
		});

		render(page());
		fireEvent.click(screen.getByRole("button", { name: "Run claude /login" }));
		expect(await screen.findByText("claude setup-token")).toBeTruthy();
		fireEvent.change(screen.getByLabelText("Paste code from Claude"), {
			target: { value: "code-123" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Finish sign-in" }));

		await waitFor(() => expect(spies.finishLogin).toHaveBeenCalledWith("login-1", "code-123"));
		// Opening the page, finishing the sign-in, and the dialog closing once the agent is signed in.
		await waitFor(() => expect(spies.refresh).toHaveBeenCalledTimes(3));
		await waitFor(() => expect(screen.queryByText("Sign in to Claude Code")).toBeNull());

		expect(spies.cancelLogin).not.toHaveBeenCalled();
	});

	it("says a Claude sign-in succeeded, as Conductor's banner does", async () => {
		const { page, spies } = harness([install({ agent: "claude", authenticated: false })]);
		spies.login.mockResolvedValue(
			ok({
				loginId: "login-1",
				instructions: "Run claude setup-token, then paste the code.",
				command: "claude setup-token",
			}),
		);
		spies.finishLogin.mockResolvedValue(ok({ outcome: "signed_in", message: null }));

		render(page());
		fireEvent.click(screen.getByRole("button", { name: "Run claude /login" }));
		expect(await screen.findByText("claude setup-token")).toBeTruthy();
		fireEvent.change(screen.getByLabelText("Paste code from Claude"), {
			target: { value: "code-123" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Finish sign-in" }));

		expect(await screen.findByText("Claude login successful.")).toBeTruthy();
	});

	it("shows the Codex device code, its copy message and the ChatGPT toast", async () => {
		const { page, spies, catalog } = harness([install({ agent: "codex", authenticated: false })]);
		spies.login.mockResolvedValue(
			ok({
				loginId: "login-codex",
				instructions: "Open the page and enter this code.",
				userCode: "ABCD-1234",
				verificationUrl: "https://example.com/device",
			}),
		);
		let finish: ((value: Awaited<ReturnType<typeof catalog.finishLogin>>) => void) | undefined;
		spies.finishLogin.mockImplementation(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		let signedIn = false;
		spies.refresh.mockImplementation(async () => {
			if (signedIn) {
				catalog.setInstalls([
					install({ agent: "codex", authenticated: true, authMethod: "chatgpt" }),
				]);
			}
			return ok(undefined);
		});

		render(page());
		fireEvent.click(screen.getByRole("button", { name: "Run codex login" }));
		expect(await screen.findByText("ABCD-1234")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Copy Codex verification code" }));
		expect(await screen.findByText("Copied Codex verification code.")).toBeTruthy();

		signedIn = true;
		finish?.(ok({ outcome: "signed_in", message: null }));
		await waitFor(() => expect(spies.finishLogin).toHaveBeenCalledWith("login-codex", undefined));
		// Opening the page, finishing the sign-in, and the dialog closing once the agent is signed in.
		await waitFor(() => expect(spies.refresh).toHaveBeenCalledTimes(3));
		expect(await screen.findByText("Codex now uses your ChatGPT plan")).toBeTruthy();

		expect(spies.cancelLogin).not.toHaveBeenCalled();
	});

	it("does not claim nothing is installed when the search hides the installed agents", () => {
		const { page } = harness([
			install({ agent: "claude", authenticated: false }),
			install({ agent: "codex", installed: false }),
		]);
		render(page());

		fireEvent.change(screen.getByLabelText("Search providers"), { target: { value: "codex" } });

		expect(screen.queryByText(/No agent programs were found/)).toBeNull();
	});

	it("cancels the first sign-in before a retry starts another", async () => {
		const { page, spies } = harness([install({ agent: "codex", authenticated: false })]);
		spies.login
			.mockReset()
			.mockResolvedValueOnce(ok({ loginId: "login-1", instructions: "Enter the code." }))
			.mockResolvedValueOnce(ok({ loginId: "login-2", instructions: "Enter the new code." }));
		spies.finishLogin
			.mockReset()
			.mockResolvedValueOnce(err(appError("login_timeout", "The sign-in timed out.")))
			.mockReturnValue(new Promise(() => {}));

		render(page());
		fireEvent.click(screen.getByRole("button", { name: "Run codex login" }));
		expect(await screen.findByText("The sign-in timed out.")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));

		await waitFor(() => expect(spies.cancelLogin).toHaveBeenCalledWith("login-1"));
		await waitFor(() => expect(spies.login).toHaveBeenCalledTimes(2));
		expect(await screen.findByText("Enter the new code.")).toBeTruthy();
		expect(spies.cancelLogin.mock.invocationCallOrder[0]).toBeLessThan(
			spies.login.mock.invocationCallOrder[1] ?? 0,
		);
	});
});
