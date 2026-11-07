/**
 * @feature CLOUD-08 Deploy flow for the user's Cloudflare account
 * Tests the deploy inputs' facts: they come from the Worker's own config, the bundling config has
 * no containers (so a dry run never builds the image), and a config missing a resource is refused.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bundlingConfig, readDeployFacts } from "./prepare-deploy.ts";

const root = join(import.meta.dir, "../..");
const config = readFileSync(join(root, "apps/cloud/wrangler.jsonc"), "utf8");

describe("CLOUD-08 the deploy inputs", () => {
	test("the facts come from the Worker's own config", () => {
		expect(readDeployFacts(config)).toEqual({
			name: "conducted-cloud",
			compatibilityDate: "2026-11-06",
			compatibilityFlags: ["nodejs_compat"],
			instance: "basic",
			className: "Workspace",
			imageKey: "sandbox",
			objectBinding: "WORKSPACE",
			backupBinding: "BACKUPS",
		});
	});

	test("the bundling config has no containers, so the dry run builds no image", () => {
		const bundled = bundlingConfig(readDeployFacts(config), "/repo/apps/cloud/src/index.ts");
		expect(bundled).not.toHaveProperty("containers");
		expect(bundled).toMatchObject({
			name: "conducted-cloud",
			main: "/repo/apps/cloud/src/index.ts",
			compatibility_date: "2026-11-06",
			compatibility_flags: ["nodejs_compat"],
			exports: { Workspace: { type: "durable-object", storage: "sqlite" } },
		});
	});

	test("a config with no bucket is refused by name", () => {
		expect(() =>
			readDeployFacts(
				'{"name":"x","compatibility_date":"2026-11-06","vars":{"INSTANCE_TYPE":"basic"},"containers":[{"class_name":"W","images":{"sandbox":{}}}],"durable_objects":{"bindings":[{"name":"W"}]}}',
			),
		).toThrow("r2_buckets[0].binding");
	});
});
