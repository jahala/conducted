/**
 * @feature SET-13 Chosen program paths reach terminals and scripts
 * Owns: tests that a terminal and a run script carry `CONDUCTED_PATH_PREFIX`.
 * Test first: an interactive terminal is spawned with the folder the path prefix source returns.
 */
import { ok } from "@conducted/shared";
import { describe, expect, it, vi } from "vitest";
import { createTestContainer, seedWorkspace } from "../../test/container.ts";
import { binDir } from "../app-paths.ts";

describe("SET-13 terminals receive the chosen program path prefix", () => {
	it("adds the prefix to an interactive terminal", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container);
			await test.container.platform.fs.mkdirp(workspace.path);
			await test.database.execute("UPDATE workspaces SET state = 'ready' WHERE id = $1", [
				workspace.id,
			]);
			await test.container.services.workspace.start();
			await test.container.services.settings.set("claude_executable_path", "/opt/claude");
			vi.spyOn(test.container.platform.programs, "syncPathOverrides").mockResolvedValue(
				ok("/data/bin-overrides/abc"),
			);
			const spawn = vi.spyOn(test.container.platform.pty, "spawn");

			const created = await test.container.services.terminals.create(workspace.id);

			expect(created.ok).toBe(true);
			expect(spawn.mock.calls[0]?.[0].env?.CONDUCTED_PATH_PREFIX).toBe(
				`/data/bin-overrides/abc:${binDir(test.container.platform.fs.paths)}`,
			);
		} finally {
			test.close();
		}
	});

	it("adds the prefix to a run script and keeps its other variables", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container);
			await test.container.platform.fs.mkdirp(workspace.path);
			await test.container.services.settings.set("claude_executable_path", "/opt/claude");
			vi.spyOn(test.container.platform.programs, "syncPathOverrides").mockResolvedValue(
				ok("/data/bin-overrides/abc"),
			);
			const spawn = vi.spyOn(test.container.platform.pty, "spawn");

			const started = await test.container.services.terminals.runScript({
				workspaceId: workspace.id,
				kind: "run",
				title: "Dev server",
				command: "bun dev",
				cwd: workspace.path,
				env: { CONDUCTED_PORT: "55010", TERM: "xterm-256color" },
			});

			expect(started.ok).toBe(true);
			expect(spawn.mock.calls[0]?.[0].env).toMatchObject({
				CONDUCTED_PORT: "55010",
				TERM: "xterm-256color",
				CONDUCTED_PATH_PREFIX: `/data/bin-overrides/abc:${binDir(
					test.container.platform.fs.paths,
				)}`,
			});
		} finally {
			test.close();
		}
	});

	it("keeps a prefix a script already carries", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container);
			await test.container.platform.fs.mkdirp(workspace.path);
			const sync = vi.spyOn(test.container.platform.programs, "syncPathOverrides");
			const spawn = vi.spyOn(test.container.platform.pty, "spawn");

			await test.container.services.terminals.runScript({
				workspaceId: workspace.id,
				kind: "run",
				title: "Dev server",
				command: "bun dev",
				cwd: workspace.path,
				env: { CONDUCTED_PATH_PREFIX: "/already/staged" },
			});

			expect(sync).not.toHaveBeenCalled();
			expect(spawn.mock.calls[0]?.[0].env?.CONDUCTED_PATH_PREFIX).toBe("/already/staged");
		} finally {
			test.close();
		}
	});
});
