/**
 * @feature NAV-04 Pinning a workspace
 * Owns: tests for `workspace.setPinned`: the stored timestamp, the updated store row, and the
 * error for a workspace that is gone.
 * Test first: pinning a seeded workspace sets its pinned time and unpinning clears it.
 */
import type { WorkspaceId } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import { createTestContainer, seedWorkspace } from "../../test/container.ts";

describe("NAV-04 WorkspaceService.setPinned", () => {
	it("pins a workspace and clears it again", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container);
			const service = test.container.services.workspace;
			expect((await service.setPinned(workspace.id, true)).ok).toBe(true);
			expect(service.store.getState().workspacesById[workspace.id]?.pinnedAt).not.toBeNull();
			expect((await service.setPinned(workspace.id, false)).ok).toBe(true);
			expect(service.store.getState().workspacesById[workspace.id]?.pinnedAt).toBeNull();
		} finally {
			test.close();
		}
	});

	it("returns an error for a workspace that no longer exists", async () => {
		const test = createTestContainer();
		try {
			const service = test.container.services.workspace;
			const result = await service.setPinned("missing" as WorkspaceId, true);
			expect(result.ok).toBe(false);
		} finally {
			test.close();
		}
	});
});
