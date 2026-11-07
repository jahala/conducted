// @vitest-environment node
/**
 * @feature CLOUD-08 Deploy flow for the user's Cloudflare account
 * Owns: the proof that the Worker's own `wrangler.jsonc` names the three resources a deploy makes,
 * that the JSONC reader keeps every string (a URL is one), and that the deploy and uninstall calls
 * carry those names to the shell's door.
 * Test first: a comment that holds a URL is not cut, and a config with no bucket name is refused.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ok } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import { createCloudDeploy, parseDeployManifest, stripJsonc } from "./deploy.ts";

const REPO_CLOUD_CONFIG = fileURLToPath(
	new URL("../../../../../apps/cloud/wrangler.jsonc", import.meta.url),
);

describe("CLOUD-08 the Worker's names", () => {
	it("reads the real Worker config's names", () => {
		const manifest = parseDeployManifest(readFileSync(REPO_CLOUD_CONFIG, "utf8"));
		expect(manifest.ok).toBe(true);
		if (!manifest.ok) return;
		expect(manifest.value).toEqual({
			workerName: "conducted-cloud",
			bucketName: "conducted-cloud-backups",
			containerApp: "conducted-cloud-sandbox",
		});
	});

	it("keeps a URL inside a string while it removes comments and trailing commas", () => {
		const text = `{
			// a comment
			"$schema": "https://example.test/schema.json",
			"name": "conducted-cloud", /* block */
			"list": [1, 2,],
		}`;
		expect(JSON.parse(stripJsonc(text))).toEqual({
			$schema: "https://example.test/schema.json",
			name: "conducted-cloud",
			list: [1, 2],
		});
	});

	it("refuses a config that does not name every resource", () => {
		const missing = parseDeployManifest('{"name":"conducted-cloud","containers":[{"name":"x"}]}');
		expect(missing.ok).toBe(false);
		if (missing.ok) return;
		expect(missing.error.message).toContain("r2_buckets[0].bucket_name");
	});
});

describe("CLOUD-08 the deploy service", () => {
	const manifestText = JSON.stringify({
		name: "conducted-cloud",
		containers: [{ name: "conducted-cloud-sandbox" }],
		r2_buckets: [{ binding: "BACKUPS", bucket_name: "conducted-cloud-backups" }],
	});

	it("reads the config from the chosen folder and deploys with its names", async () => {
		const calls: unknown[] = [];
		const service = createCloudDeploy({
			fs: {
				readText: async (path) => {
					calls.push(path);
					return ok(manifestText);
				},
			},
			cloud: {
				deploy: async (input) => {
					calls.push(input);
					return ok({ url: "https://conducted-cloud.example.workers.dev" });
				},
				uninstall: async () => ok(undefined),
			},
		});
		const result = await service.deploy("/repo/apps/cloud/");
		expect(result.ok && result.value.url).toBe("https://conducted-cloud.example.workers.dev");
		expect(calls).toEqual([
			"/repo/apps/cloud/wrangler.jsonc",
			{
				sourceDir: "/repo/apps/cloud",
				workerName: "conducted-cloud",
				bucketName: "conducted-cloud-backups",
				containerApp: "conducted-cloud-sandbox",
			},
		]);
	});

	it("refuses a folder with no Worker config before it asks the shell anything", async () => {
		let deployed = false;
		const service = createCloudDeploy({
			fs: {
				readText: async () => ({
					ok: false,
					error: { code: "fs_not_found", message: "No such file." },
				}),
			},
			cloud: {
				deploy: async () => {
					deployed = true;
					return ok({ url: "" });
				},
				uninstall: async () => ok(undefined),
			},
		});
		const result = await service.deploy("/repo/apps/cloud");
		expect(result.ok).toBe(false);
		expect(deployed).toBe(false);
	});
});
