/**
 * @feature RUN-01 ScriptsPanel
 * Owns: tests that the panel shows the tab the user can act in: the Run tab with the Stop button for a
 * running action, the Setup tab when there is nothing to run, a tab switch, and a collapse that keeps the bodies
 * mounted. A tab body that is not active has the `hidden` attribute, so the role queries here see only the tab on
 * screen.
 * Test first: with run state "running" the Run tab shows the Stop button for that action.
 */
import type { TerminalId } from "@conducted/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { RunState } from "../../core/api.ts";
import { ServicesProvider } from "../../core/context.tsx";
import type { RepoConfig, RunAction, Workspace } from "../../core/model.ts";
import { createTestContainer, seedRepo, seedWorkspace } from "../../test/container.ts";
import { WithSurfaces } from "../../test/surfaces.tsx";
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

async function setup(runScripts: RunAction[] = [dev]): Promise<{
	test: ReturnType<typeof createTestContainer>;
	workspace: Workspace;
}> {
	const test = createTestContainer();
	containers.push(test);
	const repo = await seedRepo(test.container);
	const workspace = await seedWorkspace(test.container, { repoId: repo.id });
	const updated = await test.container.services.repo.updateConfig(repo.id, {
		...config,
		runScripts,
	});
	if (!updated.ok) throw new Error(updated.error.message);
	// The Setup tab reads the workspace's chats, which the app loads when the sessions service
	// starts; the panel waits on "Loading setup" until it has.
	const started = await test.container.services.sessions.start();
	if (!started.ok) throw new Error(started.error.message);
	// A new workspace is still initializing, and the panel then opens on Setup. These cases start from a
	// workspace that finished setting up.
	test.container.services.workspace.store.setState((state) => ({
		workspacesById: {
			...state.workspacesById,
			[workspace.id]: { ...workspace, state: "ready" },
		},
	}));
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
				<WithSurfaces>
					<ScriptsPanel workspaceId={workspace.id} />
				</WithSurfaces>
			</ServicesProvider>,
		);

		expect(await screen.findByRole("button", { name: "Stop Dev server" })).toBeTruthy();
		expect(screen.getByRole("tab", { name: "Run" })).toBeTruthy();
		expect(screen.getByRole("tab", { name: "Setup" })).toBeTruthy();
		// The Run tab is the one on screen. The Setup body is mounted but hidden.
		expect(screen.getByRole("tab", { name: "Run" }).getAttribute("aria-selected")).toBe("true");
		expect(screen.getByRole("tab", { name: "Setup" }).getAttribute("aria-selected")).toBe("false");
		expect(screen.queryByRole("button", { name: "Add manually" })).toBeNull();
	});

	it("opens on the Setup tab while the workspace is still initializing", async () => {
		const { test, workspace } = await setup();
		test.container.services.workspace.store.setState((state) => ({
			workspacesById: {
				...state.workspacesById,
				[workspace.id]: { ...workspace, state: "initializing" },
			},
		}));
		render(
			<ServicesProvider container={test.container}>
				<WithSurfaces>
					<ScriptsPanel workspaceId={workspace.id} />
				</WithSurfaces>
			</ServicesProvider>,
		);

		expect((await screen.findByRole("tab", { name: "Setup" })).getAttribute("aria-selected")).toBe(
			"true",
		);
		expect(screen.queryByRole("button", { name: "Run Dev server" })).toBeNull();
	});

	it("opens on the Setup tab when the repository has no run actions", async () => {
		const { test, workspace } = await setup([]);

		render(
			<ServicesProvider container={test.container}>
				<WithSurfaces>
					<ScriptsPanel workspaceId={workspace.id} />
				</WithSurfaces>
			</ServicesProvider>,
		);

		expect(await screen.findByRole("button", { name: "Add manually" })).toBeTruthy();
		expect(screen.getByRole("tab", { name: "Setup" }).getAttribute("aria-selected")).toBe("true");
		expect(screen.getByRole("tab", { name: "Run" }).getAttribute("aria-selected")).toBe("false");
	});

	it("shows one tab body at a time when the user picks a tab", async () => {
		const { test, workspace } = await setup();
		render(
			<ServicesProvider container={test.container}>
				<WithSurfaces>
					<ScriptsPanel workspaceId={workspace.id} />
				</WithSurfaces>
			</ServicesProvider>,
		);
		await screen.findByRole("button", { name: "Run Dev server" });

		fireEvent.click(screen.getByRole("tab", { name: "Setup" }));

		expect(await screen.findByRole("button", { name: "Add manually" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Run Dev server" })).toBeNull();

		fireEvent.click(screen.getByRole("tab", { name: "Run" }));

		expect(await screen.findByRole("button", { name: "Run Dev server" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Add manually" })).toBeNull();
	});

	it("hides the tab bodies when collapsed and keeps them mounted", async () => {
		const { test, workspace } = await setup();
		render(
			<ServicesProvider container={test.container}>
				<WithSurfaces>
					<ScriptsPanel workspaceId={workspace.id} />
				</WithSurfaces>
			</ServicesProvider>,
		);
		await screen.findByRole("button", { name: "Run Dev server" });

		fireEvent.click(screen.getByRole("button", { name: "Collapse panel" }));

		expect(screen.queryByRole("button", { name: "Run Dev server" })).toBeNull();
		expect(screen.getByRole("button", { name: "Run Dev server", hidden: true })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Expand panel" })).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Expand panel" }));

		expect(await screen.findByRole("button", { name: "Run Dev server" })).toBeTruthy();
	});
});
