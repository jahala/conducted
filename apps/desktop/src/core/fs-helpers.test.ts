import { describe, expect, it } from "vitest";
import { createMemoryPlatform } from "../platform/memory.ts";
import { unusedDatabase } from "../test/memory-platform.ts";
import { trashIfPresent } from "./fs-helpers.ts";

const platform = () => {
	let next = 0;
	return createMemoryPlatform({
		clock: { now: () => 1_700_000_000_000 },
		ids: { uuid: () => `fs-helpers-${++next}` },
		database: unusedDatabase,
	});
};

describe("trashIfPresent", () => {
	it("returns ok(false) for a missing path and trashes nothing", async () => {
		const memory = platform();
		memory.controls.files.set("/data/keep.json", "{}");
		const result = await trashIfPresent(memory.platform.fs, "/data/gone.json");
		expect(result).toEqual({ ok: true, value: false });
		expect(memory.controls.files.get("/data/keep.json")).toBe("{}");
	});

	it("moves a present file to the Trash and returns ok(true)", async () => {
		const memory = platform();
		memory.controls.files.set("/data/viewed.json", "[]");
		const result = await trashIfPresent(memory.platform.fs, "/data/viewed.json");
		expect(result).toEqual({ ok: true, value: true });
		expect(await memory.platform.fs.exists("/data/viewed.json")).toBe(false);
	});

	it("returns the trash failure when the file goes between the check and the trash", async () => {
		const memory = platform();
		// The file was there when checked and is gone when trashed: the trash error comes back.
		const raced = { exists: async () => true, trash: memory.platform.fs.trash };
		const result = await trashIfPresent(raced, "/data/raced.json");
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("fs_not_found");
	});
});
