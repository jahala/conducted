/**
 * @feature PLAT-07 Terminals and scripts use their folder's login environment; acks report
 * Owns: tests over the real container that a script runs with the PATH its folder's login shell
 * sees, that the archive script asks for its folder's environment, and that a terminal whose
 * output acknowledgement fails shows the error.
 * Test first: a run script is spawned with the PATH `loginEnv` returns for its folder.
 */
// @vitest-environment node
import { ok, type Result } from "@conducted/shared";
import { describe, expect, it, vi } from "vitest";
import type { ShellOutput } from "../platform/platform.ts";
import { createTestContainer, seedRepo, seedWorkspace } from "../test/container.ts";

const must = <T>(result: Result<T>): T => {
	if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
	return result.value;
};

describe("PLAT-07 working folders for the login environment", () => {
	it("runs a script with the PATH its folder's login shell sees", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container);
			await test.container.platform.fs.mkdirp(workspace.path);
			const loginEnv = vi
				.spyOn(test.container.platform.shell, "loginEnv")
				.mockImplementation(async (cwd) => ({
					shell: "/bin/zsh",
					path: cwd === workspace.path ? "/mise/shims:/usr/bin" : "/usr/bin",
					zdotdir: null,
				}));
			const spawn = vi.spyOn(test.container.platform.pty, "spawn");

			must(
				await test.container.services.terminals.runScript({
					workspaceId: workspace.id,
					kind: "run",
					title: "Dev server",
					command: "bun dev",
					cwd: workspace.path,
					env: { CONDUCTED_PORT: "55010" },
				}),
			);

			expect(loginEnv).toHaveBeenCalledWith(workspace.path);
			expect(spawn.mock.calls[0]?.[0].env?.PATH).toBe("/mise/shims:/usr/bin");
		} finally {
			test.close();
		}
	});

	it("runs the archive script in its folder's login environment", async () => {
		const test = createTestContainer();
		try {
			const repo = await seedRepo(test.container, { rootPath: "/code/projects/plat-07" });
			test.memory.controls.files.set(
				`${repo.rootPath}/.conducted/settings.toml`,
				'[scripts]\narchive = "make clean"\n',
			);
			const workspace = await seedWorkspace(test.container, { repoId: repo.id });
			const answer: Result<ShellOutput> = ok({ exitCode: 0, stdout: "", stderr: "" });
			test.memory.controls.scriptShell((command) => (command.program === "zsh" ? answer : null));

			must(await test.container.services.runScripts.runArchive(workspace.id));

			const archive = test.memory.controls.shellCalls.find((call) => call.program === "zsh");
			expect(archive?.cwd).toBe(workspace.path);
			expect(archive?.envFromCwd).toBe(true);
		} finally {
			test.close();
		}
	});

	it("shows a failed output acknowledgement as the terminal's error", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container);
			await test.container.platform.fs.mkdirp(workspace.path);
			await test.database.execute("UPDATE workspaces SET state = 'ready' WHERE id = $1", [
				workspace.id,
			]);
			await test.container.services.workspace.start();
			const terminal = must(await test.container.services.terminals.create(workspace.id));
			must(await test.container.services.terminals.ensureConnection(terminal.id));
			const connection =
				test.container.services.terminals.store.getState().connections[terminal.id];
			if (connection?.state !== "ready") throw new Error("The terminal has no connection.");
			test.memory.controls.failPtyAcks("The terminal stopped listening.");

			connection.data.ack(5_000);

			await vi.waitFor(() =>
				expect(
					test.container.services.terminals.store.getState().errors[`t:${terminal.id}`]?.message,
				).toBe("The terminal stopped listening."),
			);
		} finally {
			test.close();
		}
	});
});
