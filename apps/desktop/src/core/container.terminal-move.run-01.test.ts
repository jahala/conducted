// @vitest-environment node
/**
 * @feature RUN-01 Run actions with start and stop, concurrent or exclusive
 * Owns: tests over the real container that a workspace terminal moves between the bottom panel and
 * the centre: it keeps its id, its live shell and its scrollback, its stored placement changes, and
 * the app started again over the same database lists it in its new strip. A move to the strip it
 * is already in, a terminal of another workspace, and a script terminal are refused.
 * Behaviour: issue #527; Conductor's moves between its two terminal stores (main bundle `ngn` moves
 * a right-panel terminal to the main panel, `sgn` the other way) keep the terminal's id, and each
 * refuses a terminal of another workspace or one already in the strip it goes to.
 * Test first: a panel terminal moved to the centre keeps its id and shell and reads centre after a restart.
 */
import type { Result, TerminalId, WorkspaceId } from "@conducted/shared";
import { describe, expect, it } from "vitest";
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

/** The placement the store lists for one terminal of a workspace. */
function listedPlacement(test: TestContainer, workspaceId: WorkspaceId, id: TerminalId) {
	const listed = test.container.services.terminals.store.getState().byWorkspace[workspaceId];
	return listed?.find((terminal) => terminal.id === id)?.placement;
}

describe("RUN-01 a terminal moves between the panel and the centre", () => {
	it("a panel terminal moved to the centre keeps its id and shell and reads centre after a restart", async () => {
		const test = createTestContainer();
		let restarted: TestContainer | null = null;
		try {
			const workspace = await readyWorkspace(test);
			const terminals = test.container.services.terminals;
			const terminal = must(await terminals.create(workspace.id, { placement: "panel" }));
			must(await terminals.ensureConnection(terminal.id));
			const connection = terminals.store.getState().connections[terminal.id];
			if (connection?.state !== "ready") throw new Error("The terminal has no live connection.");
			const seen: string[] = [];
			const decoder = new TextDecoder();
			connection.data.onData((chunk) => seen.push(decoder.decode(chunk)));
			must(await connection.data.write("echo before\r"));
			const spawns = test.memory.controls.ptySpawns.length;

			const moved = must(
				await test.container.actions.terminals.move(workspace.id, terminal.id, "centre"),
			);

			expect(moved.id).toBe(terminal.id);
			expect(moved.placement).toBe("centre");
			expect(listedPlacement(test, workspace.id, terminal.id)).toBe("centre");
			// The same shell: nothing was spawned, and the connection the view holds still carries input.
			expect(test.memory.controls.ptySpawns.length).toBe(spawns);
			expect(terminals.store.getState().connections[terminal.id]).toBe(connection);
			must(await connection.data.write("echo after\r"));
			expect(seen.join("")).toBe("echo before\recho after\r");

			// The app started again over the same database lists it in the centre.
			restarted = createTestContainer({ wrapDatabase: () => test.database });
			must(await restarted.container.services.terminals.loadWorkspace(workspace.id));
			expect(listedPlacement(restarted, workspace.id, terminal.id)).toBe("centre");
		} finally {
			restarted?.close();
			test.close();
		}
	});

	it("gives a view mounted after the move the scrollback once, then what arrived in between", async () => {
		const test = createTestContainer();
		try {
			const workspace = await readyWorkspace(test);
			const terminals = test.container.services.terminals;
			const terminal = must(await terminals.create(workspace.id, { placement: "panel" }));
			must(await terminals.ensureConnection(terminal.id));
			const connection = terminals.store.getState().connections[terminal.id];
			if (connection?.state !== "ready") throw new Error("The terminal has no live connection.");
			const decoder = new TextDecoder();
			// The panel's view takes the first output, then unmounts as the terminal leaves.
			const stopPanel = connection.data.onData(() => {});
			must(await connection.data.write("echo before\r"));
			stopPanel();
			must(await connection.data.write("echo between\r"));

			must(await test.container.actions.terminals.move(workspace.id, terminal.id, "centre"));

			// The centre's view replays the scrollback, then takes the output nobody saw yet.
			expect(decoder.decode(connection.data.history)).toBe("echo before\r");
			const live: string[] = [];
			connection.data.onData((chunk) => live.push(decoder.decode(chunk)));
			expect(live).toEqual(["echo between\r"]);
			expect(decoder.decode(connection.data.history)).toBe("echo before\recho between\r");
		} finally {
			test.close();
		}
	});

	it("replays the output of a terminal that ended in this run once, from its saved history", async () => {
		const test = createTestContainer();
		try {
			const workspace = await readyWorkspace(test);
			const terminals = test.container.services.terminals;
			const terminal = must(await terminals.create(workspace.id, { placement: "panel" }));
			const connection = terminals.store.getState().connections[terminal.id];
			if (connection?.state !== "ready") throw new Error("The terminal has no live connection.");
			const stopView = connection.data.onData(() => {});
			must(await connection.data.write("echo once\r"));
			stopView();
			// The shell saves what it printed when it ends; the next view reads that once.
			must(await terminals.end(terminal.id));

			must(await terminals.ensureConnection(terminal.id));

			expect(new TextDecoder().decode(connection.data.history)).toBe("echo once\r");
		} finally {
			test.close();
		}
	});

	it("keeps no more output for a later view than the scrollback limit", async () => {
		const test = createTestContainer();
		try {
			const workspace = await readyWorkspace(test);
			must(
				await test.container.services.settings.set("terminal_scrollback_limit_bytes", 1_000_000),
			);
			const terminals = test.container.services.terminals;
			const terminal = must(await terminals.create(workspace.id, { placement: "panel" }));
			must(await terminals.ensureConnection(terminal.id));
			const connection = terminals.store.getState().connections[terminal.id];
			if (connection?.state !== "ready") throw new Error("The terminal has no live connection.");
			connection.data.onData(() => {});

			must(await connection.data.write("a".repeat(600_000)));
			must(await connection.data.write("b".repeat(600_000)));

			expect(new TextDecoder().decode(connection.data.history)).toBe("b".repeat(600_000));
		} finally {
			test.close();
		}
	});

	it("a centre terminal moved to the panel reads panel in the store and the database", async () => {
		const test = createTestContainer();
		try {
			const workspace = await readyWorkspace(test);
			const terminal = must(await test.container.services.terminals.create(workspace.id));

			must(await test.container.actions.terminals.move(workspace.id, terminal.id, "panel"));

			expect(listedPlacement(test, workspace.id, terminal.id)).toBe("panel");
			const rows = await test.database.select<{ placement: string }>(
				"SELECT placement FROM terminals WHERE id = $1",
				[terminal.id],
			);
			expect(rows).toEqual([{ placement: "panel" }]);
		} finally {
			test.close();
		}
	});

	it("refuses a move to the strip the terminal is already in, and changes nothing", async () => {
		const test = createTestContainer();
		try {
			const workspace = await readyWorkspace(test);
			const terminal = must(
				await test.container.services.terminals.create(workspace.id, { placement: "panel" }),
			);

			const moved = await test.container.actions.terminals.move(workspace.id, terminal.id, "panel");

			expect(moved).toMatchObject({ ok: false, error: { code: "terminal_already_there" } });
			expect(listedPlacement(test, workspace.id, terminal.id)).toBe("panel");
		} finally {
			test.close();
		}
	});

	it("refuses a terminal of another workspace and a terminal that does not exist", async () => {
		const test = createTestContainer();
		try {
			const workspace = await readyWorkspace(test);
			const other = await seedWorkspace(test.container);
			const terminal = must(await test.container.services.terminals.create(workspace.id));

			const elsewhere = await test.container.actions.terminals.move(other.id, terminal.id, "panel");
			const missing = await test.container.actions.terminals.move(
				workspace.id,
				"no-such-terminal" as TerminalId,
				"panel",
			);

			expect(elsewhere).toMatchObject({ ok: false, error: { code: "terminal_not_in_workspace" } });
			expect(missing).toMatchObject({ ok: false, error: { code: "terminal_not_in_workspace" } });
			expect(listedPlacement(test, workspace.id, terminal.id)).toBe("centre");
		} finally {
			test.close();
		}
	});

	it("refuses a script terminal, whose tab is the Run or Setup tab", async () => {
		const test = createTestContainer();
		try {
			const workspace = await readyWorkspace(test);
			test.memory.controls.holdNextPty();
			const run = must(
				await test.container.services.terminals.runScript({
					workspaceId: workspace.id,
					kind: "run",
					title: "Run",
					command: "sleep 60",
					cwd: workspace.path,
					env: {},
				}),
			);

			const moved = await test.container.actions.terminals.move(
				workspace.id,
				run.terminalId,
				"centre",
			);

			expect(moved).toMatchObject({ ok: false, error: { code: "terminal_not_in_workspace" } });
			must(await test.container.services.terminals.stop(run.terminalId));
		} finally {
			test.close();
		}
	});
});
