/**
 * @feature RUN-03 One port per workspace, port detection and preview URLs
 * Owns: tests that reach the real port service and the run service through the composition root.
 * Test first: the container's port service skips the blocks stored for existing workspaces.
 */
import { ok } from "@conducted/shared";
import { afterEach, describe, expect, it } from "vitest";
import type { ShellOutput } from "../../platform/platform.ts";
import { createTestContainer, seedRepo, seedWorkspace } from "../../test/container.ts";

const LSOF_TIMEOUT_MS = 10_000;

const output = (stdout: string): ShellOutput => ({ exitCode: 0, stdout, stderr: "" });

const containers: ReturnType<typeof createTestContainer>[] = [];

afterEach(() => {
	for (const test of containers.splice(0)) test.close();
});

describe("RUN-03 port service through the container", () => {
	it("skips the blocks already stored and the block whose first port is busy", async () => {
		const test = createTestContainer();
		containers.push(test);
		const repo = await seedRepo(test.container);
		await seedWorkspace(test.container, { repoId: repo.id, port: 55_000 });
		await seedWorkspace(test.container, { repoId: repo.id, port: 55_010 });
		test.memory.controls.scriptShell((command) => {
			if (command.program !== "lsof" || !command.args.includes("-iTCP")) return null;
			return ok(output("p321\ncdev\nn*:55020\n"));
		});

		const allocated = await test.container.services.ports.allocateForNewWorkspace();

		expect(allocated).toEqual({ ok: true, value: 55_030 });
		expect(test.memory.controls.shellCalls[0]?.timeoutMs).toBe(LSOF_TIMEOUT_MS);
	});

	it("lists only the ports of the workspace's own processes", async () => {
		const test = createTestContainer();
		containers.push(test);
		const repo = await seedRepo(test.container);
		const workspace = await seedWorkspace(test.container, { repoId: repo.id });
		test.memory.controls.scriptShell((command) => {
			if (command.program === "lsof" && command.args.includes("-iTCP")) {
				return ok(output("p101\ncnode\nn*:3000\np202\ncnode\nn*:4000\n"));
			}
			if (command.program === "lsof" && command.args.includes("txt")) {
				return ok(
					output(
						"p101\nn/Applications/Google Chrome.app/Contents/MacOS/Google Chrome\np202\nn/usr/local/bin/node\n",
					),
				);
			}
			if (command.program === "lsof" && command.args.includes("cwd")) {
				return ok(output(`p101\nn${workspace.path}\np202\nn/elsewhere\n`));
			}
			return null;
		});

		const listed = await test.container.services.ports.listListening(workspace.id, workspace.path);

		expect(listed).toEqual({
			ok: true,
			value: [{ port: 3000, pid: 101, command: "node", appName: "Google Chrome" }],
		});
	});

	it("reaches the run service's port scan through the container", async () => {
		const test = createTestContainer();
		containers.push(test);
		const repo = await seedRepo(test.container);
		const workspace = await seedWorkspace(test.container, { repoId: repo.id });
		test.memory.controls.scriptShell((command) => {
			if (command.program === "lsof" && command.args.includes("-iTCP")) {
				return ok(output("p101\ncnode\nn*:3000\n"));
			}
			if (command.program === "lsof" && command.args.includes("txt")) {
				return ok(output("p101\nn/Applications/Google Chrome.app/Contents/MacOS/Google Chrome\n"));
			}
			if (command.program === "lsof" && command.args.includes("cwd")) {
				return ok(output(`p101\nn${workspace.path}\n`));
			}
			return null;
		});

		const refreshed = await test.container.services.runScripts.refreshPorts(
			workspace.id,
			workspace.path,
		);

		expect(refreshed.ok).toBe(true);
		expect(
			test.container.services.runScripts.store.getState().byWorkspace[workspace.id]?.detectedPorts,
		).toEqual([{ port: 3000, pid: 101, processName: "node", appName: "Google Chrome" }]);
	});
});
