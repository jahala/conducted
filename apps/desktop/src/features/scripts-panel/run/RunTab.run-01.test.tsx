/**
 * @feature RUN-01 Run tab
 * Owns: tests for the Run tab over the real container: the Run button, the Stop button while an
 * action runs, and the empty state.
 * Test first: with one action and no running process the toolbar shows "Run <label>".
 */
import { appError, ok, type TerminalId } from "@conducted/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearCommandHandlers, runCommandHandlers } from "../../../app/command-dispatcher.ts";
import type { RunState } from "../../../core/api.ts";
import { ServicesProvider } from "../../../core/context.tsx";
import type { Repo, RepoConfig, RunAction, Workspace } from "../../../core/model.ts";
import { createTestContainer, seedRepo, seedWorkspace } from "../../../test/container.ts";
import { WithSurfaces } from "../../../test/surfaces.tsx";
import { RunTab } from "./RunTab.tsx";

const dev: RunAction = {
	id: "dev-server",
	label: "Dev server",
	command: "bun dev",
	args: [],
	cwd: null,
	isDefault: true,
	hidden: false,
	icon: null,
	origin: "local",
	availableIn: ["local", "cloud"],
};

const config = (runScripts: RunAction[]): RepoConfig => ({
	setupScript: null,
	runScripts,
	runMode: "concurrent",
	archiveScript: null,
	copyFiles: [],
	previewUrls: [],
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
	globalThis.localStorage.clear();
	for (const test of containers.splice(0)) test.close();
});

async function setup(runScripts: RunAction[]): Promise<{
	test: ReturnType<typeof createTestContainer>;
	workspace: Workspace;
	repo: Repo;
}> {
	const test = createTestContainer();
	containers.push(test);
	const repo = await seedRepo(test.container);
	const workspace = await seedWorkspace(test.container, { repoId: repo.id });
	const updated = await test.container.services.repo.updateConfig(repo.id, {
		runActions: runScripts.map((action) => ({ kind: "set", action })),
	});
	if (!updated.ok) throw new Error(updated.error.message);
	return { test, workspace, repo };
}

describe("RUN-01 run tab", () => {
	it("shows Run Dev server with one action and no running process", async () => {
		const { test, workspace } = await setup([dev]);

		render(
			<ServicesProvider container={test.container}>
				<WithSurfaces>
					<RunTab workspaceId={workspace.id} />
				</WithSurfaces>
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
					actionId: "dev-server",
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
				<WithSurfaces>
					<RunTab workspaceId={workspace.id} />
				</WithSurfaces>
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
				<WithSurfaces>
					<RunTab workspaceId={workspace.id} />
				</WithSurfaces>
			</ServicesProvider>,
		);
		await screen.findByRole("button", { name: "Run Dev server" });

		expect(runCommandHandlers("workspace.toggleRun")).toBe(true);
		expect(start).toHaveBeenCalledWith(workspace.id, "dev-server");
	});

	it("keeps a stop that was not confirmed in view", async () => {
		const { test, workspace } = await setup([dev]);
		test.container.services.runScripts.store.setState((state) => ({
			...state,
			outcomes: { ...state.outcomes, [workspace.id]: "stop-unconfirmed" },
		}));

		render(
			<ServicesProvider container={test.container}>
				<WithSurfaces>
					<RunTab workspaceId={workspace.id} />
				</WithSurfaces>
			</ServicesProvider>,
		);

		expect(await screen.findByText("The last action may still be running.")).toBeTruthy();
	});

	it("shows why a saved run history could not be read", async () => {
		const { test, workspace } = await setup([dev]);
		test.container.services.runScripts.store.setState((state) => ({
			...state,
			historyError: appError("run_history_invalid", "The saved run history is not readable."),
		}));

		render(
			<ServicesProvider container={test.container}>
				<WithSurfaces>
					<RunTab workspaceId={workspace.id} />
				</WithSurfaces>
			</ServicesProvider>,
		);

		expect(await screen.findByText("The saved run history is not readable.")).toBeTruthy();
	});

	it("says the actions could not be loaded and offers Retry", async () => {
		const { test, workspace, repo } = await setup([dev]);
		const loadConfig = vi
			.spyOn(test.container.services.repo, "loadConfig")
			.mockResolvedValue(ok(config([dev])));
		test.container.services.repo.store.setState((state) => {
			const configs = { ...state.configs };
			delete configs[repo.id];
			return {
				...state,
				configs,
				configErrors: {
					...(state.configErrors ?? {}),
					[repo.id]: appError("repo_config_invalid", "The repository settings are not readable."),
				},
			};
		});

		render(
			<ServicesProvider container={test.container}>
				<WithSurfaces>
					<RunTab workspaceId={workspace.id} />
				</WithSurfaces>
			</ServicesProvider>,
		);

		expect(await screen.findByText("Couldn't load actions.")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		expect(loadConfig).toHaveBeenCalledWith(repo.id);
	});

	it("offers the empty state when the repository has no actions", async () => {
		const { test, workspace } = await setup([]);

		render(
			<ServicesProvider container={test.container}>
				<WithSurfaces>
					<RunTab workspaceId={workspace.id} />
				</WithSurfaces>
			</ServicesProvider>,
		);

		expect(await screen.findByRole("button", { name: "Add action" })).toBeTruthy();
		expect(
			screen.getByText("Run tests or a development server to test changes in this workspace"),
		).toBeTruthy();
	});
});
