/**
 * @feature CLOUD-03 The user's Worker and one Durable Object per workspace: routes, state, keep-alive, relay
 * Tests that the echo Worker the Rust relay integration test runs (`src/test-relay.ts`) is reachable
 * only from the end-to-end config (`wrangler.e2e.jsonc`), never from the config the user deploys
 * (`wrangler.jsonc`). The test starts the local runtime from that e2e config, so a test-only entry
 * that leaked into the deployed Worker would be a route in production.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "../..");
const read = (name: string): string => readFileSync(join(root, "apps/cloud", name), "utf8");

describe("CLOUD-03 the relay test's Worker stays out of production", () => {
	test("the deployed config points at the real Worker and names no test entry", () => {
		const production = read("wrangler.jsonc");
		expect(production).toContain('"main": "src/index.ts"');
		expect(production).not.toContain("test-relay");
		expect(production).not.toContain("EchoWorkspace");
	});

	test("the deployed Worker imports no test entry", () => {
		expect(read("src/index.ts")).not.toContain("test-relay");
	});

	test("the e2e config points at the echo Worker and needs no container", () => {
		const e2e = read("wrangler.e2e.jsonc");
		expect(e2e).toContain('"main": "src/test-relay.ts"');
		expect(e2e).toContain("EchoWorkspace");
		expect(e2e).not.toContain('"containers"');
	});
});
