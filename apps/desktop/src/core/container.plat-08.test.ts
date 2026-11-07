/**
 * @feature PLAT-08 Saved terminal scrollback: the limit from settings, and a save that failed
 * Owns: tests over the real container that a terminal starts with the scrollback limit the
 * Advanced setting holds, and that a history the shell could not save is kept as the terminal's
 * error.
 * Test first: a new terminal is spawned with the setting's scrollback limit.
 */
// @vitest-environment node
import type { Result } from "@conducted/shared";
import { describe, expect, it, vi } from "vitest";
import { createTestContainer, seedWorkspace, type TestContainer } from "../test/container.ts";

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

describe("PLAT-08 terminal scrollback", () => {
	it("starts a terminal with the scrollback limit from settings", async () => {
		const test = createTestContainer();
		try {
			const workspace = await readyWorkspace(test);
			must(
				await test.container.services.settings.set("terminal_scrollback_limit_bytes", 2_000_000),
			);
			const spawn = vi.spyOn(test.container.platform.pty, "spawn");

			must(await test.container.services.terminals.create(workspace.id));

			expect(spawn.mock.calls[0]?.[0].scrollbackLimitBytes).toBe(2_000_000);
		} finally {
			test.close();
		}
	});

	it("a reopened ended terminal replays its saved history", async () => {
		const test = createTestContainer();
		try {
			const workspace = await readyWorkspace(test);
			const terminal = must(await test.container.services.terminals.create(workspace.id));
			must(await test.container.services.terminals.end(terminal.id));
			// The text a previous app run left for the same terminal row.
			test.memory.controls.seedPtyHistory(terminal.id, "previous run output\r\n");

			must(await test.container.services.terminals.ensureConnection(terminal.id));

			const connection =
				test.container.services.terminals.store.getState().connections[terminal.id];
			if (connection?.state !== "ready") throw new Error("the connection is not ready");
			expect(new TextDecoder().decode(connection.data.history)).toBe("previous run output\r\n");
		} finally {
			test.close();
		}
	});

	it("keeps a history the shell could not save as the terminal's error", async () => {
		const test = createTestContainer();
		try {
			const workspace = await readyWorkspace(test);
			test.memory.controls.failPtyHistory("The disk is full.");
			const terminal = must(await test.container.services.terminals.create(workspace.id));

			// The terminal ends and stays (as a script terminal does); a closed tab's terminal is
			// removed with its errors (NAV-10), so there is nothing left to show the error on.
			must(await test.container.services.terminals.end(terminal.id));

			await vi.waitFor(() =>
				expect(
					test.container.services.terminals.store.getState().errors[`t:${terminal.id}`]?.message,
				).toBe("The disk is full."),
			);
		} finally {
			test.close();
		}
	});
});
