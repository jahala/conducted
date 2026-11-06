// @vitest-environment node
/**
 * @feature PR-08 Stacked PRs: the stack sync through the API
 * Owns: the composition-root test that Actions.pullRequests.syncStack reaches the GitHub service's
 * stack sync in the real container.
 * Behaviour: services-map.md 3.8.2 (gh stack sync, with "Use GitHub stacked PRs" as its switch).
 * Test first: with stacked pull requests turned off in Settings, the action refuses the sync.
 */
import { describe, expect, it } from "vitest";
import { createTestContainer, seedWorkspace } from "../../test/container.ts";

describe("PR-08 stack sync through the real container", () => {
	it("refuses a stack sync while stacked pull requests are turned off", async () => {
		const harness = createTestContainer();
		try {
			const workspace = await seedWorkspace(harness.container);
			const off = await harness.container.actions.settings.set("github_stacked_prs_enabled", false);
			expect(off.ok).toBe(true);

			const synced = await harness.container.actions.pullRequests.syncStack(workspace.id);

			expect(synced.ok).toBe(false);
			if (!synced.ok) expect(synced.error.code).toBe("github_stacks_disabled");
		} finally {
			await harness.container.stop();
			harness.close();
		}
	});
});
