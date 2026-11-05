/**
 * @feature RUN-03 One port per workspace, port detection and preview URLs
 * Owns: tests that the Run tab's Open menu is built from the run output, the detected ports and
 * the repository template, and that Cmd+Shift+B opens the first localhost URL.
 * Test first: the menu lists the run output, a detected port and the expanded template.
 */
import type { TerminalId } from "@conducted/shared";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandDispatcher, createCommandRegistry } from "../../../app/command-dispatcher.ts";
import type { RunState } from "../../../core/api.ts";
import { ServicesProvider } from "../../../core/context.tsx";
import type { RepoConfig, RunAction, Workspace } from "../../../core/model.ts";
import { createTestContainer, seedRepo, seedWorkspace } from "../../../test/container.ts";
import { renderWithRouter } from "../../../test/render-with-router.tsx";
import { RunTab } from "./RunTab.tsx";

const dev: RunAction = {
	id: "dev",
	label: "Dev server",
	command: "bun dev",
	args: [],
	cwd: null,
	isDefault: true,
	hidden: false,
	icon: null,
	origin: "local",
};

const config = (previewUrlTemplate: string | null): RepoConfig => ({
	setupScript: null,
	runScripts: [dev],
	runMode: "concurrent",
	archiveScript: null,
	copyFiles: [],
	previewUrlTemplate,
	spotlightTesting: false,
	autoRunAfterSetup: false,
	remoteName: "origin",
	prompts: {
		general: null,
		codeReview: null,
		createPr: null,
		fixErrors: null,
		resolveConflicts: null,
		renameBranch: null,
	},
});

const containers: ReturnType<typeof createTestContainer>[] = [];

afterEach(() => {
	cleanup();
	globalThis.localStorage.clear();
	for (const test of containers.splice(0)) test.close();
});

async function setup(previewUrlTemplate: string | null = null) {
	const test = createTestContainer();
	containers.push(test);
	const repo = await seedRepo(test.container);
	const workspace = await seedWorkspace(test.container, { repoId: repo.id, port: 55_000 });
	const updated = await test.container.services.repo.updateConfig(
		repo.id,
		config(previewUrlTemplate),
	);
	if (!updated.ok) throw new Error(updated.error.message);
	const run: RunState = {
		actions: [dev],
		running: [
			{
				actionId: "dev",
				terminalId: "t1" as TerminalId,
				url: "http://localhost:3000",
				phase: "running",
			},
		],
		spotlight: { active: false, terminalId: null },
		detectedPorts: [{ port: 5173, pid: 2, processName: "vite", appName: null }],
	};
	test.container.services.runScripts.store.setState((state) => ({
		...state,
		byWorkspace: { ...state.byWorkspace, [workspace.id]: run },
		phases: { ...state.phases, [workspace.id]: "running" },
	}));
	return { test, workspace };
}

function renderTab(test: ReturnType<typeof createTestContainer>, workspace: Workspace): void {
	renderWithRouter(
		<ServicesProvider container={test.container}>
			<CommandDispatcher registry={createCommandRegistry()}>
				<RunTab workspaceId={workspace.id} />
			</CommandDispatcher>
		</ServicesProvider>,
	);
}

describe("RUN-03 run tab preview URLs", () => {
	it("lists the run output, the detected ports and the expanded template", async () => {
		const { test, workspace } = await setup("http://localhost:$PORT/app");

		renderTab(test, workspace);
		await screen.findByRole("button", { name: "Open" });

		fireEvent.keyDown(screen.getByRole("button", { name: "Choose preview URL" }), {
			key: "Enter",
		});

		expect(await screen.findByText("Run output")).toBeTruthy();
		expect(await screen.findByText("Port 5173")).toBeTruthy();
		expect(await screen.findByText("Preview URL")).toBeTruthy();
	});

	it("opens the run output URL with Open", async () => {
		const { test, workspace } = await setup();
		const openUrl = vi.spyOn(test.container.platform.opener, "openUrl");

		renderTab(test, workspace);
		fireEvent.click(await screen.findByRole("button", { name: "Open" }));

		expect(openUrl).toHaveBeenCalledWith("http://localhost:3000");
	});

	it("opens the localhost URL from Cmd+Shift+B", async () => {
		const { test, workspace } = await setup();
		const openUrl = vi.spyOn(test.container.platform.opener, "openUrl");

		renderTab(test, workspace);
		await screen.findByRole("button", { name: "Open" });

		act(() => {
			document.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "b",
					metaKey: true,
					shiftKey: true,
					bubbles: true,
					cancelable: true,
				}),
			);
		});

		expect(openUrl).toHaveBeenCalledWith("http://localhost:3000");
	});
});
