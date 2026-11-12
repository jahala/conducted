import { ok } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import { createMemoryPlatform } from "../platform/memory.ts";
import { unusedDatabase } from "../test/memory-platform.ts";
import { copyFileKeepingMode, trashIfPresent } from "./fs-helpers.ts";

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
		expect(await memory.platform.fs.exists("/data/viewed.json")).toEqual(ok(false));
	});

	it("returns the trash failure when the file goes between the check and the trash", async () => {
		const memory = platform();
		// The file was there when checked and is gone when trashed: the trash error comes back.
		const raced = { exists: async () => ok(true), trash: memory.platform.fs.trash };
		const result = await trashIfPresent(raced, "/data/raced.json");
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("fs_not_found");
	});
});

describe("copyFileKeepingMode", () => {
	it("runs cp -p from the target's folder", async () => {
		const memory = platform();
		memory.controls.scriptShell((command) =>
			command.program === "cp" ? ok({ exitCode: 0, stdout: "", stderr: "" }) : null,
		);

		const result = await copyFileKeepingMode(memory.platform.shell, "/from/a.txt", "/to/dir/a.txt");

		expect(result).toEqual({ ok: true, value: undefined });
		expect(memory.controls.shellCalls).toEqual([
			{ program: "cp", args: ["-p", "/from/a.txt", "/to/dir/a.txt"], cwd: "/to/dir" },
		]);
	});

	it("returns file_copy_failed with cp's message when cp exits non-zero", async () => {
		const memory = platform();
		memory.controls.scriptShell((command) =>
			command.program === "cp"
				? ok({ exitCode: 1, stdout: "", stderr: "cp: /from/a.txt: Permission denied\n" })
				: null,
		);

		const result = await copyFileKeepingMode(memory.platform.shell, "/from/a.txt", "/to/a.txt");

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("file_copy_failed");
			expect(result.error.message).toBe("cp: /from/a.txt: Permission denied");
		}
	});

	it("passes on the shell's own error when cp cannot run", async () => {
		const memory = platform();

		const result = await copyFileKeepingMode(memory.platform.shell, "/from/a.txt", "/to/a.txt");

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("shell_unscripted");
	});
});
