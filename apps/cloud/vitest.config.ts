/**
 * @feature CLOUD-03 The user's Worker and one Durable Object per workspace: routes, state, keep-alive, relay
 * Runs the tests inside Cloudflare's own local runtime (workerd), never a stand-in for it.
 * The test configuration has no container: building the sandbox image needs Docker and belongs to
 * the live run, so the tests cover the Worker's front door, the Durable Object's state and alarm,
 * and the turn-state reading. See docs/decisions.md D101.
 */
import { join } from "node:path";
import process from "node:process";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { configDefaults, defineConfig } from "vitest/config";

// CI names a folder here, and the run also writes a JUnit report into it, so
// scripts/test-report.ts can list every failed test by file (ci.yml).
const reports = process.env.CONDUCTED_TEST_REPORTS;

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
	test: reports
		? {
				reporters: [
					...configDefaults.reporters,
					["junit", { outputFile: join(reports, "cloud.xml") }],
				],
			}
		: {},
});
