import { idleLiveState } from "@conducted/protocol";
import { appError, err, ok } from "@conducted/shared";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppProviders, createQueryClient } from "../../app/providers.tsx";
import { createAppRouter } from "../../app/router.tsx";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, seedWorkspace, type TestContainer } from "../../test/container.ts";

const ENVIRONMENT = [
	"LANG=en_AU.UTF-8",
	"API_TOKEN=super-secret",
	"HOME=/Users/conducted",
	"PATH=/Users/conducted/bin:/usr/bin:/bin",
].join("\n");

let test: TestContainer | undefined;

afterEach(() => {
	cleanup();
	test?.close();
	test = undefined;
});

function scriptEnvironment(container: TestContainer): void {
	container.memory.controls.scriptShell((command) => {
		if (command.program === "/bin/zsh") {
			return ok({ exitCode: 0, stdout: ENVIRONMENT, stderr: "" });
		}
		if (command.program === "open") return ok({ exitCode: 0, stdout: "", stderr: "" });
		return null;
	});
}

async function mountDiagnostics(options: { seedWorkspace?: boolean; from?: "workspace" } = {}) {
	test = createTestContainer();
	scriptEnvironment(test);
	await test.container.services.settings.start();
	const workspace = options.seedWorkspace === true ? await seedWorkspace(test.container) : null;
	const entries =
		options.from === "workspace" && workspace !== null
			? [`/repository/${workspace.repoId}/workspace/${workspace.id}`, "/diagnostics"]
			: ["/diagnostics"];
	const router = createAppRouter(createMemoryHistory({ initialEntries: entries }));
	render(
		<ServicesProvider container={test.container}>
			<AppProviders client={createQueryClient(() => {})}>
				<RouterProvider router={router} />
			</AppProviders>
		</ServicesProvider>,
	);
	await router.load();
	await screen.findByRole("heading", { name: "Diagnostics" });
	return { mounted: test, router, workspace };
}

describe("APP-03 diagnostics screen", () => {
	it("shows a hash for a TOKEN value and never the value", async () => {
		await mountDiagnostics();
		await screen.findByText("API_TOKEN");

		expect(screen.queryByText("super-secret")).toBeNull();
		expect(screen.getByText("LANG")).toBeTruthy();
		expect(screen.getByText("en_AU.UTF-8")).toBeTruthy();
	});

	it("copies the redacted report without the secret", async () => {
		const { mounted } = await mountDiagnostics();
		await screen.findByText("API_TOKEN");

		fireEvent.click(screen.getByRole("button", { name: "Copy redacted report" }));

		await waitFor(() => expect(mounted.memory.controls.clipboardText).toContain("API_TOKEN="));
		expect(mounted.memory.controls.clipboardText).not.toContain("super-secret");
		expect(await screen.findByText("Report copied")).toBeTruthy();
	});

	it("asks before copying the full report and copies nothing until it is given", async () => {
		const { mounted } = await mountDiagnostics();
		const copies: string[] = [];
		const original = mounted.container.platform.clipboard.writeText.bind(
			mounted.container.platform.clipboard,
		);
		mounted.container.platform.clipboard.writeText = async (text) => {
			copies.push(text);
			await original(text);
		};
		await screen.findByText("API_TOKEN");

		mounted.memory.controls.queueDialogAnswers({ confirm: false });
		fireEvent.click(screen.getByRole("button", { name: "Copy report" }));
		await waitFor(() => expect(screen.getByRole("button", { name: "Copy report" })).toBeTruthy());
		expect(copies).toHaveLength(0);

		mounted.memory.controls.queueDialogAnswers({ confirm: true });
		fireEvent.click(screen.getByRole("button", { name: "Copy report" }));
		await waitFor(() => expect(copies).toHaveLength(1));
		expect(copies[0]).toContain("super-secret");
		expect(await screen.findByText("Full values")).toBeTruthy();
	});

	it("copies the exported logs and says so", async () => {
		const { mounted } = await mountDiagnostics();
		await screen.findByText("API_TOKEN");
		const exported = `${mounted.container.platform.fs.paths.temp}/conducted-logs.zip`;
		mounted.memory.controls.files.set(exported, "app log line");

		fireEvent.click(screen.getByRole("button", { name: "Copy logs (may include personal data)" }));

		await waitFor(() => expect(mounted.memory.controls.clipboardText).toBe("app log line"));
		expect(await screen.findByText("App logs copied")).toBeTruthy();
	});

	it("does not copy logs when the export fails", async () => {
		const { mounted } = await mountDiagnostics();
		await screen.findByText("API_TOKEN");
		vi.spyOn(mounted.container.platform.app, "exportLogs").mockResolvedValue(
			err(appError("log_export_task_failed", "The disk is full.")),
		);

		fireEvent.click(screen.getByRole("button", { name: "Copy logs (may include personal data)" }));

		expect(await screen.findByText("Couldn't copy the logs")).toBeTruthy();
		expect(mounted.memory.controls.clipboardText).toBeNull();
	});

	it("disables the chat action without a workspace and starts a chat with the report when one exists", async () => {
		const { mounted, workspace, router } = await mountDiagnostics({ seedWorkspace: true });
		await screen.findByText("API_TOKEN");
		const create = vi
			.spyOn(mounted.container.services.sessions, "createDiagnosticsChat")
			.mockResolvedValue(ok(undefined));

		fireEvent.click(
			screen.getByRole("button", {
				name: "Ask agent to analyze redacted report",
			}),
		);

		await waitFor(() => expect(create).toHaveBeenCalledWith(workspace?.id));
		await waitFor(() =>
			expect(router.state.location.pathname).toBe(
				`/repository/${workspace?.repoId}/workspace/${workspace?.id}`,
			),
		);
	});

	it("asks before restarting while an agent is working", async () => {
		const { mounted } = await mountDiagnostics();
		await screen.findByText("API_TOKEN");
		mounted.container.services.sessions.store.setState({
			liveStates: { s1: { ...idleLiveState, status: "working" } },
		});
		const relaunch = vi.spyOn(mounted.container.platform.updater, "relaunch");

		mounted.memory.controls.queueDialogAnswers({ confirm: false });
		fireEvent.click(screen.getByRole("button", { name: "Restart" }));
		await waitFor(() => expect(mounted.memory.controls.clipboardText === null).toBe(true));
		expect(relaunch).not.toHaveBeenCalled();

		mounted.memory.controls.queueDialogAnswers({ confirm: true });
		fireEvent.click(screen.getByRole("button", { name: "Restart" }));
		await waitFor(() => expect(relaunch).toHaveBeenCalledTimes(1));
	});

	it("opens the sidecar logs from the app", async () => {
		const { mounted } = await mountDiagnostics();
		await screen.findByText("API_TOKEN");

		const result = await mounted.container.actions.app.openSidecarLogs();

		expect(result.ok).toBe(true);
		expect(mounted.memory.controls.shellCalls.at(-1)?.program).toBe("open");
		expect(mounted.memory.controls.shellCalls.at(-1)?.args).toEqual([
			`${mounted.container.platform.fs.paths.appData}/sidecar.log`,
		]);
	});

	it("goes back to the workspace when Back is clicked", async () => {
		const { workspace, router } = await mountDiagnostics({
			seedWorkspace: true,
			from: "workspace",
		});
		await screen.findByText("API_TOKEN");
		const workspacePath = `/repository/${workspace?.repoId}/workspace/${workspace?.id}`;

		fireEvent.click(screen.getByRole("button", { name: "Back" }));

		await waitFor(() => expect(router.state.location.pathname).toBe(workspacePath));
		expect(await screen.findByRole("main")).toBeTruthy();
	});

	it("returns to the previous screen on Cmd+Escape and opens the developer tools on Cmd+Alt+I", async () => {
		const { mounted, router, workspace } = await mountDiagnostics({
			seedWorkspace: true,
			from: "workspace",
		});
		const inspector = vi.spyOn(mounted.container.platform.window, "toggleInspector");
		await screen.findByText("API_TOKEN");
		await waitFor(() => expect(router.state.location.pathname).toBe("/diagnostics"));

		fireEvent.keyDown(document, { key: "i", metaKey: true, altKey: true });
		await waitFor(() => expect(inspector).toHaveBeenCalledTimes(1));

		fireEvent.keyDown(document, { key: "Escape", metaKey: true });
		await waitFor(() =>
			expect(router.state.location.pathname).toBe(
				`/repository/${workspace?.repoId}/workspace/${workspace?.id}`,
			),
		);
	});

	it("opens the app logs from the app log viewer command", async () => {
		const { mounted } = await mountDiagnostics();
		await screen.findByText("API_TOKEN");

		const result = await mounted.container.actions.app.runCommand("app.openLogViewer");

		expect(result.ok).toBe(true);
		expect(mounted.memory.controls.shellCalls.at(-1)?.args).toEqual([
			`${mounted.container.platform.fs.paths.temp}/conducted-logs.zip`,
		]);
	});

	it("says when the capture fails and offers Retry", async () => {
		test = createTestContainer();
		test.memory.controls.scriptShell((command) =>
			command.program === "/bin/zsh" ? err(appError("shell_failed", "No shell.")) : null,
		);
		await test.container.services.settings.start();
		const router = createAppRouter(createMemoryHistory({ initialEntries: ["/diagnostics"] }));
		render(
			<ServicesProvider container={test.container}>
				<AppProviders client={createQueryClient(() => {})}>
					<RouterProvider router={router} />
				</AppProviders>
			</ServicesProvider>,
		);
		await router.load();

		expect(await screen.findByText("Couldn't capture diagnostics")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
	});

	it("shows each section", async () => {
		await mountDiagnostics();
		await screen.findByText("API_TOKEN");

		expect(screen.getByRole("heading", { name: "App and system" })).toBeTruthy();
		expect(screen.getByRole("heading", { name: "PATH" })).toBeTruthy();
		expect(screen.getByRole("heading", { name: "Agent programs" })).toBeTruthy();
		expect(screen.getByRole("heading", { name: "Environment variables" })).toBeTruthy();
	});
});
