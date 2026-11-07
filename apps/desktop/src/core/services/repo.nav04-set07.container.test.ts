// @vitest-environment node
/**
 * @feature NAV-04 Reorder projects
 * @feature SET-07 Change a project's default branch
 * Owns: the composition-root tests that reordering projects and changing a project's default branch
 * run through the real container, its database and its store.
 * Behaviour: ui-map.md 4 (project groups reorder by drag), 6 (Branch new workspaces from).
 * Test first: reordering three projects writes their display order; changing the default branch
 * writes the repos row and the store.
 */
import type { RepoId } from "@conducted/shared";
import { afterEach, describe, expect, it } from "vitest";
import { createTestContainer, seedRepo, type TestContainer } from "../../test/container.ts";

let test: TestContainer | undefined;

afterEach(() => {
	test?.close();
	test = undefined;
});

const displayOrder = async (
	harness: TestContainer,
): Promise<{ id: RepoId; display_order: number }[]> =>
	harness.database.select<{ id: RepoId; display_order: number }>(
		"SELECT id, display_order FROM repos ORDER BY display_order, name, id",
	);

describe("NAV-04 and SET-07 through the real container", () => {
	it("reorders repositories and writes their display order", async () => {
		const harness = createTestContainer();
		test = harness;

		const first = await seedRepo(harness.container);
		const second = await seedRepo(harness.container);
		const third = await seedRepo(harness.container);

		const reordered = await harness.container.actions.projects.reorder([
			third.id,
			first.id,
			second.id,
		]);
		expect(reordered.ok).toBe(true);

		expect((await displayOrder(harness)).map((row) => row.id)).toEqual([
			third.id,
			first.id,
			second.id,
		]);
		expect((await displayOrder(harness)).map((row) => row.display_order)).toEqual([0, 1, 2]);
		expect(harness.container.services.repo.store.getState().order).toEqual([
			third.id,
			first.id,
			second.id,
		]);
		expect(harness.container.services.repo.store.getState().reposById[first.id]?.displayOrder).toBe(
			1,
		);
	});

	it("changes a project's default branch and shows the new branch in the store", async () => {
		const harness = createTestContainer();
		test = harness;

		const repo = await seedRepo(harness.container, { defaultBranch: "main" });

		const changed = await harness.container.actions.projects.setDefaultBranch(repo.id, " develop ");
		expect(changed.ok).toBe(true);

		const rows = await harness.database.select<{ default_branch: string }>(
			"SELECT default_branch FROM repos WHERE id = $1",
			[repo.id],
		);
		expect(rows[0]?.default_branch).toBe("develop");
		expect(harness.container.services.repo.store.getState().reposById[repo.id]?.defaultBranch).toBe(
			"develop",
		);
	});

	it("refuses an empty default branch and leaves the saved one alone", async () => {
		const harness = createTestContainer();
		test = harness;

		const repo = await seedRepo(harness.container, { defaultBranch: "main" });

		const changed = await harness.container.actions.projects.setDefaultBranch(repo.id, "   ");
		expect(changed.ok).toBe(false);

		const rows = await harness.database.select<{ default_branch: string }>(
			"SELECT default_branch FROM repos WHERE id = $1",
			[repo.id],
		);
		expect(rows[0]?.default_branch).toBe("main");
	});
});
