/**
 * @feature NAV-10 Closing a terminal tab; RUN-07 Terminals
 * Owns: tests over the real container that closing a terminal tab removes the terminal, while ending
 * a script terminal keeps its row.
 * Behaviour: ui-map.md 3.2 ("Terminal N" tabs with "Close terminal N"); Conductor's tab close destroys
 * the terminal and clears its saved screen (services-map.md 5A.4.7 `clear`).
 * Test first: closing one of two terminals leaves only the other, in the store and in the database.
 */
import type { Result, WorkspaceId } from "@conducted/shared";
import { afterEach, describe, expect, it } from "vitest";
import { createTestContainer, seedWorkspace, type TestContainer } from "../../test/container.ts";

const must = <T>(result: Result<T>): T => {
	if (!result.ok) throw new Error(result.error.message);
	return result.value;
};

let open: TestContainer | null = null;

afterEach(async () => {
	if (open !== null) {
		await open.container.stop();
		open.close();
		open = null;
	}
});

async function readyWorkspace(): Promise<{ test: TestContainer; workspaceId: WorkspaceId }> {
	const test = createTestContainer();
	open = test;
	const seeded = await seedWorkspace(test.container);
	await test.container.platform.fs.mkdirp(seeded.path);
	await test.database.execute("UPDATE workspaces SET state = 'ready' WHERE id = $1", [seeded.id]);
	return { test, workspaceId: seeded.id as WorkspaceId };
}

const rowIds = async (test: TestContainer, workspaceId: WorkspaceId): Promise<string[]> =>
	(
		await test.database.select<{ id: string }>(
			"SELECT id FROM terminals WHERE workspace_id = $1 ORDER BY started_at, id",
			[workspaceId],
		)
	).map((row) => row.id);

describe("NAV-10 closing a terminal tab", () => {
	it("removes the closed terminal from the store and the database and keeps the other", async () => {
		const { test, workspaceId } = await readyWorkspace();
		const terminals = test.container.services.terminals;
		const first = must(await terminals.create(workspaceId));
		const second = must(await terminals.create(workspaceId));

		must(await test.container.actions.terminals.close(first.id));

		const listed = terminals.store.getState().byWorkspace[workspaceId] ?? [];
		expect(listed.map((terminal) => terminal.id)).toEqual([second.id]);
		expect(await rowIds(test, workspaceId)).toEqual([second.id]);
		// A fresh read agrees: the tab does not come back when the strip reloads.
		must(await terminals.loadWorkspace(workspaceId));
		const reloaded = terminals.store.getState().byWorkspace[workspaceId] ?? [];
		expect(reloaded.map((terminal) => terminal.id)).toEqual([second.id]);
		expect(terminals.store.getState().connections[first.id]).toBeUndefined();
	});

	it("keeps a terminal that ends without its tab closing, so the tab can start a new shell", async () => {
		const { test, workspaceId } = await readyWorkspace();
		const terminals = test.container.services.terminals;
		const created = must(await terminals.create(workspaceId));

		must(await terminals.end(created.id));

		expect(await rowIds(test, workspaceId)).toEqual([created.id]);
		const listed = terminals.store.getState().byWorkspace[workspaceId] ?? [];
		expect(listed[0]?.endedAt).not.toBeNull();
		must(await terminals.restart(created.id));
	});
});
