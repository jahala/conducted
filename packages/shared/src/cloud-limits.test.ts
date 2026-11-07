/**
 * @feature CLOUD-11 Local mirror and file sync for a cloud workspace
 * Tests the one cloud read limit both the mirror and the Worker ask about.
 * Test first: a file at the limit passes and one byte more is refused.
 */
import { describe, expect, test } from "bun:test";
import {
	CLOUD_MIRROR_FILE_LIMIT_BYTES,
	cloudReadLimitMessage,
	withinCloudReadLimit,
} from "./cloud-limits.ts";

describe("CLOUD-11 the cloud read limit", () => {
	test("passes a file at the limit and refuses one byte more", () => {
		expect(withinCloudReadLimit(CLOUD_MIRROR_FILE_LIMIT_BYTES)).toBe(true);
		expect(withinCloudReadLimit(CLOUD_MIRROR_FILE_LIMIT_BYTES + 1)).toBe(false);
		expect(withinCloudReadLimit(-1)).toBe(false);
	});

	test("names the size and the limit in its message", () => {
		expect(cloudReadLimitMessage(CLOUD_MIRROR_FILE_LIMIT_BYTES + 1)).toContain(
			String(CLOUD_MIRROR_FILE_LIMIT_BYTES + 1),
		);
		expect(cloudReadLimitMessage(CLOUD_MIRROR_FILE_LIMIT_BYTES + 1)).toContain(
			String(CLOUD_MIRROR_FILE_LIMIT_BYTES),
		);
	});
});
