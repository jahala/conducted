/**
 * @feature SIDE-25 Sidecar adapters in their own edge modules
 * Owns: tests for the file edge against the real file system in a folder each test makes and
 * removes.
 * Test first: the startup folder check accepts a writable outbox and refuses a read-only one.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createFilesAdapters, nodeFileSystem } from "./files.ts";

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function tempFolder(prefix = "conducted-files-adapter-"): Promise<string> {
	const folder = await mkdtemp(path.join(tmpdir(), prefix));
	cleanups.push(() => rm(folder, { recursive: true, force: true }));
	return folder;
}

function adapters(tempRoot: string, fallbackPath: string | undefined = undefined) {
	return createFilesAdapters({
		fs: nodeFileSystem,
		tempRoot,
		pid: () => process.pid,
		fallbackPath,
	});
}

describe("SIDE-25 file edge", () => {
	test("SIDE-25 the startup folder check accepts a writable outbox", async () => {
		const root = await tempFolder();
		const binDir = path.join(root, "bin");
		const outboxRoot = path.join(root, "outbox");
		await mkdir(binDir, { recursive: true });
		const files = adapters(root);
		expect(await files.preflight({ binDir, outboxRoot })).toEqual({
			ok: true,
			value: undefined,
		});
	});

	test("SIDE-25 the startup folder check refuses a missing bin folder and names it", async () => {
		const root = await tempFolder();
		const binDir = path.join(root, "no-bin");
		const files = adapters(root);
		const result = await files.preflight({ binDir, outboxRoot: path.join(root, "outbox") });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("bin_dir_missing");
			expect(result.error.message).toContain(binDir);
		}
	});

	test("SIDE-25 the startup folder check refuses a read-only outbox folder", async () => {
		const root = await tempFolder();
		const binDir = path.join(root, "bin");
		const outboxRoot = path.join(root, "outbox");
		await mkdir(binDir, { recursive: true });
		await mkdir(outboxRoot, { recursive: true });
		await chmod(outboxRoot, 0o500);
		try {
			const result = await adapters(root).preflight({ binDir, outboxRoot });
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.code).toBe("folder_not_writable");
				expect(result.error.message).toContain(outboxRoot);
			}
		} finally {
			await chmod(outboxRoot, 0o700);
		}
	});

	test("SIDE-25 the prompt file port reads a file's size and text", async () => {
		const root = await tempFolder();
		const target = path.join(root, "note.md");
		await writeFile(target, "hello", "utf8");
		const files = adapters(root).promptFiles;
		expect(await files.size(target)).toBe(5);
		expect(await files.readText(target)).toEqual({ ok: true, value: "hello" });
	});

	test("SIDE-25 the prompt file port reports a missing file as no size and an error", async () => {
		const root = await tempFolder();
		const target = path.join(root, "gone.md");
		const files = adapters(root).promptFiles;
		expect(await files.size(target)).toBeNull();
		const read = await files.readText(target);
		expect(read.ok).toBe(false);
		if (!read.ok) expect(read.error.message).toContain(target);
	});

	test("SIDE-25 makeTempDir makes a real folder inside the temp root", async () => {
		const root = await tempFolder();
		const made = await adapters(root).makeTempDir("made-");
		expect(made.startsWith(root)).toBe(true);
		expect((await stat(made)).isDirectory()).toBe(true);
	});

	test("SIDE-25 realPath resolves a real path and reports a missing one as null", async () => {
		const root = await tempFolder();
		const target = path.join(root, "note.md");
		await writeFile(target, "hello", "utf8");
		const files = adapters(root);
		const resolved = await files.realPath(target);
		expect(resolved === null ? null : path.basename(resolved)).toBe("note.md");
		expect(await files.realPath(path.join(root, "gone"))).toBeNull();
	});

	test("SIDE-25 findExecutable finds a real executable on a PATH", async () => {
		const root = await tempFolder();
		const target = path.join(root, "tool");
		await writeFile(target, "#!/bin/sh\nexit 0\n", "utf8");
		await chmod(target, 0o755);
		const files = adapters(root, root);
		expect(await files.findExecutable("tool", { PATH: root })).toBe(target);
		expect(await files.findExecutable("tool", {})).toBe(target);
	});

	test("SIDE-25 findExecutable takes a name with a slash as a path and refuses a missing one", async () => {
		const root = await tempFolder();
		const target = path.join(root, "tool");
		await writeFile(target, "#!/bin/sh\nexit 0\n", "utf8");
		await chmod(target, 0o755);
		const files = adapters(root);
		expect(await files.findExecutable(target, {})).toBe(target);
		expect(await files.findExecutable(path.join(root, "gone"), {})).toBeNull();
	});
});
