/**
 * Tests the end-to-end harness's parts that need no app: the leftover check that fails a run, the
 * environment the app starts with, and the next value a number control moves to.
 */
import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nextNumber } from "./controls.ts";
import { appEnvironment, cleanUp, type FreshFolder, newTracker } from "./harness.ts";

const folderAt = (root: string): FreshFolder => ({
	root,
	home: join(root, "home"),
	tmp: join(root, "tmp"),
	exe: join(root, "Conducted.app/Contents/MacOS/conducted"),
	profile: join(root, "sandbox.sb"),
	appData: join(root, "home/Library/Application Support/build.conducted.app"),
});

describe("the end-to-end harness", () => {
	it("fails the run when a folder of this run is left on disk", async () => {
		const base = mkdtempSync(join(tmpdir(), "e2e-harness-"));
		try {
			const left = join(base, `1-0-${process.pid}`);
			mkdirSync(left);
			expect(await cleanUp(newTracker(base))).toEqual([`${left} was not removed`]);
		} finally {
			rmSync(base, { recursive: true, force: true });
		}
	});

	it("removes the folders it made and then reports nothing", async () => {
		const base = mkdtempSync(join(tmpdir(), "e2e-harness-"));
		try {
			const tracker = newTracker(base);
			const root = join(base, `1-0-${process.pid}`);
			mkdirSync(join(root, "home"), { recursive: true });
			tracker.folders.add(folderAt(root));
			expect(await cleanUp(tracker)).toEqual([]);
			expect(existsSync(root)).toBe(false);
		} finally {
			rmSync(base, { recursive: true, force: true });
		}
	});

	it("starts the app with an environment built from nothing, every root in its folder", () => {
		const folder = folderAt("/private/tmp/conducted-e2e/1-0-1");
		const env = appEnvironment(folder, 4321);
		expect(Object.keys(env).sort()).toEqual([
			"CFFIXED_USER_HOME",
			"HOME",
			"LANG",
			"PATH",
			"SHELL",
			"TAURI_WEBDRIVER_PORT",
			"TMPDIR",
			"USER",
		]);
		expect(env.HOME).toBe(folder.home);
		expect(env.CFFIXED_USER_HOME).toBe(folder.home);
		expect(env.TMPDIR).toBe(`${folder.tmp}/`);
		expect(env.TAURI_WEBDRIVER_PORT).toBe("4321");
	});

	it("moves a number one up, or one down at its maximum", () => {
		expect(nextNumber("12", "10", "20")).toBe("13");
		expect(nextNumber("20", "10", "20")).toBe("19");
		expect(nextNumber("", "10", null)).toBe("11");
	});
});
