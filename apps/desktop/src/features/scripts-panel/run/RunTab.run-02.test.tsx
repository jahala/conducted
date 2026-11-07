/**
 * @feature RUN-02 Spotlight: test workspace changes in the repo root, restore on stop
 * Owns: tests for Spotlight in the Run tab over the real container: the synthetic Spotlight entry,
 * Start and Stop spotlight, the notice that the root's branch moves, and a failed restore.
 * Test first: with "Use spotlight testing" on, the Run tab shows "Start spotlight" and the click
 * starts Spotlight.
 */
import { ok, type TerminalId } from "@conducted/shared";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearCommandHandlers } from "../../../app/command-dispatcher.ts";
import { ServicesProvider } from "../../../core/context.tsx";
import type { RepoConfig, RunAction, Workspace } from "../../../core/model.ts";
import { SPOTLIGHT_BRANCH_NOTICE } from "../../../core/services/spotlight.ts";
import { createTestContainer, seedRepo, seedWorkspace } from "../../../test/container.ts";
import { WithSurfaces } from "../../../test/surfaces.tsx";
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
	availableIn: ["local", "cloud"],
};

const config = (spotlightTesting: boolean): RepoConfig => ({
	setupScript: null,
	runScripts: [dev],
	runMode: "concurrent",
	archiveScript: null,
	copyFiles: [],
	previewUrls: [],
	spotlightTesting,
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
	vi.restoreAllMocks();
	for (const test of containers.splice(0)) test.close();
});

async function mount(
	spotlightTesting: boolean,
): Promise<{ test: ReturnType<typeof createTestContainer>; workspace: Workspace }> {
	const test = createTestContainer();
	containers.push(test);
	const repo = await seedRepo(test.container);
	const workspace = await seedWorkspace(test.container, { repoId: repo.id });
	const updated = await test.container.services.repo.updateConfig(
		repo.id,
		config(spotlightTesting),
	);
	if (!updated.ok) throw new Error(updated.error.message);
	render(
		<ServicesProvider container={test.container}>
			<WithSurfaces>
				<RunTab workspaceId={workspace.id} />
			</WithSurfaces>
		</ServicesProvider>,
	);
	return { test, workspace };
}

describe("RUN-02 Spotlight in the Run tab", () => {
	it("shows Start spotlight when Spotlight testing is on, and the click starts Spotlight", async () => {
		const { test, workspace } = await mount(true);
		// seam: RUN-02 the service's own tests cover the start; this test covers the screen's call.
		const start = vi
			.spyOn(test.container.services.spotlight, "start")
			.mockResolvedValue(ok(undefined));

		fireEvent.click(await screen.findByRole("button", { name: "Start spotlight" }));

		await waitFor(() => expect(start).toHaveBeenCalledWith(workspace.id));
	});

	it("shows the plain Run button when Spotlight testing is off", async () => {
		await mount(false);

		expect(await screen.findByRole("button", { name: "Run Dev server" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Start spotlight" })).toBeNull();
	});

	it("shows Stop spotlight and says the root's branch moves while Spotlight runs", async () => {
		const { test, workspace } = await mount(true);
		await screen.findByRole("button", { name: "Start spotlight" });

		act(() => {
			test.container.services.spotlight.store.setState((state) => ({
				...state,
				active: { [workspace.id]: { active: true, terminalId: "t-spot" as TerminalId } },
			}));
		});

		expect(await screen.findByRole("button", { name: "Stop spotlight" })).toBeTruthy();
		expect(screen.getByText(SPOTLIGHT_BRANCH_NOTICE)).toBeTruthy();
	});

	it("names a restore of the root that failed", async () => {
		const { test, workspace } = await mount(true);
		await screen.findByRole("button", { name: "Start spotlight" });

		act(() => {
			test.container.services.spotlight.store.setState((state) => ({
				...state,
				problems: {
					[workspace.id]: {
						code: "spotlight_restore_failed",
						message: "Couldn't put the repository back as it was before Spotlight started.",
					},
				},
			}));
		});

		expect(
			await screen.findByText(
				"Couldn't put the repository back as it was before Spotlight started.",
			),
		).toBeTruthy();
	});
});
