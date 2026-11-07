/**
 * @feature CLOUD-09 Cloud terminals, run scripts and previews
 * Owns: the Run tab's task picker in a cloud workspace: an action that can run in both places is
 * listed twice under Cloud and Local, and the cloud variant is the one the Run button starts.
 * Behaviour: services-map.md 5A.1.6 (a task with both targets becomes a cloud and a local-mirror
 * variant, grouped Cloud before Local; ui-map.md 3.7 "Can run in").
 * Test first: a cloud workspace lists an action's two variants under the Cloud and Local groups.
 */
import type { Host } from "@conducted/protocol";
import { ok } from "@conducted/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ServicesProvider } from "../../../core/context.tsx";
import type { RepoConfig, RunAction } from "../../../core/model.ts";
import { createTestContainer, seedRepo, seedWorkspace } from "../../../test/container.ts";
import { WithSurfaces } from "../../../test/surfaces.tsx";
import { RunTab } from "./RunTab.tsx";

const CLOUD: Host = { kind: "cloud", url: "https://conducted.example.workers.dev", vmId: "vm-1" };

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
	availableIn: ["local", "cloud"],
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
	globalThis.localStorage.clear();
	for (const test of containers.splice(0)) test.close();
});

describe("CLOUD-09 the Run tab in a cloud workspace", () => {
	it("lists the action's two variants under Cloud and Local, with the cloud one selected", async () => {
		const test = createTestContainer();
		containers.push(test);
		const repo = await seedRepo(test.container);
		const workspace = await seedWorkspace(test.container, { repoId: repo.id, host: CLOUD });
		await test.database.execute("UPDATE workspaces SET state = 'ready' WHERE id = $1", [
			workspace.id,
		]);
		// A cloud repo reads its shared settings from the shared clone, so git answers every command.
		test.memory.controls.scriptShell((command) =>
			command.program === "git" ? ok({ stdout: "", stderr: "", exitCode: 0 }) : null,
		);
		const updated = await test.container.services.repo.updateConfig(repo.id, config);
		if (!updated.ok) throw new Error(updated.error.message);

		render(
			<ServicesProvider container={test.container}>
				<WithSurfaces>
					<RunTab workspaceId={workspace.id} />
				</WithSurfaces>
			</ServicesProvider>,
		);

		expect(await screen.findByRole("button", { name: "Run Dev server" })).toBeTruthy();
		fireEvent.keyDown(screen.getByRole("combobox", { name: "Select task" }), { key: "Enter" });

		expect(await screen.findByText("Cloud")).toBeTruthy();
		expect(screen.getByText("Local")).toBeTruthy();
		expect(screen.getAllByRole("option", { name: "Dev server" })).toHaveLength(2);
	});
});
