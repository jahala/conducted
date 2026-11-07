// @vitest-environment node
/**
 * @feature REV-05 AI code review in a new chat
 * Owns: the composition-root test that the review model's agent and model reach a review chat.
 * Behaviour: ui-map.md 3.6 ("Review" starts a new chat); SET-02 stores the agent with the model.
 * Test first: a review chat starts with the agent, model and effort the settings hold, through the
 * actions the app mounts.
 */
import { ok } from "@conducted/shared";
import { describe, expect, it, vi } from "vitest";
import { createTestContainer, seedWorkspace } from "../test/container.ts";

describe("REV-05 review chat through the container", () => {
	it("starts with the review agent, model and effort from settings", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container);
			for (const [key, value] of [
				["review_agent", "codex"],
				["review_model", "gpt-5"],
				["review_codex_thinking_level", "low"],
			] as const) {
				expect(await test.container.actions.settings.set(key, value)).toEqual(ok(undefined));
			}
			// The sidecar is not running in this test; the send is the seam, and the config is
			// what the review chat starts with.
			vi.spyOn(test.container.services.sessions, "send").mockResolvedValue(ok(undefined));

			const started = await test.container.actions.pullRequests.requestAiReview(workspace.id, null);

			expect(started.ok).toBe(true);
			if (!started.ok) return;
			expect(started.value.config.agent).toBe("codex");
			expect(started.value.config.acpAgent).toBeUndefined();
			expect(started.value.config).toMatchObject({ model: "gpt-5", effort: "low" });
		} finally {
			await test.container.stop();
			test.close();
		}
	});
});
