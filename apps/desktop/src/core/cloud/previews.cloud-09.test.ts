// @vitest-environment node
/**
 * @feature CLOUD-09 Cloud terminals, run scripts and previews
 * Tests the desktop's preview door: it asks the Worker for one port's shareable URL and refuses a
 * port that cannot be shared.
 */
import type { Host } from "@conducted/protocol";
import { ok } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import { cloudMemoryPlatform } from "../../test/memory-platform.ts";
import { previewUrlFor } from "./previews.ts";

const HOST: Extract<Host, { kind: "cloud" }> = {
	kind: "cloud",
	url: "https://conducted.example.workers.dev",
	vmId: "oslo",
};

describe("CLOUD-09 preview URLs", () => {
	it("asks the Worker for one port's URL", async () => {
		const memory = cloudMemoryPlatform();
		try {
			const url = "https://conducted.example.workers.dev/w/oslo/preview/token/3000/";
			memory.controls.scriptCloud((request) =>
				request.path === "/w/oslo/preview-url" && (request.body as { port?: number }).port === 3000
					? ok({ status: 200, body: JSON.stringify({ url }) })
					: null,
			);
			const result = await previewUrlFor(memory.platform.cloud, HOST, 3000);
			expect(result).toEqual(ok(url));
		} finally {
			memory.controls.dispose();
		}
	});

	it("refuses a port that cannot be shared", async () => {
		const memory = cloudMemoryPlatform();
		try {
			expect((await previewUrlFor(memory.platform.cloud, HOST, 22)).ok).toBe(false);
			expect((await previewUrlFor(memory.platform.cloud, HOST, 0)).ok).toBe(false);
			expect((await previewUrlFor(memory.platform.cloud, HOST, 70_000)).ok).toBe(false);
			expect(memory.controls.cloudRequests).toHaveLength(0);
		} finally {
			memory.controls.dispose();
		}
	});

	it("reports what the Worker said when it refuses", async () => {
		const memory = cloudMemoryPlatform();
		try {
			memory.controls.scriptCloud(() =>
				ok({ status: 400, body: JSON.stringify({ error: "Bad preview port" }) }),
			);
			const result = await previewUrlFor(memory.platform.cloud, HOST, 3000);
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.error.message).toBe("Bad preview port");
		} finally {
			memory.controls.dispose();
		}
	});
});
