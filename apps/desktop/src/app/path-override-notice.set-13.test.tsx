/**
 * @feature SET-13 Chosen program paths reach terminals and scripts
 * Owns: tests that a chosen program path that cannot be staged is shown to the user when a
 * terminal opens, and that the terminal still opens with the bundled folder.
 * Test first: a failed staging shows "Your chosen program path can't be used" with the reason.
 */
import { appError, err, ok } from "@conducted/shared";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { binDir } from "../core/app-paths.ts";
import { ServicesProvider } from "../core/context.tsx";
import { createTestContainer, seedWorkspace, type TestContainer } from "../test/container.ts";
import { Toaster, toast } from "../ui/Toast.tsx";
import { PATH_OVERRIDE_NOTICE_TITLE, PathOverrideNotice } from "./path-override-notice.ts";

let test: TestContainer | undefined;

afterEach(() => {
	cleanup();
	toast.dismiss();
	test?.close();
	test = undefined;
	vi.restoreAllMocks();
});

async function readyWorkspace(container: TestContainer) {
	const workspace = await seedWorkspace(container.container);
	await container.container.platform.fs.mkdirp(workspace.path);
	await container.database.execute("UPDATE workspaces SET state = 'ready' WHERE id = $1", [
		workspace.id,
	]);
	await container.container.services.workspace.start();
	await container.container.services.settings.set("claude_executable_path", "/opt/gone/claude");
	return workspace;
}

describe("SET-13 a chosen program path that cannot be used", () => {
	it("tells the user when a terminal opens, and the terminal opens with the bundled folder", async () => {
		test = createTestContainer();
		const workspace = await readyWorkspace(test);
		vi.spyOn(test.container.platform.programs, "syncPathOverrides").mockResolvedValue(
			err(appError("path_override_invalid", "The claude program path /opt/gone/claude is gone.")),
		);
		const spawn = vi.spyOn(test.container.platform.pty, "spawn");
		render(
			<ServicesProvider container={test.container}>
				<PathOverrideNotice />
				<Toaster />
			</ServicesProvider>,
		);

		let created: Awaited<ReturnType<typeof test.container.actions.terminals.create>> | undefined;
		await act(async () => {
			created = await test?.container.actions.terminals.create(workspace.id);
		});

		expect(created?.ok).toBe(true);
		expect(spawn.mock.calls[0]?.[0].env?.CONDUCTED_PATH_PREFIX).toBe(
			binDir(test.container.platform.fs.paths),
		);
		expect(await screen.findByText(PATH_OVERRIDE_NOTICE_TITLE)).toBeTruthy();
		expect(
			screen.getByText(
				"The claude program path /opt/gone/claude is gone. Terminals and scripts use the bundled program until you fix the path in Settings, Advanced.",
			),
		).toBeTruthy();
	});

	it("clears the problem once staging works again", async () => {
		test = createTestContainer();
		await readyWorkspace(test);
		const sync = vi
			.spyOn(test.container.platform.programs, "syncPathOverrides")
			.mockResolvedValue(err(appError("path_override_invalid", "Gone.")));
		const system = test.container.services.system;

		await system.pathPrefix();
		expect(system.store.getState().pathOverrideProblem).toEqual({ serial: 1, message: "Gone." });
		await system.pathPrefix();
		expect(system.store.getState().pathOverrideProblem?.serial).toBe(2);

		sync.mockResolvedValue(ok("/data/bin-overrides/abc"));
		await system.pathPrefix();
		expect(system.store.getState().pathOverrideProblem).toBeNull();
	});
});
