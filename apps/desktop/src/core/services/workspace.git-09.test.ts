/**
 * @feature GIT-09 Rename the branch
 * Owns: tests for saving a renamed branch in the workspace row and its in-memory store.
 * Test first: a saved rename updates the branch shown for that workspace.
 */
import type { WorkspaceId } from "@conducted/shared";
import { afterEach, describe, expect, it } from "vitest";
import { createTestContainer, seedWorkspace, type TestContainer } from "../../test/container.ts";

let test: TestContainer | null = null;

afterEach(async () => {
	await test?.container.stop();
	test?.close();
	test = null;
});

describe("GIT-09 WorkspaceService.applyBranchRename", () => {
	it("saves the new branch and clears the placeholder flag", async () => {
		test = createTestContainer();
		const workspace = await seedWorkspace(test.container, {
			branch: "placeholder-name",
			branchIsPlaceholder: true,
		});

		const result = await test.container.services.workspace.applyBranchRename(
			workspace.id,
			"fix-login",
		);

		expect(result.ok).toBe(true);
		const saved = test.container.services.workspace.store.getState().workspacesById[workspace.id];
		expect(saved?.branch).toBe("fix-login");
		expect(saved?.branchIsPlaceholder).toBe(false);
	});

	it("returns an error for a workspace that no longer exists", async () => {
		test = createTestContainer();
		const result = await test.container.services.workspace.applyBranchRename(
			"missing-workspace" as WorkspaceId,
			"fix-login",
		);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.code).toBe("workspace_unknown");
	});
});
