/**
 * @feature RUN-01 ScriptsPanel
 * Owns: tests that the panel mounts the Run tab body and shows the Stop button for a running action.
 * Test first: with run state "running" the Run tab shows the Stop button for that action.
 */
import type { TerminalId } from "@conducted/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { RunState } from "../../core/api.ts";
import { ServicesProvider } from "../../core/context.tsx";
import type { RepoConfig, RunAction, Workspace } from "../../core/model.ts";
import { createTestContainer, seedRepo, seedWorkspace } from "../../test/container.ts";
import { ScriptsPanel } from "./ScriptsPanel.tsx";

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

const config: RepoConfig = {
	setupScript: null,
	runScripts: [dev],
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
};

const containers: ReturnType<typeof createTestContainer>[] = [];

afterEach(() => {
	cleanup();
	for (const test of containers.splice(0)) test.close();
});

async function setup(): Promise<{
	test: ReturnType<typeof createTestContainer>;
	workspace: Workspace;
}> {
	const test = createTestContainer();
	containers.push(test);
	const repo = await seedRepo(test.container);
	const workspace = await seedWorkspace(test.container, { repoId: repo.id });
	const updated = await test.container.services.repo.updateConfig(repo.id, config);
	if (!updated.ok) throw new Error(updated.error.message);
	return { test, workspace };
}

describe("RUN-01 scripts panel", () => {
	it("shows the Stop button in the Run tab while its action runs", async () => {
		const { test, workspace } = await setup();
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
				<ScriptsPanel workspaceId={workspace.id} />
			</ServicesProvider>,
		);

		expect(await screen.findByRole("button", { name: "Stop Dev server" })).toBeTruthy();
		expect(screen.getByRole("tab", { name: "Run" })).toBeTruthy();
		expect(screen.getByRole("tab", { name: "Setup" })).toBeTruthy();
	});
});
