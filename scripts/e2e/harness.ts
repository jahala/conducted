/**
 * @feature End-to-end tests in the real app (issue #564)
 * Owns: the test build of the desktop app, the fresh data folder each check runs over, starting,
 * quitting and stopping the real app in it, and the WebdriverIO session that drives its window.
 * Behaviour: issue #564 and https://v2.tauri.app/develop/tests/webdriver/: on macOS the window is
 * reached through the WebDriver server embedded in the app (`tauri-plugin-wdio-webdriver`), which
 * only the `e2e` Cargo feature compiles in.
 * Must handle: a test build that lacks the WebDriver server (refused before any check runs); a port
 * another process holds (the server must belong to the app's own pid); the app's data, config,
 * WebKit storage, Keychain search list and temp files all inside the fresh folder, proved on each
 * launch; an app that never answers, never shows its first screen or never quits (each a named
 * failure after the hang limit); every ending, including Ctrl+C, stops the app and everything it
 * started by the pids recorded, and removes the folder.
 * Our design choice: the build is a debug `.app` bundle (`tauri build --debug --bundles app`) with
 * the release config's bundled sidecar, so the app finds its resources and its sidecar the way a
 * shipped app does, and serves the built UI with no dev server. Each folder holds its own clone of
 * the bundle (APFS clones share the bytes), so another build into the shared Cargo target folder
 * cannot swap the app under a running check.
 * Our design choice: `CFFIXED_USER_HOME` points Foundation's home folder into the fresh folder as
 * well as `HOME`. Without it WebKit keeps the page's storage in the owner's `~/Library/WebKit`,
 * shared with every other copy of the app that has the same bundle identifier.
 * Our design choice: the app runs under the sidecar differential run's sandbox profile
 * (`sandboxProfile` in conductor-reference/sidecar-diff/seal.ts): no network beyond loopback and no
 * writes in the owner's home folder. So the app's first launch downloads no agent programs, and a
 * path that escaped the fresh folder fails instead of writing the owner's files.
 * Our design choice: the app runs programs only from the fresh folder and the system's own
 * folders (issue #640). The login shell the app reads its PATH from reads none of the system's
 * startup files (the fresh home's `.zshenv`), so the agent catalogue finds none of the owner's
 * programs, and the profile refuses any program outside those folders, so a path written out in
 * full cannot reach them either. Each launch proves the sandbox refuses a probe program, and fails
 * when the app's login PATH holds another folder; a process seen under the app that runs a program
 * from another folder fails the run.
 * Test first: fails the run when a folder of this run is left on disk; names the PATH folders
 * outside the fresh folder and the system's own.
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { remote } from "webdriverio";
import { hasWebDriver, runTool } from "../../apps/desktop/src-tauri/release/bundle.ts";
import releaseConfig from "../../apps/desktop/src-tauri/tauri.release.conf.json" with {
	type: "json",
};
import { alive, descendants, exited, stopApp, stopLeftovers } from "../app-process.ts";
import { sandboxProfile } from "../conductor-reference/sidecar-diff/seal.ts";
import { removeDeadRuns } from "../with-run-dir.ts";

export const ROOT = resolve(import.meta.dir, "../..");
const DESKTOP = join(ROOT, "apps/desktop");
const IDENTIFIER = "build.conducted.app";
/** Catches a hang. It is not a way to wait. */
export const HANG_MS = 60_000;
/**
 * Where each run's fresh folders live, named `<time>-<n>-<harness pid>`. A short path, because
 * the sidecar's socket sits in the app's temp folder inside it, and macOS caps a socket path at
 * 104 bytes.
 */
export const BASE = "/tmp/conducted-e2e";
const OWNER = "owner.pid";
const SYSTEM_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";

export type Browser = WebdriverIO.Browser;

/** The `--config` the test build merges in: the sidecar bundled as the release bundles it. */
export const TEST_BUILD_CONFIG = { bundle: { externalBin: releaseConfig.bundle.externalBin } };

/** Runs one build step quietly; its output is printed only when it fails. */
function runStep(command: string, args: string[], tmp: string): void {
	const done = spawnSync(command, args, {
		cwd: ROOT,
		env: { ...process.env, TMPDIR: `${tmp}/` },
		encoding: "utf8",
		maxBuffer: 256 * 1024 * 1024,
	});
	if (done.status !== 0) {
		const output = `${done.stdout ?? ""}${done.stderr ?? ""}`.trim().split("\n").slice(-40);
		throw new Error(
			`${command} ${args.join(" ")} failed with exit ${done.status ?? "signal"}:\n${output.join("\n")}`,
		);
	}
}

/** The sidecar, then the test app bundle with the WebDriver server, each built quietly. */
function buildSteps(tmp: string): void {
	runStep("pnpm", ["--filter", "@conducted/sidecar", "build"], tmp);
	runStep(
		"pnpm",
		[
			"--filter",
			"@conducted/desktop",
			"tauri",
			"build",
			"--debug",
			"--bundles",
			"app",
			"--features",
			"e2e",
			"--ci",
			"--config",
			JSON.stringify(TEST_BUILD_CONFIG),
		],
		tmp,
	);
}

/**
 * Builds the test app and returns its bundle. Cargo, Vite and Bun each rebuild only what changed.
 * The bundle must carry the WebDriver server: a build without it could not reach the window.
 */
export async function buildTestApp(): Promise<string> {
	// The build's own temp folder, removed after it: Vite's command line keeps Node's compile
	// cache in the temp folder, which would outlive the run.
	const tmp = mkdtempSync(join(tmpdir(), "e2e-build-"));
	try {
		buildSteps(tmp);
	} finally {
		rmSync(tmp, { recursive: true, force: true });
	}
	const target = process.env.CARGO_TARGET_DIR ?? join(DESKTOP, "src-tauri/target");
	const app = join(target, "debug/bundle/macos/Conducted.app");
	const scanned = await hasWebDriver(runTool, join(app, "Contents/MacOS/conducted"));
	if (!scanned.ok) throw new Error(scanned.error.message);
	if (!scanned.value) {
		throw new Error(`${app} has no WebDriver server; was it built without the e2e feature?`);
	}
	return app;
}

/** One check's fresh folder: the app's home (data, config, WebKit storage) and temp folder. */
export interface FreshFolder {
	root: string;
	home: string;
	tmp: string;
	/** The executable inside this folder's clone of the test bundle. */
	exe: string;
	profile: string;
	/** The app's data folder, where its database lives. */
	appData: string;
	/** A program outside the folders programs may run from: the known case the sandbox refuses. */
	probe: string;
	/** The folders the app may run programs from: this folder and the system's own. */
	programRoots: string[];
}

/** Removes the folders of earlier runs whose harness is gone. Returns how many. */
export function removeAbandonedFolders(base: string = BASE): number {
	mkdirSync(base, { recursive: true });
	return removeDeadRuns(realpathSync(base));
}

/** A new folder for one check, holding a clone of the test bundle. The tracker removes it. */
export function makeFreshFolder(bundle: string, tracker: Tracker): FreshFolder {
	mkdirSync(tracker.base, { recursive: true });
	// The real path: Tauri refuses an executable whose path holds a symlink (/tmp is one). The name
	// ends in the harness's pid, which `removeDeadRuns` and the leftover check read.
	const root = join(
		realpathSync(tracker.base),
		`${Date.now()}-${tracker.folders.size}-${process.pid}`,
	);
	mkdirSync(root);
	writeFileSync(join(root, OWNER), String(process.pid));
	const home = join(root, "home");
	const tmp = join(root, "tmp");
	mkdirSync(home);
	mkdirSync(tmp);
	const app = join(root, "Conducted.app");
	const profile = join(root, "sandbox.sb");
	const refused = join(root, "refused");
	const folder: FreshFolder = {
		root,
		home,
		tmp,
		exe: join(app, "Contents/MacOS/conducted"),
		profile,
		appData: join(home, "Library/Application Support", IDENTIFIER),
		probe: join(refused, "probe"),
		programRoots: [root, ...systemProgramRoots()],
	};
	tracker.folders.add(folder);
	const cloned = spawnSync("/bin/cp", ["-c", "-R", bundle, app], { encoding: "utf8" });
	if (cloned.status !== 0) throw new Error(`Could not clone the test app: ${cloned.stderr}`);
	mkdirSync(refused);
	writeFileSync(folder.probe, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
	writeFileSync(join(home, ".zshenv"), ZSHENV);
	writeFileSync(profile, freshFolderProfile(folder, refused));
	return folder;
}

/**
 * The fresh home's first zsh startup file. It stops zsh from reading the system's startup files,
 * so the app's login shell keeps the PATH the harness gave it: `/etc/zprofile` runs
 * `path_helper`, which adds `/usr/local/bin` and `/etc/paths.d`'s folders, such as Homebrew's.
 */
const ZSHENV = "unsetopt GLOBAL_RCS\n";

/**
 * The folders the system's own programs run from. The developer folder is where `/usr/bin/git`
 * and `/usr/bin/xcodebuild` hand over to the selected Xcode or Command Line Tools.
 */
function systemProgramRoots(): string[] {
	const developer = spawnSync("/usr/bin/xcode-select", ["-p"], {
		env: { PATH: SYSTEM_PATH },
		encoding: "utf8",
	});
	const folder = developer.stdout.trim();
	if (developer.status !== 0 || folder === "") {
		throw new Error(`xcode-select names no developer folder: ${developer.stderr.trim()}`);
	}
	return [...SYSTEM_PROGRAMS, realpathSync(folder)];
}

const SYSTEM_PROGRAMS = ["/usr/bin", "/bin", "/usr/sbin", "/sbin", "/usr/libexec", "/System"];

/**
 * The fresh folder's sandbox profile: the sidecar differential run's, with programs allowed only
 * from the folder's program roots, and the probe's folder always refused.
 */
export function freshFolderProfile(
	folder: Pick<FreshFolder, "programRoots">,
	refused: string,
): string {
	return `${sandboxProfile(homedir(), ["/bin/ps"], folder.programRoots)}(deny process-exec* (subpath ${JSON.stringify(refused)}))\n`;
}

/** True when `path` is one of `roots` or inside one. */
const within = (path: string, roots: readonly string[]): boolean =>
	roots.some((root) => path === root || path.startsWith(`${root}/`));

/** Removes a fresh folder. Only folders this harness made are passed in. */
export function removeFreshFolder(folder: FreshFolder): void {
	rmSync(folder.root, { recursive: true, force: true });
}

/** The environment the app starts with: nothing from this shell, every root in the folder. */
export function appEnvironment(folder: FreshFolder, port: number): Record<string, string> {
	return {
		HOME: folder.home,
		CFFIXED_USER_HOME: folder.home,
		TMPDIR: `${folder.tmp}/`,
		PATH: SYSTEM_PATH,
		SHELL: "/bin/zsh",
		USER: "e2e",
		LANG: "en_US.UTF-8",
		TAURI_WEBDRIVER_PORT: String(port),
	};
}

/** A port nothing listens on now. The app's server must then prove the port is its own. */
async function freePort(): Promise<number> {
	return await new Promise((resolvePort, reject) => {
		const server = createServer();
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			const port = typeof address === "object" && address !== null ? address.port : 0;
			server.close(() => resolvePort(port));
		});
	});
}

/** Runs `step` every 100 ms until it returns a value, or fails after the hang limit. */
export async function until<T>(
	what: string,
	step: () => Promise<T | undefined>,
	limitMs = HANG_MS,
): Promise<T> {
	const deadline = Date.now() + limitMs;
	let last: unknown = null;
	while (Date.now() < deadline) {
		try {
			const value = await step();
			if (value !== undefined) return value;
		} catch (cause) {
			last = cause;
		}
		await Bun.sleep(100);
	}
	const reason = last instanceof Error ? `: ${last.message}` : "";
	throw new Error(`${what} did not happen within ${limitMs / 1000} s${reason}`);
}

/** The Keychains a process in the folder's environment searches, as `security` lists them. */
function keychainSearchList(folder: FreshFolder): string[] {
	const listed = spawnSync("/usr/bin/security", ["list-keychains"], {
		env: { HOME: folder.home, CFFIXED_USER_HOME: folder.home, PATH: SYSTEM_PATH },
		encoding: "utf8",
	});
	return listed.stdout
		.split("\n")
		.map((line) => line.trim().replace(/^"|"$/g, ""))
		.filter((line) => line !== "");
}

/**
 * What in the folder's environment could reach the owner's data; empty when nothing can. The app's
 * secrets go through the Keychain, which is not a folder, so its search list is checked here.
 */
export function isolationProblems(folder: FreshFolder): string[] {
	const owner = homedir();
	return [
		...keychainSearchList(folder)
			.filter((keychain) => keychain.startsWith(`${owner}/`))
			.map((keychain) => `the app would search the owner's Keychain ${keychain}`),
		...probeProblems(folder),
	];
}

/**
 * Empty when the sandbox refuses to run the probe, a program outside the folders programs may run
 * from. A profile that let it run would let the app run the owner's programs too.
 */
function probeProblems(folder: FreshFolder): string[] {
	const ran = spawnSync("/usr/bin/sandbox-exec", ["-f", folder.profile, folder.probe], {
		env: { PATH: SYSTEM_PATH },
		encoding: "utf8",
	});
	if (ran.status !== 0 && ran.stderr.includes("Operation not permitted")) return [];
	return [`the sandbox let ${folder.probe} run, so the app could run programs from anywhere`];
}

/** The folders on a PATH that are outside `roots`. */
export function foldersOutside(path: string, roots: readonly string[]): string[] {
	return path.split(":").filter((entry) => entry !== "" && !within(entry, roots));
}

/** The app's login-shell PATH, the one its agent catalogue finds programs on (`shell_login_env`). */
async function loginPath(browser: Browser): Promise<string> {
	// WebDriver waits for the promise a script returns.
	const answer = await browser.execute(async () => {
		const internals = (
			window as unknown as {
				__TAURI_INTERNALS__: { invoke(command: string, args: unknown): Promise<unknown> };
			}
		).__TAURI_INTERNALS__;
		return await internals
			.invoke("shell_login_env", {})
			.catch((error: unknown) => ({ error: String(error) }));
	});
	const path = (answer as { path?: unknown }).path;
	if (typeof path !== "string") {
		throw new Error(`The app's login shell PATH could not be read: ${JSON.stringify(answer)}`);
	}
	return path;
}

/** The executable a process runs, as `lsof` names its first program text; null once it is gone. */
function executableOf(pid: number): string | null {
	const files = spawnSync("/usr/sbin/lsof", ["-a", "-p", String(pid), "-d", "txt", "-Fn"], {
		encoding: "utf8",
	});
	const first = files.stdout.split("\n").find((line) => line.startsWith("n"));
	return first === undefined ? null : first.slice(1);
}

/** Records each process under the app that runs a program from outside the folder's program roots. */
function notePrograms(pids: readonly number[], folder: FreshFolder, tracker: Tracker): void {
	for (const pid of pids) {
		tracker.seen.add(pid);
		const program = executableOf(pid);
		if (program !== null && !within(program, folder.programRoots)) {
			tracker.outside.add(
				`the app ran ${program}, outside the fresh folder and the system's own folders`,
			);
		}
	}
}

/** A running copy of the app over one fresh folder. */
export interface RunningApp {
	folder: FreshFolder;
	child: ChildProcess;
	pid: number;
	port: number;
	browser: Browser;
	/** The app's own output, for a failure's report. */
	output: string[];
}

/** Every process a run started, so every ending can stop them. */
export interface Tracker {
	/** The folder the run's fresh folders go in. */
	base: string;
	/** The apps still running, by their process. */
	apps: Set<ChildProcess>;
	folders: Set<FreshFolder>;
	/** Every pid the run saw under an app, checked once more at the end. */
	seen: Set<number>;
	/** Each program seen running under an app from outside its folder and the system's folders. */
	outside: Set<string>;
}

export const newTracker = (base: string = BASE): Tracker => ({
	base,
	apps: new Set(),
	folders: new Set(),
	seen: new Set(),
	outside: new Set(),
});

function listensOn(pid: number, port: number): boolean {
	const found = spawnSync(
		"/usr/sbin/lsof",
		["-a", "-p", String(pid), `-iTCP:${port}`, "-sTCP:LISTEN", "-t"],
		{ encoding: "utf8" },
	);
	return found.stdout.split("\n").some((line) => line.trim() === String(pid));
}

/**
 * The last lines of the app's newest log file in the fresh folder (`<app data>/logs`), so a launch
 * that fails says what the app wrote about it. The folder is removed after the run.
 */
export function appLogTail(folder: FreshFolder, lines = 20): string {
	const logs = join(folder.appData, "logs");
	if (!existsSync(logs)) return "(no log folder)";
	const newest = readdirSync(logs)
		.map((name) => join(logs, name))
		.filter((path) => statSync(path).isFile())
		.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
	if (newest === undefined) return "(no log file)";
	return readFileSync(newest, "utf8").trim().split("\n").slice(-lines).join("\n");
}

/** The page's first screen is drawn: the app shell, with the sidebar's Settings link. */
const FIRST_SCREEN = '[aria-label="Settings"]';

/** Starts the app over `folder` and connects to its window once the first screen is drawn. */
export async function launch(folder: FreshFolder, tracker: Tracker): Promise<RunningApp> {
	const problems = isolationProblems(folder);
	if (problems.length > 0)
		throw new Error(`The fresh folder is not sealed: ${problems.join("; ")}`);
	const port = await freePort();
	// A window macOS thinks nobody sees can be put to sleep (App Nap), which stalls its calls. The
	// setting given on the command line holds for this process only; nothing is stored.
	const child = spawn(
		"/usr/bin/sandbox-exec",
		["-f", folder.profile, folder.exe, "-NSAppSleepDisabled", "YES"],
		{ cwd: folder.root, env: appEnvironment(folder, port), stdio: ["ignore", "pipe", "pipe"] },
	);
	const pid = child.pid;
	if (pid === undefined) throw new Error("The app did not start.");
	const output: string[] = [];
	child.stdout?.on("data", (chunk: Buffer) => output.push(chunk.toString()));
	child.stderr?.on("data", (chunk: Buffer) => output.push(chunk.toString()));
	tracker.apps.add(child);
	const gone = (): boolean => child.exitCode !== null || child.signalCode !== null;
	await until("the app's WebDriver server answering", async () => {
		if (gone()) throw new Error(`the app exited (${output.join("").trim().slice(-400)})`);
		const answer = await fetch(`http://127.0.0.1:${port}/status`).catch(() => null);
		if (answer === null || !answer.ok) return undefined;
		const body = (await answer.json()) as { value?: { ready?: boolean } };
		return body.value?.ready === true ? true : undefined;
	});
	if (!listensOn(pid, port)) {
		throw new Error(`Port ${port} answers, but not from the app's process ${pid}.`);
	}
	const browser = await remote({
		hostname: "127.0.0.1",
		port,
		capabilities: {} as WebdriverIO.Capabilities,
		logLevel: "error",
		connectionRetryTimeout: HANG_MS,
		connectionRetryCount: 0,
	});
	try {
		await until("the app's first screen", async () =>
			(await browser.execute(
				(selector: string) => document.querySelector(selector) !== null,
				FIRST_SCREEN,
			))
				? true
				: undefined,
		);
	} catch (cause) {
		// Say what the window showed instead, and what the app printed, so the failure names its cause.
		const shown = await browser
			.execute(() => (document.body?.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 400))
			.catch((error: unknown) => `(the page could not be read: ${String(error)})`);
		const printed = output.join("").trim().slice(-400);
		throw new Error(
			`${cause instanceof Error ? cause.message : String(cause)}; the window showed "${shown}"; the app printed "${printed}"; its log ends: ${appLogTail(folder)}`,
		);
	}
	notePrograms(descendants(pid), folder, tracker);
	const outside = foldersOutside(await loginPath(browser), folder.programRoots);
	if (outside.length > 0) {
		throw new Error(
			`The app's login shell PATH holds folders outside the fresh folder and the system's own: ${outside.join(", ")}`,
		);
	}
	return { folder, child, pid, port, browser, output };
}

/**
 * Fails unless the page's own storage is the fresh folder's: on the first launch the page holds no
 * stored keys, and WebKit keeps its data under the folder's home. A store shared with another copy
 * of the app would show that copy's keys here.
 */
export async function proveFreshPageStorage(app: RunningApp): Promise<void> {
	const keys = await app.browser.execute(() => Object.keys(localStorage));
	if (keys.length > 0) {
		throw new Error(`The page's storage is not fresh; it holds ${keys.join(", ")}.`);
	}
	const webkit = join(app.folder.home, "Library/WebKit");
	if (!existsSync(webkit)) throw new Error(`WebKit keeps no data under ${webkit}.`);
}

/**
 * Quits the app the way its Quit menu item does: the shell's quit request reaches the UI, which
 * stops its services and the sidecar, then exits. An app that does not exit within the hang limit
 * fails the check; the run's cleanup then stops it.
 */
export async function quit(app: RunningApp, tracker: Tracker): Promise<void> {
	notePrograms(descendants(app.pid), app.folder, tracker);
	await app.browser.execute(() => {
		const internals = (
			window as unknown as {
				__TAURI_INTERNALS__: { invoke(command: string, args: unknown): Promise<unknown> };
			}
		).__TAURI_INTERNALS__;
		void internals.invoke("plugin:event|emit", { event: "app://quit-requested", payload: null });
	});
	let timer: ReturnType<typeof setTimeout> | undefined;
	const hang = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(
			() => reject(new Error(`The app did not quit within ${HANG_MS / 1000} s.`)),
			HANG_MS,
		);
	});
	try {
		await Promise.race([exited(app.child), hang]);
	} finally {
		clearTimeout(timer);
	}
	tracker.apps.delete(app.child);
}

/** Quits the app and starts it again over the same folder. */
export async function restart(app: RunningApp, tracker: Tracker): Promise<RunningApp> {
	await quit(app, tracker);
	return await launch(app.folder, tracker);
}

/**
 * True when a process holds a file in one of this run's folders: its executable, its working
 * folder or an open file. A pid seen earlier may since belong to another program; this tells them
 * apart without reading any command line.
 */
function heldByRun(pid: number, roots: readonly string[]): boolean {
	const files = spawnSync("/usr/sbin/lsof", ["-a", "-p", String(pid), "-Fn"], { encoding: "utf8" });
	return files.stdout
		.split("\n")
		.some((line) => line.startsWith("n") && roots.some((root) => line.startsWith(`n${root}/`)));
}

/**
 * Stops every app the run still holds, then every process an app started that outlived it, and
 * removes every folder the run made. Returns each program seen running under an app from outside
 * its folder and the system's folders, what outlived its app and what stayed on disk, all of which
 * fail the run.
 */
export async function cleanUp(tracker: Tracker): Promise<string[]> {
	const roots = [...tracker.folders].map((folder) => folder.root);
	for (const child of [...tracker.apps]) {
		if (child.pid !== undefined) for (const id of descendants(child.pid)) tracker.seen.add(id);
		await stopApp(child);
		tracker.apps.delete(child);
	}
	const outlived = [...tracker.seen].filter((id) => alive(id) && heldByRun(id, roots));
	const left = [...tracker.outside, ...outlived.map((id) => `process ${id} outlived its app`)];
	tracker.outside.clear();
	await stopLeftovers(outlived);
	for (const folder of [...tracker.folders]) {
		removeFreshFolder(folder);
		tracker.folders.delete(folder);
	}
	for (const id of outlived) if (alive(id)) left.push(`process ${id} would not stop`);
	if (existsSync(tracker.base)) {
		const own = readdirSync(tracker.base).filter((entry) => entry.endsWith(`-${process.pid}`));
		for (const name of own) left.push(`${join(tracker.base, name)} was not removed`);
	}
	return left;
}

/** What a check gets: the test bundle, the run's tracker and a line printer. */
export interface CheckContext {
	bundle: string;
	tracker: Tracker;
	log(line: string): void;
}

/** One end-to-end check. It returns its failures; empty means it passed. */
export interface Check {
	name: string;
	run(context: CheckContext): Promise<string[]>;
}
