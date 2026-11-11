// @vitest-environment node
/**
 * @feature RUN-01 Run actions with start and stop, concurrent or exclusive
 * Owns: tests over the real container that a workspace terminal records where it lives: one made
 * for the bottom panel keeps that placement, one made for the centre keeps the centre, and a
 * terminal made without a placement is a centre terminal.
 * Behaviour: ui-map.md 3.2 and 3.7 (a terminal tab, and the panel's "New terminal").
 * Test first: a terminal created for the panel is listed with placement "panel".
 */
import type { Result } from "@conducted/shared";
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

describe("RUN-01 a terminal records its placement", () => {
	it("keeps the placement a terminal was created with", async () => {
		const test = createTestContainer();
		try {
			const workspace = await readyWorkspace(test);
			const panel = must(
				await test.container.services.terminals.create(workspace.id, { placement: "panel" }),
			);
			const centre = must(
				await test.container.services.terminals.create(workspace.id, { placement: "centre" }),
			);

			expect(panel.placement).toBe("panel");
			expect(centre.placement).toBe("centre");
			must(await test.container.services.terminals.loadWorkspace(workspace.id));
			const listed = test.container.services.terminals.store.getState().byWorkspace[workspace.id];
			expect(listed?.find((terminal) => terminal.id === panel.id)?.placement).toBe("panel");
			expect(listed?.find((terminal) => terminal.id === centre.id)?.placement).toBe("centre");

			const rows = await test.database.select<{ placement: string }>(
				"SELECT placement FROM terminals WHERE id = $1",
				[panel.id],
			);
			expect(rows).toEqual([{ placement: "panel" }]);
		} finally {
			test.close();
		}
	});

	it("gives a terminal made without a placement the centre", async () => {
		const test = createTestContainer();
		try {
			const workspace = await readyWorkspace(test);
			const terminal = must(await test.container.services.terminals.create(workspace.id));

			expect(terminal.placement).toBe("centre");
		} finally {
			test.close();
		}
	});
});
