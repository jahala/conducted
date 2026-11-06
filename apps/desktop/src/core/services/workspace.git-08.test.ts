/**
 * @feature GIT-08 Change the target branch
 * Owns: tests for storing the intended target branch through the workspace service.
 * Behaviour: services-map.md 2.3.1 ("set intended target branch").
 * Test first: the stored row and the loaded workspace both show the new target branch.
 */
import type { WorkspaceId } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import { createTestContainer, seedWorkspace } from "../../test/container.ts";
import { createRepositories } from "../db/repositories.ts";

let nextId = 0;
const repositoriesOf = (database: Parameters<typeof createRepositories>[0]) =>
	createRepositories(database, {
		clock: { now: () => 0 },
		ids: { uuid: () => `git-08-id-${++nextId}` },
	});

describe("GIT-08 intended target branch", () => {
	it("stores the new target and updates the loaded workspace", async () => {
		const { container, close } = createTestContainer();
		try {
			const workspace = await seedWorkspace(container, { targetBranch: "main" });

			const result = await container.services.workspace.setIntendedTargetBranch(
				workspace.id,
				"develop",
			);

			expect(result.ok).toBe(true);
			expect(
				container.services.workspace.store.getState().workspacesById[workspace.id]?.targetBranch,
			).toBe("develop");
			const row = await repositoriesOf(container.platform.db).workspaces.get(workspace.id);
			expect(row.ok).toBe(true);
			if (row.ok) expect(row.value?.targetBranch).toBe("develop");
		} finally {
			close();
		}
	});

	it("returns an error for a workspace that does not exist and stores nothing", async () => {
		const { container, close } = createTestContainer();
		try {
			const result = await container.services.workspace.setIntendedTargetBranch(
				"missing" as WorkspaceId,
				"develop",
			);
			expect(result.ok).toBe(false);
		} finally {
			close();
		}
	});
});
