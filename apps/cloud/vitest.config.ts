/**
 * @feature CLOUD-03 The user's Worker and one Durable Object per workspace: routes, state, keep-alive, relay
 * Runs the tests inside Cloudflare's own local runtime (workerd), never a stand-in for it.
 * The test configuration has no container: building the sandbox image needs Docker and belongs to
 * the live run, so the tests cover the Worker's front door, the Durable Object's state and alarm,
 * and the turn-state reading. See docs/decisions.md D101.
 */
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [
		cloudflareTest({
			wrangler: { configPath: "./wrangler.test.jsonc" },
			miniflare: {
				bindings: {
					PAIRING_TOKEN: "test-pairing-token",
					ANTHROPIC_API_KEY: "",
				},
			},
		}),
	],
});
