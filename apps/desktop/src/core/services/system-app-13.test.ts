import { describe, expect, it, vi } from "vitest";
import { SystemService, type SystemServiceDeps } from "./system.ts";

function serviceWithClipboard(writeText: (text: string) => Promise<void>): SystemService {
	return new SystemService({
		platform: {
			clipboard: { writeText, writeImage: async () => {} },
		} as unknown as SystemServiceDeps["platform"],
		setting: (() => undefined) as unknown as SystemServiceDeps["setting"],
		now: () => 0,
	});
}

describe("APP-13 SystemService copyText", () => {
	it("writes the text to the clipboard", async () => {
		const writeText = vi.fn(async () => {});
		const result = await serviceWithClipboard(writeText).copyText("git status");

		expect(result.ok).toBe(true);
		expect(writeText).toHaveBeenCalledWith("git status");
	});

	it("reports a clipboard that refuses the write", async () => {
		const result = await serviceWithClipboard(async () => {
			throw new Error("denied");
		}).copyText("secret");

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("clipboard_write_failed");
			expect(result.error.message).toBe("Could not copy to the clipboard.");
		}
	});
});
