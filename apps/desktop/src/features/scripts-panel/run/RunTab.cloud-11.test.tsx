/**
 * @feature CLOUD-11 Local mirror and file sync for a cloud workspace
 * Owns: the Run tab's Open button in a cloud workspace's Local variant. Without the mirror on this
 * Mac, Conductor shows "Couldn't open preview: local workspace mirror is unavailable." and opens
 * nothing.
 * Test first: says the local mirror is unavailable and opens nothing.
 */
import type { Host } from "@conducted/protocol";
import { ok } from "@conducted/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ServicesProvider } from "../../../core/context.tsx";
import type { RepoConfig, RunAction } from "../../../core/model.ts";
import { createTestContainer, seedRepo, seedWorkspace } from "../../../test/container.ts";
import { WithSurfaces } from "../../../test/surfaces.tsx";
import { Toaster, toast } from "../../../ui/Toast.tsx";
import { RunTab } from "./RunTab.tsx";

const CLOUD: Host = { kind: "cloud", url: "https://conducted.example.workers.dev", vmId: "vm-1" };

const localOnly: RunAction = {
	id: "dev",
	label: "Dev server",
	command: "bun dev",
	args: [],
	cwd: null,
	isDefault: true,
	hidden: false,
	icon: null,
	origin: "local",
	availableIn: ["local"],
};

const config: RepoConfig = {
	setupScript: null,
	runScripts: [localOnly],
	runMode: "concurrent",
	archiveScript: null,
	copyFiles: [],
	previewUrls: [{ name: "", url: "http://localhost:$CONDUCTED_PORT" }],
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
	toast.dismiss();
	globalThis.localStorage.clear();
	for (const test of containers.splice(0)) test.close();
});

describe("CLOUD-11 a Local variant's preview", () => {
	it("says the local mirror is unavailable and opens nothing", async () => {
		const test = createTestContainer();
		containers.push(test);
		const repo = await seedRepo(test.container);
		const workspace = await seedWorkspace(test.container, { repoId: repo.id, host: CLOUD });
		await test.database.execute("UPDATE workspaces SET state = 'ready' WHERE id = $1", [
			workspace.id,
		]);
		test.memory.controls.scriptShell((command) =>
			command.program === "git" ? ok({ stdout: "", stderr: "", exitCode: 0 }) : null,
		);
		const updated = await test.container.services.repo.updateConfig(repo.id, config);
		if (!updated.ok) throw new Error(updated.error.message);

		render(
			<ServicesProvider container={test.container}>
				<WithSurfaces>
					<RunTab workspaceId={workspace.id} />
					<Toaster />
				</WithSurfaces>
			</ServicesProvider>,
		);

		expect(await screen.findByRole("button", { name: "Run Dev server" })).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Open" }));

		expect(
			await screen.findByText("Couldn't open preview: local workspace mirror is unavailable."),
		).toBeTruthy();
	});
});
