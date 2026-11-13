/**
 * @feature RUN-01 Run tab
 * Owns: tests for the message the Run tab shows when an action cannot start because its workspace
 * or project is gone, over the real container.
 * Behaviour: ui-map.md 3.7 (starting an action validates the request); Conductor's message names
 * both missing pieces ("Unable to start: workspace or repository not found").
 * Test first: a start that answers workspace_unknown shows that message.
 */
import { appError, err } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearCommandHandlers } from "../../../app/command-dispatcher.ts";
import { ServicesProvider } from "../../../core/context.tsx";
import type { RepoConfigPatch, RunAction, Workspace } from "../../../core/model.ts";
import { createTestContainer, seedRepo, seedWorkspace } from "../../../test/container.ts";
import { WithSurfaces } from "../../../test/surfaces.tsx";

const { toast } = vi.hoisted(() => {
	const toast = vi.fn();
	return { toast };
});
vi.mock("../../../ui/Toast.tsx", () => ({
	toast: Object.assign(toast, { error: toast }),
	toastError: toast,
}));

const { RunTab } = await import("./RunTab.tsx");

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

const config = (runScripts: RunAction[]): RepoConfigPatch => ({ runScripts });

const containers: ReturnType<typeof createTestContainer>[] = [];

afterEach(() => {
	cleanup();
	clearCommandHandlers();
	toast.mockReset();
	globalThis.localStorage.clear();
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
	const updated = await test.container.services.repo.updateConfig(repo.id, config([dev]));
	if (!updated.ok) throw new Error(updated.error.message);
	return { test, workspace };
}

describe("RUN-01 start failure", () => {
	for (const code of ["workspace_unknown", "repo_unknown"]) {
		it(`names both a missing workspace and a missing project for ${code}`, async () => {
			const { test, workspace } = await setup();
			vi.spyOn(test.container.services.runScripts, "start").mockResolvedValue(
				err(appError(code, "That workspace no longer exists.")),
			);

			render(
				<ServicesProvider container={test.container}>
					<WithSurfaces>
						<RunTab workspaceId={workspace.id} />
					</WithSurfaces>
				</ServicesProvider>,
			);

			fireEvent.click(await screen.findByRole("button", { name: "Run Dev server" }));
			await waitFor(() =>
				expect(toast).toHaveBeenCalledWith("Unable to start: workspace or repository not found"),
			);
		});
	}
});
