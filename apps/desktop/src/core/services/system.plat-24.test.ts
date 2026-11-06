/**
 * @feature PLAT-24 Full Disk Access check and Privacy pane link
 * Owns: tests for opening the macOS Privacy & Security pane through the service and its action.
 * Test first: a failed open tells the user to grant Full Disk Access under Privacy & Security.
 */
import { describe, expect, it, vi } from "vitest";
import { createTestContainer } from "../../test/container.ts";

describe("PLAT-24 SystemService Full Disk Access", () => {
	it("PLAT-24 opens the macOS Privacy pane through the platform", async () => {
		const test = createTestContainer();
		try {
			const open = vi.spyOn(test.container.platform.system, "openFullDiskAccessSettings");

			const result = await test.container.actions.app.openFullDiskAccessSettings();

			expect(result.ok).toBe(true);
			expect(open).toHaveBeenCalledTimes(1);
		} finally {
			test.close();
		}
	});

	it("PLAT-24 tells the user to grant Full Disk Access by hand when System Settings cannot open", async () => {
		const test = createTestContainer();
		try {
			test.memory.controls.failOpenFullDiskAccessSettings("Launch Services refused the link.");

			const result = await test.container.actions.app.openFullDiskAccessSettings();

			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.error.code).toBe("full_disk_access_settings_unavailable");
			expect(result.error.message).toContain("Privacy & Security");
			expect(result.error.message).toContain("Full Disk Access");
		} finally {
			test.close();
		}
	});
});
