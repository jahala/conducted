// @vitest-environment node
/**
 * @feature PR-12 Catch up a stack branch after GitHub rewrites it
 * Owns: the composition-root test that the catch-up runs from the real container and follows the
 * "Use GitHub stacked PRs" setting.
 * Behaviour: services-map.md 3.8.3, 5B.1.1 (the automatic catch-up, gated by the setting).
 * Test first: with stacked pull requests turned off, the catch-up skips without touching git.
 */
import { describe, expect, it } from "vitest";
import { createTestContainer, seedWorkspace } from "../../test/container.ts";

describe("PR-12 catch-up through the real container", () => {
	it("skips while stacked pull requests are turned off", async () => {
		const harness = createTestContainer();
		try {
			const workspace = await seedWorkspace(harness.container);
			const off = await harness.container.actions.settings.set("github_stacked_prs_enabled", false);
			expect(off.ok).toBe(true);

			const caught = await harness.container.services.github.catchUpStackBranch(
				workspace.id,
				() => false,
			);

			expect(caught).toEqual({ ok: true, value: { kind: "skipped", reason: "not_in_stack" } });
		} finally {
			await harness.container.stop();
			harness.close();
		}
	});
});
