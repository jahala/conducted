import { appError, err, ok } from "@conducted/shared";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../../core/context.tsx";
import type { AgentProgramView } from "../../../core/model.ts";
import { createTestContainer, type TestContainer } from "../../../test/container.ts";
import { toast } from "../../../ui/Toast.tsx";
import { AdvancedPage } from "./AdvancedPage.tsx";

const navigate = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", async (importOriginal) => ({
	...(await importOriginal<typeof import("@tanstack/react-router")>()),
	useNavigate: () => navigate,
}));

const claude: AgentProgramView = {
	status: {
		program: "claude",
		state: "ready",
		version: "2.1.308",
		bytesDownloaded: 10,
		bytesTotal: 10,
		attempt: 0,
		nextAttemptAt: null,
		error: null,
		path: "/app/agent-binaries/claude/2.1.308/claude",
	},
	userPath: null,
};

let test: TestContainer | undefined;

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	navigate.mockReset();
	test?.close();
	test = undefined;
});

async function mountPage() {
	test = createTestContainer();
	await test.container.services.settings.start();
	render(
		<ServicesProvider container={test.container}>
			<AdvancedPage />
		</ServicesProvider>,
	);
	return test;
}

describe("SET-02 AdvancedPage", () => {
	it("refuses a program path that does not exist and does not save it", async () => {
		const mounted = await mountPage();
		const set = vi.spyOn(mounted.container.actions.settings, "set");

		const input = screen.getByLabelText("Claude Code executable path");
		fireEvent.change(input, { target: { value: "/definitely/not/here/claude" } });
		fireEvent.blur(input);

		expect(
			await screen.findByText("No program exists at /definitely/not/here/claude."),
		).toBeTruthy();
		expect(set).not.toHaveBeenCalled();
	});

	it("warns under a custom program path, as Conductor does, and not under an empty one", async () => {
		const mounted = await mountPage();
		const warning =
			"Changing this may cause issues if the executable is not compatible with Conducted.";
		expect(screen.queryByText(warning)).toBeNull();

		await act(async () => {
			await mounted.container.actions.settings.set("codex_executable_path", "/opt/bin/codex");
		});

		expect(await screen.findByText(warning)).toBeTruthy();
	});

	// Conductor looks the program up on PATH (renderApp QFa runs `which <program>`) and offers it as
	// "Use system <program>", with the found path as the field's placeholder and the button's tooltip.
	it("offers Use system Claude Code when PATH has one, and saves its path when chosen", async () => {
		test = createTestContainer();
		const found = "/opt/homebrew/bin/claude";
		test.memory.controls.scriptShell((command) =>
			command.program === "which" && command.args[0] === "claude"
				? ok({ exitCode: 0, stdout: `${found}\n`, stderr: "" })
				: command.program === "which"
					? ok({ exitCode: 1, stdout: "", stderr: "" })
					: null,
		);
		expect((await test.container.platform.fs.writeTextAtomic(found, "")).ok).toBe(true);
		await test.container.services.settings.start();
		render(
			<ServicesProvider container={test.container}>
				<AdvancedPage />
			</ServicesProvider>,
		);

		const use = await screen.findByRole("button", { name: "Use system Claude Code" });
		expect(screen.getByLabelText("Claude Code executable path").getAttribute("placeholder")).toBe(
			found,
		);
		// Codex is not on PATH here: no button, and the usual placeholder.
		expect(screen.queryByRole("button", { name: "Use system Codex" })).toBeNull();
		expect(screen.getByLabelText("Codex executable path").getAttribute("placeholder")).toBe(
			"/usr/local/bin/codex",
		);

		fireEvent.click(use);

		await waitFor(() =>
			expect(test?.container.services.settings.get("claude_executable_path")).toBe(found),
		);
		await waitFor(() =>
			expect(screen.queryByRole("button", { name: "Use system Claude Code" })).toBeNull(),
		);
	});

	it("lays out each executable path under its text, with Conductor's placeholder and folder button", async () => {
		const mounted = await mountPage();
		const pickFile = vi
			.spyOn(mounted.container.actions.app, "pickFile")
			.mockResolvedValue(ok("/opt/tools/claude"));
		// The picked program exists on the in-memory disk, so the path check lets it through.
		expect((await mounted.container.platform.fs.writeTextAtomic("/opt/tools/claude", "")).ok).toBe(
			true,
		);
		const set = vi.spyOn(mounted.container.actions.settings, "set");

		const input = screen.getByLabelText("Claude Code executable path");
		expect(input.getAttribute("placeholder")).toBe("/usr/local/bin/claude");
		expect(screen.getByLabelText("Codex executable path").getAttribute("placeholder")).toBe(
			"/usr/local/bin/codex",
		);
		const row = input.closest("[data-setting-key]");
		expect(row?.querySelector("[data-stacked='true']")).not.toBeNull();

		const browse = row?.querySelector('button[title="Browse for executable"]');
		if (!(browse instanceof HTMLButtonElement)) throw new Error("no folder button");
		fireEvent.click(browse);

		await waitFor(() =>
			expect(set).toHaveBeenCalledWith("claude_executable_path", "/opt/tools/claude"),
		);
		expect(pickFile).toHaveBeenCalledWith("Select Claude Code executable");
	});

	it("resets a custom program path to the bundled program", async () => {
		const mounted = await mountPage();
		await act(async () => {
			await mounted.container.actions.settings.set("codex_executable_path", "/opt/bin/codex");
		});
		const set = vi.spyOn(mounted.container.actions.settings, "set");

		fireEvent.click(await screen.findByRole("button", { name: "Reset to bundled Codex" }));

		await waitFor(() => expect(set).toHaveBeenCalledWith("codex_executable_path", ""));
	});

	it("re-downloads an installed agent program from the Agent binaries section", async () => {
		const mounted = await mountPage();
		const redownload = vi.spyOn(mounted.container.platform.programs, "redownload");
		act(() => {
			mounted.container.services.system.store.setState({
				programs: { state: "ready", data: [claude] },
			});
		});

		fireEvent.click(await screen.findByRole("button", { name: "Re-download" }));

		expect(redownload).toHaveBeenCalledWith("claude");
	});

	it("offers Retry after a failed agent program download", async () => {
		const mounted = await mountPage();
		const install = vi.spyOn(mounted.container.platform.programs, "install");
		act(() => {
			mounted.container.services.system.store.setState({
				programs: {
					state: "ready",
					data: [
						{
							...claude,
							status: {
								...claude.status,
								state: "failed",
								version: null,
								error: "The download was cut off.",
								path: null,
							},
						},
					],
				},
			});
		});

		fireEvent.click(await screen.findByRole("button", { name: "Retry" }));

		expect(install).toHaveBeenCalledWith("claude");
	});

	it("AGENT-09 installs Cursor's SDK from the Agent binaries section", async () => {
		const mounted = await mountPage();
		const install = vi.spyOn(mounted.container.platform.programs, "install");
		act(() => {
			mounted.container.services.system.store.setState({
				programs: {
					state: "ready",
					data: [
						claude,
						{
							userPath: null,
							status: {
								...claude.status,
								program: "cursor",
								state: "missing",
								version: null,
								path: null,
							},
						},
					],
				},
			});
		});

		expect(await screen.findByText("Cursor SDK")).toBeTruthy();
		expect(screen.getByText("Not downloaded yet.")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Install" }));

		expect(install).toHaveBeenCalledWith("cursor");
	});

	it("toasts Installed <name>. when an agent program installs, as Conductor does", async () => {
		const mounted = await mountPage();
		const success = vi.spyOn(toast, "success");
		act(() => {
			mounted.container.services.system.store.setState({
				programs: {
					state: "ready",
					data: [
						{
							...claude,
							status: { ...claude.status, state: "missing", version: null, path: null },
						},
					],
				},
			});
		});

		fireEvent.click(await screen.findByRole("button", { name: "Install" }));

		await waitFor(() => expect(success).toHaveBeenCalledWith("Installed Claude Code."));
	});

	it("says Failed to install <name>: <reason> when an install fails, as Conductor does", async () => {
		const mounted = await mountPage();
		const failure = vi.spyOn(toast, "error");
		vi.spyOn(mounted.container.platform.programs, "install").mockResolvedValue(
			err(appError("program_install_failed", "The download was interrupted.")),
		);
		act(() => {
			mounted.container.services.system.store.setState({
				programs: {
					state: "ready",
					data: [
						{
							...claude,
							status: { ...claude.status, state: "missing", version: null, path: null },
						},
					],
				},
			});
		});

		fireEvent.click(await screen.findByRole("button", { name: "Install" }));

		await waitFor(() =>
			expect(failure).toHaveBeenCalledWith(
				"Failed to install Claude Code: The download was interrupted.",
			),
		);
	});

	it("toasts Installed <name>. when a helper program installs, as Conductor does", async () => {
		const mounted = await mountPage();
		const success = vi.spyOn(toast, "success");
		act(() => {
			mounted.container.services.system.store.setState({
				helpers: {
					state: "ready",
					data: [
						{
							status: {
								program: "gh",
								state: "missing",
								version: null,
								bytesDownloaded: 0,
								bytesTotal: null,
								attempt: 0,
								nextAttemptAt: null,
								error: null,
								path: null,
							},
							userPath: null,
						},
					],
				},
			});
		});

		fireEvent.click(await screen.findByRole("button", { name: "Install" }));

		await waitFor(() => expect(success).toHaveBeenCalledWith("Installed GitHub CLI (gh)."));
	});

	it("D088 shows a failed helper program with Retry, so the app never falls back to PATH", async () => {
		const mounted = await mountPage();
		const install = vi.spyOn(mounted.container.platform.programs, "install");
		act(() => {
			mounted.container.services.system.store.setState({
				helpers: {
					state: "ready",
					data: [
						{
							status: {
								program: "gh",
								state: "failed",
								version: null,
								bytesDownloaded: 0,
								bytesTotal: null,
								attempt: 5,
								nextAttemptAt: null,
								error: "The download was cut off.",
								path: null,
							},
							userPath: null,
						},
					],
				},
			});
		});

		expect(await screen.findByText("GitHub CLI (gh)")).toBeTruthy();
		expect(screen.getByText("The download failed: The download was cut off.")).toBeTruthy();
		fireEvent.click(await screen.findByRole("button", { name: "Retry" }));

		expect(install).toHaveBeenCalledWith("gh");
	});

	describe("CLOUD-12 SSH private key path", () => {
		it("shows Conductor's placeholder and no reset while the auto key is used", async () => {
			await mountPage();
			const input = screen.getByLabelText("SSH private key path");
			expect(input.getAttribute("placeholder")).toBe("~/.ssh/id_ed25519");
			expect(screen.queryByRole("button", { name: "Reset to auto-generated key" })).toBeNull();
		});

		it("resets a custom key back to the auto-generated one", async () => {
			const mounted = await mountPage();
			await act(async () => {
				await mounted.container.actions.settings.set("ssh_key_path", "/keys/custom");
			});
			const set = vi.spyOn(mounted.container.actions.settings, "set");

			fireEvent.click(await screen.findByRole("button", { name: "Reset to auto-generated key" }));

			await waitFor(() => expect(set).toHaveBeenCalledWith("ssh_key_path", ""));
		});

		it("refuses a custom key with no .pub file in Conductor's words", async () => {
			const mounted = await mountPage();
			const set = vi.spyOn(mounted.container.actions.settings, "set");
			const input = screen.getByLabelText("SSH private key path");
			fireEvent.change(input, { target: { value: "/keys/missing" } });
			fireEvent.blur(input);

			expect(
				await screen.findByText("Custom SSH public key not found at /keys/missing.pub"),
			).toBeTruthy();
			expect(set).not.toHaveBeenCalled();
		});

		it("browses with Conductor's titles and saves an existing key pair", async () => {
			const mounted = await mountPage();
			expect((await mounted.container.platform.fs.writeTextAtomic("/keys/custom", "")).ok).toBe(
				true,
			);
			expect(
				(
					await mounted.container.platform.fs.writeTextAtomic(
						"/keys/custom.pub",
						"ssh-ed25519 AAAACUSTOM conducted\n",
					)
				).ok,
			).toBe(true);
			const pickFile = vi
				.spyOn(mounted.container.actions.app, "pickFile")
				.mockResolvedValue(ok("/keys/custom"));
			const set = vi.spyOn(mounted.container.actions.settings, "set");
			const row = screen.getByLabelText("SSH private key path").closest("[data-setting-key]");
			const browse = row?.querySelector('button[title="Browse for SSH key"]');
			if (!(browse instanceof HTMLButtonElement)) throw new Error("no SSH key browser");

			fireEvent.click(browse);

			await waitFor(() => expect(set).toHaveBeenCalledWith("ssh_key_path", "/keys/custom"));
			expect(pickFile).toHaveBeenCalledWith("Select SSH private key");
		});
	});

	it("asks before changing the root folder and saves the new path", async () => {
		const mounted = await mountPage();
		vi.spyOn(mounted.container.actions.app, "pickFolder").mockResolvedValue(ok("/tmp/new-root"));

		// Conductor's button is "Browse", under the description with the path field beside it.
		fireEvent.click(screen.getByRole("button", { name: "Browse" }));
		expect(await screen.findByRole("alertdialog")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Change root path" }));

		await waitFor(() =>
			expect((screen.getByLabelText("Conducted root directory") as HTMLInputElement).value).toBe(
				"/tmp/new-root",
			),
		);
	});
});

describe("SET-02 AdvancedPage root path dialog", () => {
	it("reloads chats and refreshes projects and workspaces, then goes Home", async () => {
		const mounted = await mountPage();
		vi.spyOn(mounted.container.actions.app, "pickFolder").mockResolvedValue(ok("/work/new"));
		const reloadChats = vi
			.spyOn(mounted.container.services.sessions, "start")
			.mockResolvedValue(ok(undefined));
		const refreshRepos = vi
			.spyOn(mounted.container.services.repo, "start")
			.mockResolvedValue(ok(undefined));
		const refreshWorkspaces = vi
			.spyOn(mounted.container.services.workspace, "start")
			.mockResolvedValue(ok(undefined));
		const success = vi.spyOn(toast, "success");

		fireEvent.click(await screen.findByRole("button", { name: "Browse" }));
		fireEvent.click(await screen.findByRole("button", { name: "Change root path" }));

		await waitFor(() =>
			expect(success).toHaveBeenCalledWith("Conducted root path changed successfully"),
		);
		expect(reloadChats).toHaveBeenCalledTimes(1);
		expect(refreshRepos).toHaveBeenCalledTimes(1);
		expect(refreshWorkspaces).toHaveBeenCalledTimes(1);
		expect(navigate).toHaveBeenCalledWith({ to: "/" });
	});

	it("names the old and new root path, as Conductor's dialog does", async () => {
		const mounted = await mountPage();
		await mounted.container.actions.settings.set("conductor_root_path", "/work/old");
		vi.spyOn(mounted.container.actions.app, "pickFolder").mockResolvedValue(ok("/work/new"));

		fireEvent.click(await screen.findByRole("button", { name: "Browse" }));
		expect(await screen.findByText("Change root path?")).toBeTruthy();
		expect(screen.getByText("Old root path:")).toBeTruthy();
		expect(screen.getByText("/work/old")).toBeTruthy();
		expect(screen.getByText("New root path:")).toBeTruthy();
		expect(screen.getByText("/work/new")).toBeTruthy();
	});
});
