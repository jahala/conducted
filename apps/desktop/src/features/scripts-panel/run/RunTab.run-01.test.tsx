/**
 * @feature RUN-01 Run tab
 * Owns: tests for the Run tab over the real container: the Run button, the Stop button while an
 * action runs, and the empty state.
 * Test first: with one action and no running process the toolbar shows "Run <label>".
 */
import { ok, type TerminalId } from "@conducted/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearCommandHandlers, runCommandHandlers } from "../../../app/command-dispatcher.ts";
import type { RunState } from "../../../core/api.ts";
import { ServicesProvider } from "../../../core/context.tsx";
import type { RepoConfig, RunAction, Workspace } from "../../../core/model.ts";
import { createTestContainer, seedRepo, seedWorkspace } from "../../../test/container.ts";
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

const config = (runScripts: RunAction[]): RepoConfig => ({
	setupScript: null,
	runScripts,
	runMode: "concurrent",
	archiveScript: null,
	copyFiles: [],
	previewUrlTemplate: null,
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
	clearCommandHandlers();
	for (const test of containers.splice(0)) test.close();
});

async function setup(
	runScripts: RunAction[],
): Promise<{ test: ReturnType<typeof createTestContainer>; workspace: Workspace }> {
	const test = createTestContainer();
	containers.push(test);
	const repo = await seedRepo(test.container);
	const workspace = await seedWorkspace(test.container, { repoId: repo.id });
	const updated = await test.container.services.repo.updateConfig(repo.id, config(runScripts));
	if (!updated.ok) throw new Error(updated.error.message);
	return { test, workspace };
}

describe("RUN-01 run tab", () => {
	it("shows Run Dev server with one action and no running process", async () => {
		const { test, workspace } = await setup([dev]);

		render(
			<ServicesProvider container={test.container}>
				<RunTab workspaceId={workspace.id} />
			</ServicesProvider>,
		);

		expect(await screen.findByRole("button", { name: "Run Dev server" })).toBeTruthy();
	});

	it("shows Stop Dev server while that action runs", async () => {
		const { test, workspace } = await setup([dev]);
		const running: RunState = {
			actions: [dev],
			running: [
				{
					actionId: "dev",
					terminalId: "t1" as TerminalId,
					url: null,
					phase: "running",
				},
			],
			spotlight: { active: false, terminalId: null },
			detectedPorts: [],
		};
		test.container.services.runScripts.store.setState((state) => ({
			...state,
			byWorkspace: { ...state.byWorkspace, [workspace.id]: running },
			phases: { ...state.phases, [workspace.id]: "running" },
		}));

		render(
			<ServicesProvider container={test.container}>
				<RunTab workspaceId={workspace.id} />
			</ServicesProvider>,
		);

		expect(await screen.findByRole("button", { name: "Stop Dev server" })).toBeTruthy();
	});

	it("starts the selected action from the Cmd+R command", async () => {
		const { test, workspace } = await setup([dev]);
		const start = vi
			.spyOn(test.container.services.runScripts, "start")
			.mockResolvedValue(ok(undefined));

		render(
			<ServicesProvider container={test.container}>
				<RunTab workspaceId={workspace.id} />
			</ServicesProvider>,
		);
		await screen.findByRole("button", { name: "Run Dev server" });

		expect(runCommandHandlers("workspace.toggleRun")).toBe(true);
		expect(start).toHaveBeenCalledWith(workspace.id, "dev");
	});

	it("offers the empty state when the repository has no actions", async () => {
		const { test, workspace } = await setup([]);

		render(
			<ServicesProvider container={test.container}>
				<RunTab workspaceId={workspace.id} />
			</ServicesProvider>,
		);

		expect(await screen.findByRole("button", { name: "Add action" })).toBeTruthy();
		expect(
			screen.getByText("Run tests or a development server to test changes in this workspace."),
		).toBeTruthy();
	});
});
