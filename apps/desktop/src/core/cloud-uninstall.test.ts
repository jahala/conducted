/**
 * @feature CLOUD-08 Deploy flow for the user's Cloudflare account
 * Tests the sentence Remove deployment ends with: it names what the shell removed, the bucket's
 * files with their count (issue #635), and nothing the shell did not count.
 * Test first: names the bucket's files with their count.
 */
import { describe, expect, it } from "vitest";
import { uninstallSummary } from "./cloud-uninstall.ts";

describe("CLOUD-08 what Remove deployment says it removed", () => {
	it("names the bucket's files with their count", () => {
		expect(
			uninstallSummary({ worker: true, container: true, images: 2, bucket: true, objects: 4 }),
		).toBe(
			"Removed the Worker, the container application, 2 images and the bucket with the 4 files it held from your Cloudflare account",
		);
	});

	it("reads in the singular for one image and one file", () => {
		expect(
			uninstallSummary({ worker: true, container: true, images: 1, bucket: true, objects: 1 }),
		).toBe(
			"Removed the Worker, the container application, 1 image and the bucket with the 1 file it held from your Cloudflare account",
		);
	});

	it("names only what was there", () => {
		expect(
			uninstallSummary({ worker: false, container: false, images: 0, bucket: true, objects: 0 }),
		).toBe("Removed the empty bucket from your Cloudflare account");
		expect(
			uninstallSummary({ worker: false, container: false, images: 0, bucket: false, objects: 0 }),
		).toBe("Nothing was left on your Cloudflare account to remove");
	});
});
