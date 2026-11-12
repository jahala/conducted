/**
 * Tests the end-to-end harness's parts that need no app: the leftover check that fails a run, the
 * environment the app starts with, the first-screen wait's script timeouts, the sandbox's limit on
 * where programs run from, the PATH folders outside it, and the next value a number control moves
 * to.
 */
import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nextNumber } from "./controls.ts";
import {
	appEnvironment,
	cleanUp,
	FIRST_SCREEN_PROBE_MS,
	type FreshFolder,
	foldersOutside,
	freshFolderProfile,
	newTracker,
	type ScriptSession,
	waitForFirstScreen,
} from "./harness.ts";

const folderAt = (root: string): FreshFolder => ({
	root,
	home: join(root, "home"),
	tmp: join(root, "tmp"),
	exe: join(root, "Conducted.app/Contents/MacOS/conducted"),
	profile: join(root, "sandbox.sb"),
	appData: join(root, "home/Library/Application Support/build.conducted.app"),
	probe: join(root, "refused/probe"),
	programRoots: [root, "/usr/bin", "/bin"],
});

/**
 * A session that answers as the test-only WebDriver server does (#632): each script runs under the
 * script timeout the session holds when the script arrives, and the first script is lost, so it
 * ends with a script timeout. The server would answer it only once that timeout ran out; here it
 * answers at once, and the timeout it ran under is recorded. The first screen shows from the third
 * probe on.
 */
function sessionThatLosesTheFirstScript(): { session: ScriptSession; ranUnder: number[] } {
	let script = 30_000;
	const ranUnder: number[] = [];
	const session: ScriptSession = {
		getTimeouts: async () => ({ script }),
		setTimeout: async (timeouts) => {
			script = timeouts.script;
		},
		execute: async () => {
			ranUnder.push(script);
			if (ranUnder.length === 1) throw new Error("script timeout");
			return ranUnder.length >= 3;
		},
	};
	return { session, ranUnder };
}

describe("the end-to-end harness", () => {
	it("probes for the first screen under the short script timeout, then restores the session's", async () => {
		const { session, ranUnder } = sessionThatLosesTheFirstScript();
		await waitForFirstScreen(session, FIRST_SCREEN_PROBE_MS);
		expect(ranUnder).toEqual([FIRST_SCREEN_PROBE_MS, FIRST_SCREEN_PROBE_MS, FIRST_SCREEN_PROBE_MS]);
		expect((await session.getTimeouts()).script).toBe(30_000);
	});

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

	it("names the PATH folders outside the fresh folder and the system's folders", () => {
		const roots = ["/private/tmp/conducted-e2e/1-0-1", "/usr/bin", "/bin"];
		const path =
			"/private/tmp/conducted-e2e/1-0-1/home/bin:/usr/bin:/bin:/usr/bin-extra:/opt/homebrew/bin::/usr/local/bin";
		expect(foldersOutside(path, roots)).toEqual([
			"/usr/bin-extra",
			"/opt/homebrew/bin",
			"/usr/local/bin",
		]);
	});

	it("refuses programs from anywhere but the fresh folder and the system's folders", () => {
		const folder = folderAt("/private/tmp/conducted-e2e/1-0-1");
		const profile = freshFolderProfile(folder, join(folder.root, "refused"));
		const lines = profile.split("\n");
		const refuseAll = lines.indexOf("(deny process-exec*)");
		const allow = lines.indexOf(
			`(allow process-exec* (subpath "${folder.root}") (subpath "/usr/bin") (subpath "/bin"))`,
		);
		const ps = lines.indexOf('(allow process-exec (literal "/bin/ps") (with no-sandbox))');
		const probe = lines.indexOf(`(deny process-exec* (subpath "${folder.root}/refused"))`);
		// The last rule that matches decides: refuse all, allow the roots, run ps outside the
		// sandbox, and always refuse the probe.
		expect(refuseAll).toBeGreaterThan(0);
		expect(allow).toBeGreaterThan(refuseAll);
		expect(ps).toBeGreaterThan(allow);
		expect(probe).toBeGreaterThan(ps);
	});

	it("moves a number one up, or one down at its maximum", () => {
		expect(nextNumber("12", "10", "20")).toBe("13");
		expect(nextNumber("20", "10", "20")).toBe("19");
		expect(nextNumber("", "10", null)).toBe("11");
	});
});
