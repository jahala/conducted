// @vitest-environment node
/**
 * @feature CHAT-23 Run button on shell code blocks
 * Owns: tests over the real container that a chat command starts as a run terminal in the
 * workspace, and that an empty command or a workspace that cannot take changes is refused.
 * Behaviour: inventory text R@8061041 (Run on shell blocks), ui-map.md 3.3.
 * Test first: a chat command starts the user's login shell with the command in the workspace.
 */
import type { Result } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import { createTestContainer, seedWorkspace, type TestContainer } from "../../test/container.ts";

const must = <T>(result: Result<T>): T => {
	if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
	return result.value;
};

async function readyWorkspace(test: TestContainer) {
	const workspace = await seedWorkspace(test.container);
	await test.container.platform.fs.mkdirp(workspace.path);
	await test.database.execute("UPDATE workspaces SET state = 'ready' WHERE id = $1", [
		workspace.id,
	]);
	await test.container.services.workspace.start();
	return workspace;
}

describe("CHAT-23 run a shell code block through the real container", () => {
	it("starts the command in the user's login shell in the workspace", async () => {
		const test = createTestContainer();
		try {
			const workspace = await readyWorkspace(test);

			const run = must(
				await test.container.services.terminals.runCommand(workspace.id, "echo hello"),
			);

			expect(run).toMatchObject({
				workspaceId: workspace.id,
				kind: "run",
				cwd: workspace.path,
				title: "echo hello",
			});
			expect(test.memory.controls.ptySpawns.at(-1)).toMatchObject({
				cwd: workspace.path,
				command: { program: "/bin/zsh", args: ["-l", "-c", "echo hello"] },
			});
		} finally {
			test.close();
		}
	});

	it("refuses a command with no text and starts nothing", async () => {
		const test = createTestContainer();
		try {
			const workspace = await readyWorkspace(test);

			const run = await test.container.services.terminals.runCommand(workspace.id, "   \n");

			expect(run).toMatchObject({ ok: false, error: { code: "command_empty" } });
			expect(test.memory.controls.ptySpawns).toHaveLength(0);
		} finally {
			test.close();
		}
	});

	it("refuses an archived workspace and starts nothing", async () => {
		const test = createTestContainer();
		try {
			const workspace = await readyWorkspace(test);
			await test.database.execute("UPDATE workspaces SET state = 'archived' WHERE id = $1", [
				workspace.id,
			]);

			const run = await test.container.services.terminals.runCommand(workspace.id, "echo hello");

			expect(run).toMatchObject({ ok: false, error: { code: "workspace_archived" } });
			expect(test.memory.controls.ptySpawns).toHaveLength(0);
		} finally {
			test.close();
		}
	});

	it("does not call a workspace being restored archived", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container);
			await test.database.execute(
				"UPDATE workspaces SET state = 'initializing', archived_at = 6000 WHERE id = $1",
				[workspace.id],
			);

			const run = await test.container.services.terminals.runCommand(workspace.id, "echo hello");

			expect(run).toMatchObject({ ok: false, error: { code: "workspace_not_ready" } });
			expect(test.memory.controls.ptySpawns).toHaveLength(0);
		} finally {
			test.close();
		}
	});

	it("refuses a workspace that is not ready and starts nothing", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container);

			const run = await test.container.services.terminals.runCommand(workspace.id, "echo hello");

			expect(run).toMatchObject({ ok: false, error: { code: "workspace_not_ready" } });
			expect(test.memory.controls.ptySpawns).toHaveLength(0);
		} finally {
			test.close();
		}
	});
});
