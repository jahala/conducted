/**
 * @feature PLAT-01 Platform contract: one list of behaviours both implementations must show
 * Owns: the list of behaviours of the Platform interface (as data), the method each case must call,
 * the methods no case covers (with a reason), and the function that turns the list into tests. Two
 * runs use it: the in-memory stand-in (memory.test.ts) and `createTauriPlatform` over Node-backed
 * bindings (tauri-contract.test.ts). Each run passes its own list of cases it cannot run, with a
 * reason, and the test output names every one.
 * Behaviour: services-map.md 1.1 (Platform object), native-and-sidecar-map.md A2 (what each
 * Rust command promises), docs/plans/tauri-commands.md.
 * Must handle: every case builds its own Platform and cleans it up, even when the case fails (no
 * temp folders, scratch databases or processes left behind); a case runs on a stand-in only when
 * the stand-in computes the answer: the memory stand-in answers shell commands from a script, so
 * the shell cases that read a process's output skip there and run on the Node-backed bindings,
 * which start real processes; cases that need Rust or macOS (pty, keychain, trash, the ignore and
 * regex crates) skip on the Node-backed run; a case that needs outside events (a click, a dialog
 * answer, a crashed sidecar) is marked `needs: "controls"`, and each run supplies the controls it
 * can honestly provide; every case lists the Platform methods it must call, and the run fails a
 * case that did not call one of them; cases wait for events, not for a fixed time (the two
 * exceptions are single macrotask yields: in db.transaction-serialised, which only gives a second
 * transaction the chance to overlap, and in notifications.click, which checks that an
 * unsubscribed listener hears nothing); a case that needs the sidecar and has no controls expects a
 * loopback echo child, never a real agent.
 * Our design choice: the harness (`describe`, `it`, `skip`, `assert`) is passed in, so this file
 * imports no test framework. It sits in `src/test/` because only tests run it. Cases are plain data, and a coverage test
 * fails when a `Platform` method has neither a case nor an entry in `UNCOVERED_METHODS`, so a new
 * method cannot be forgotten.
 * Test first: the in-memory Platform passes "fs: write then read returns the same text".
 */
import type { AppError, Result } from "@conducted/shared";
import type { Platform, ProgramStatus, SpeechEvent, Unsubscribe } from "../platform/platform.ts";

export type ContractGroup = keyof Platform;

export interface ContractCase {
	/** Stable id, "<group>.<name>". */
	id: string;
	group: ContractGroup;
	title: string;
	/** What must hold, in one or two sentences. */
	behaviour: string;
	/** "os" cases need a real operating system on the Tauri side; "controls" cases need scripted outside events. */
	needs: "none" | "os" | "controls";
}

const c = (
	group: ContractGroup,
	name: string,
	title: string,
	behaviour: string,
	needs: ContractCase["needs"] = "none",
): ContractCase => ({ id: `${group}.${name}`, group, title, behaviour, needs });

export const PLATFORM_CONTRACT_CASES: readonly ContractCase[] = [
	c(
		"fs",
		"write-read",
		"write then read returns the same text",
		"writeTextAtomic then readText gives the exact text, including non-ASCII.",
	),
	c(
		"fs",
		"atomic-no-partial",
		"a failed write leaves the old file whole",
		"If the write fails, readText still returns the previous content and no temp file remains in the folder.",
	),
	c(
		"fs",
		"missing-file",
		"reading a missing file is an Err",
		"readText on a path that does not exist returns Err, not an exception.",
	),
	c(
		"fs",
		"exists-stat",
		"exists and stat agree",
		"exists is true for files and folders that stat finds, false for others; stat reports isDirectory and size.",
	),
	c(
		"fs",
		"mkdirp-idempotent",
		"mkdirp can run twice",
		"Creating a folder that exists is Ok, and parents are created.",
	),
	c(
		"fs",
		"read-dir",
		"readDir lists direct children",
		"readDir returns the direct children with isDirectory set, not nested files.",
	),
	c(
		"fs",
		"dot-segments",
		"a path with . and .. names the file it resolves to",
		"Writing through `inner/./../note.txt` writes `note.txt` next to `inner`; exists and readText agree on the resolved path, and nothing lands inside `inner`.",
	),
	c(
		"fs",
		"trash",
		"trash removes from the folder without deleting for good",
		"After trash the path no longer exists; on the Tauri side the item is in the macOS Trash.",
		"os",
	),
	c(
		"db",
		"roundtrip",
		"execute then select with $1 parameters",
		"Parameters bind by position; select returns rows as objects keyed by column name.",
	),
	c(
		"db",
		"rows-affected",
		"execute reports rowsAffected",
		"An UPDATE of two rows reports rowsAffected 2.",
	),
	c(
		"db",
		"transaction-commit",
		"a transaction commits its work",
		"Rows written inside transaction() are visible after it resolves.",
	),
	c(
		"db",
		"transaction-rollback",
		"a thrown error rolls back",
		"If the callback throws, nothing it wrote remains, and the error is thrown to the caller.",
	),
	c(
		"db",
		"transaction-serialised",
		"two transactions do not overlap",
		"A second transaction() started while one is open waits for it; their statements never interleave.",
	),
	c(
		"db",
		"foreign-keys",
		"foreign keys are enforced",
		"Inserting a row that points to a missing parent fails; deleting a parent cascades where the schema says so.",
	),
	c(
		"shell",
		"run-stdout",
		"run captures stdout and exit code",
		"A command that prints and exits 0 returns Ok with stdout and exitCode 0.",
	),
	c(
		"shell",
		"run-nonzero",
		"a non-zero exit is still Ok",
		"A command that exits 3 returns Ok with exitCode 3 and its stderr.",
	),
	c(
		"shell",
		"run-cwd-env-stdin",
		"cwd, env and stdin are honoured",
		"The process starts in cwd, sees the env overlay on top of the login environment, and reads stdin until closed.",
	),
	c(
		"shell",
		"run-timeout",
		"timeoutMs kills the process group",
		"A command that outlives timeoutMs returns Err with code shell_timeout and its children are gone.",
		"os",
	),
	c(
		"shell",
		"start-cancel",
		"start returns a handle that can be cancelled",
		"cancel() ends the process; done resolves with Err code shell_cancelled (as shell.rs reports it), and a second cancel() is harmless.",
		"os",
	),
	c(
		"shell",
		"no-shell-string",
		"arguments are not parsed by a shell",
		"An argument with spaces, quotes and $ reaches the program unchanged.",
	),
	c(
		"shell",
		"login-env",
		"loginEnv returns a PATH",
		"loginEnv gives a non-empty shell and path, the same on every call.",
	),
	c(
		"fileSearch",
		"list-tree-ignores",
		"listTree respects .gitignore",
		"Ignored files and the .git folder are not listed.",
		"os",
	),
	c(
		"fileSearch",
		"fuzzy",
		"fuzzyMatch ranks and limits",
		"A query matches by subsequence, better matches first, at most `limit` results.",
		"os",
	),
	c(
		"fileSearch",
		"grep-bad-regex",
		"grep with a bad pattern is an Err",
		"An invalid regular expression returns Err, with a message that starts with 'Invalid pattern'.",
		"os",
	),
	c(
		"fileSearch",
		"list-artifacts",
		"listArtifacts pages the .context folder",
		"Files under .context are listed newest first; a page returns at most `limit` entries and a next cursor while more remain.",
	),
	c(
		"fileSearch",
		"list-artifacts-files-only",
		"listArtifacts lists files, not folders",
		"A folder under .context takes no entry and no page slot; only the files inside it are listed.",
	),
	c(
		"fileSearch",
		"list-artifacts-exclusions",
		"listArtifacts leaves out the reserved .context files",
		"The reserved paths (todos.md at the root, conductor/, pull-requests/, attachments/comments/) and names ([GITHUB]-N.md, terminal-output*.txt and the instruction files) are not listed; todos.md below the root is.",
	),
	c(
		"fileSearch",
		"list-artifacts-omitted",
		"listArtifacts counts the excluded files on every page",
		"`omitted` is the number of excluded files in the whole folder, and every page carries the same total.",
	),
	c(
		"pty",
		"spawn-echo",
		"spawn, write, read output",
		"Writing a line to a spawned shell produces output through onData; ack() lets more flow.",
		"os",
	),
	c(
		"pty",
		"exit-code",
		"onExit tells early and late listeners the same code, once",
		"After the process ends, a listener added before and a listener added after both hear the same exit code, and the early one hears it once.",
		"os",
	),
	c(
		"pty",
		"screen-text",
		"screenText returns visible text",
		"After output, screenText(maxLines) contains it without escape codes.",
		"os",
	),
	c(
		"pty",
		"kill",
		"kill ends the process",
		"After kill() onExit fires and write() returns without error.",
		"os",
	),
	c(
		"sidecar",
		"ensure-started-twice",
		"ensureStarted is idempotent",
		"Calling it twice starts one process; both calls return Ok.",
		"os",
	),
	c(
		"sidecar",
		"send-before-start",
		"send before start is an Err",
		"send() on a transport that was never started returns Err, not a hang.",
	),
	c(
		"sidecar",
		"line-roundtrip",
		"a line sent comes back from a loopback child",
		"Every line the sidecar sends reaches every onLine listener in order; a listener that unsubscribed hears nothing more.",
		"os",
	),
	c(
		"sidecar",
		"restart-signal",
		"onRestart fires when the process exits",
		"Each time the process exits, a listener hears one restart; a listener that unsubscribed hears none.",
		"controls",
	),
	c(
		"keychain",
		"roundtrip",
		"set, get, delete",
		"get after set returns the value; get after delete returns Ok(null); delete of a missing key is Ok.",
		"os",
	),
	c(
		"notifications",
		"badge",
		"dock badge accepts a count and null",
		"setDockBadge(3) then setDockBadge(null) both resolve, and the platform passes the count to the layer below it as given.",
		"controls",
	),
	c(
		"notifications",
		"click",
		"a click calls onClicked with the deep link",
		"Clicking a notification that carried deepLink X calls the listener with X once; a listener that unsubscribed hears nothing more.",
		"controls",
	),
	c(
		"clipboard",
		"write-text",
		"writeText stores text",
		"writeText resolves, and the text reaches the layer below it unchanged.",
		"controls",
	),
	c("app", "health", "health is Ok", "health() returns Ok when the shell is up."),
	c(
		"app",
		"write-log-never-throws",
		"writeLog never throws",
		"writeLog with an object that cannot be serialised does not throw and does not reject.",
	),
	c(
		"app",
		"version",
		"version and channel are set",
		"version is a non-empty string and channel is dev or release.",
	),
	c(
		"dialogs",
		"pick-folder",
		"pickFolder returns the chosen folder or null",
		"A scripted folder answer comes back exactly; a cancelled dialog returns null.",
		"controls",
	),
	c(
		"dialogs",
		"pick-files",
		"pickFiles returns the chosen files",
		"The files the user picks come back in the order given, as a list for one file and for none.",
		"controls",
	),
	c(
		"dialogs",
		"confirm",
		"confirm returns the user's answer",
		"A scripted yes returns true and a scripted no returns false.",
		"controls",
	),
	c(
		"opener",
		"installed-apps",
		"installedApps lists app names",
		"The result is a list of non-empty application names.",
		"os",
	),
	c(
		"speech",
		"available",
		"available reports support",
		"available() returns a boolean and never throws.",
		"os",
	),
	c(
		"speech",
		"stop-ends",
		"stop ends dictation",
		"After start and stop, the listener receives an `ended` event.",
		"os",
	),
	c(
		"updater",
		"check",
		"check returns an update or null",
		"check() resolves Ok with null or with an update that has a version.",
	),
	c(
		"updater",
		"installed-update",
		"installedUpdate returns the update that just ran or null",
		"installedUpdate() resolves Ok with null or with an update that has a version.",
	),
	c(
		"window",
		"is-focused",
		"isFocused returns a boolean",
		"isFocused() resolves a boolean and never throws.",
	),
	c(
		"window",
		"focus-events",
		"focus and blur reach a subscriber",
		"onFocusChanged reports true on focus and false on blur, and stops reporting after unsubscribe.",
		"controls",
	),
	c(
		"window",
		"setters",
		"window setters resolve",
		"setZoom, setVibrancy, setTrafficLightPosition and setTheme resolve without an error.",
		"os",
	),
	c(
		"menu",
		"set-shortcuts",
		"setShortcuts applies accepted accelerators",
		"A valid shortcut is listed as applied and a rejected one is reported.",
	),
	c(
		"system",
		"info",
		"info reports the macOS version and architectures",
		"osVersion is a version string; machineArch and buildArch are arm64 or x86_64.",
	),
	c(
		"system",
		"online-and-access",
		"isOnline and hasFullDiskAccess return booleans",
		"Both calls resolve booleans and never throw.",
	),
	c(
		"attachments",
		"materialize",
		"materialize copies a file into app storage",
		"The destination exists afterwards with the same text and byte size.",
	),
	c(
		"attachments",
		"resize-image",
		"resizeImage copies and reports the result",
		"The destination exists and the returned file names it.",
	),
	c(
		"programs",
		"install-status",
		"install makes a program ready",
		"After install, statuses() reports the program as ready with a path, and onStatus fired.",
	),
	c(
		"programs",
		"remove-status",
		"remove takes a program back to missing",
		"After remove, statuses() reports the program as missing and clears its path.",
	),
	c(
		"http",
		"invalid-url",
		"fetch with an invalid URL is an Err",
		"An invalid URL returns Err with a message, not an exception.",
	),
];

/**
 * The controls a test factory may expose so a case can act on the outside world. The in-memory
 * Platform provides all of them; a real-platform harness provides the ones its cases need.
 */
export interface ContractControls {
	holdNextStart?(): void;
	queueDialogAnswers?(answers: {
		folder?: string | null;
		files?: string[];
		confirm?: boolean;
	}): void;
	/** Each emit resolves once the platform has been told, so a case can wait for the event. */
	emitSidecarLine?(line: string): void | Promise<void>;
	emitSidecarRestart?(): void | Promise<void>;
	emitNotificationClick?(deepLink: string): void | Promise<void>;
	emitWindowFocus?(focused: boolean): void | Promise<void>;
	/** What the layer below the platform last received. */
	readonly dockBadge?: number | null;
	readonly clipboardText?: string | null;
}

export interface ContractContext {
	platform: Platform;
	kind: "memory" | "tauri";
	/** A scratch folder the case may write under. */
	root: string;
	controls?: ContractControls;
	assert(condition: boolean, message: string): void;
	/** An absolute path under `root`. */
	path(name: string): string;
}

export interface ContractHarness {
	describe(name: string, body: () => void): void;
	it(name: string, body: () => Promise<void>): void;
	/** Marks a case as not runnable for this factory. Required when `options.controls` is false. */
	skip?(name: string, reason: string): void;
	assert(condition: boolean, message: string): void;
}

export interface PlatformUnderTest {
	platform: Platform;
	/** A scratch folder the cases may use. */
	root: string;
	controls?: ContractControls;
	/** Removes everything the run created. Called after every case, even a failed one. */
	cleanup(): Promise<void>;
}

const joinPath = (root: string, name: string): string =>
	`${root.replace(/\/$/, "")}/${name.replace(/^\//, "")}`;

function expectOk<T>(ctx: ContractContext, result: Result<T>, what: string): T {
	if (!result.ok) {
		ctx.assert(false, `${what} returned Err ${result.error.code}: ${result.error.message}`);
		throw new Error(`${what} returned Err`);
	}
	return result.value;
}

function expectErr<T>(ctx: ContractContext, result: Result<T>, what: string): AppError {
	if (result.ok) {
		ctx.assert(false, `${what} should have returned Err`);
		throw new Error(`${what} should have returned Err`);
	}
	return result.error;
}

/** Waits for a real event. The timeout only catches a hang, it never paces the test. */
async function waitForEvent<T>(
	_ctx: ContractContext,
	subscribe: (listener: (value: T) => void) => Unsubscribe,
	action: () => void | Promise<void>,
	what: string,
): Promise<T> {
	let unsubscribe: Unsubscribe = () => {};
	let timer: ReturnType<typeof setTimeout> | undefined;
	const received = new Promise<T>((resolve) => {
		unsubscribe = subscribe(resolve);
	});
	const timeout = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(() => reject(new Error(`timed out waiting for ${what}`)), 5000);
	});
	try {
		await action();
		const value = await Promise.race([received, timeout]);
		return value;
	} finally {
		if (timer !== undefined) clearTimeout(timer);
		unsubscribe();
	}
}

/**
 * One macrotask yield, for a check that nothing more arrives. No event can announce that, so the
 * run gives the queued work one turn of the event loop to deliver it.
 */
const oneMacrotask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

type ContractStep = (ctx: ContractContext) => Promise<void>;

const STEPS: Record<string, ContractStep> = {
	"fs.write-read": async (ctx) => {
		const path = ctx.path("notes/hello.txt");
		const text = "héllo, 世界\nand a second line";
		// Rust does not create the folder of a file it writes.
		expectOk(ctx, await ctx.platform.fs.mkdirp(ctx.path("notes")), "mkdirp");
		expectOk(ctx, await ctx.platform.fs.writeTextAtomic(path, text), "writeTextAtomic");
		const read = expectOk(ctx, await ctx.platform.fs.readText(path), "readText");
		ctx.assert(read === text, `readText returned ${JSON.stringify(read)}`);
	},

	"fs.atomic-no-partial": async (ctx) => {
		const folder = ctx.path("atomic");
		const target = joinPath(folder, "keep.txt");
		expectOk(ctx, await ctx.platform.fs.mkdirp(folder), "mkdirp");
		expectOk(ctx, await ctx.platform.fs.writeTextAtomic(target, "old"), "first write");
		const failed = await ctx.platform.fs.writeTextAtomic(joinPath(target, "child.txt"), "new");
		ctx.assert(!failed.ok, "writing under a file should fail");
		const old = expectOk(ctx, await ctx.platform.fs.readText(target), "readText after failure");
		ctx.assert(old === "old", "the old file changed after a failed write");
		const entries = expectOk(ctx, await ctx.platform.fs.readDir(folder), "readDir");
		ctx.assert(
			entries.length === 1 && entries[0]?.path === target,
			`a failed write left something behind: ${entries.map((entry) => entry.path).join(", ")}`,
		);
	},

	"fs.missing-file": async (ctx) => {
		const result = await ctx.platform.fs.readText(ctx.path("no-such-file.txt"));
		const error = expectErr(ctx, result, "readText of a missing file");
		ctx.assert(error.message.length > 0, "the error has a message");
	},

	"fs.exists-stat": async (ctx) => {
		const folder = ctx.path("stat");
		const file = joinPath(folder, "file.txt");
		const text = "abcdef";
		expectOk(ctx, await ctx.platform.fs.mkdirp(folder), "mkdirp");
		expectOk(ctx, await ctx.platform.fs.writeTextAtomic(file, text), "writeTextAtomic");
		ctx.assert(await ctx.platform.fs.exists(file), "exists is true for a file");
		ctx.assert(await ctx.platform.fs.exists(folder), "exists is true for a folder");
		ctx.assert(!(await ctx.platform.fs.exists(ctx.path("absent"))), "exists is false elsewhere");
		const fileStat = expectOk(ctx, await ctx.platform.fs.stat(file), "stat file");
		ctx.assert(!fileStat.isDirectory, "a file is not a directory");
		ctx.assert(
			fileStat.size === new TextEncoder().encode(text).length,
			`stat size was ${fileStat.size}`,
		);
		const folderStat = expectOk(ctx, await ctx.platform.fs.stat(folder), "stat folder");
		ctx.assert(folderStat.isDirectory, "a folder reports isDirectory");
	},

	"fs.mkdirp-idempotent": async (ctx) => {
		const nested = ctx.path("deep/a/b");
		expectOk(ctx, await ctx.platform.fs.mkdirp(nested), "first mkdirp");
		expectOk(ctx, await ctx.platform.fs.mkdirp(nested), "second mkdirp");
		ctx.assert(await ctx.platform.fs.exists(nested), "the nested folder exists");
	},

	"fs.read-dir": async (ctx) => {
		const folder = ctx.path("listing");
		expectOk(ctx, await ctx.platform.fs.mkdirp(joinPath(folder, "sub")), "mkdirp");
		expectOk(ctx, await ctx.platform.fs.writeTextAtomic(joinPath(folder, "b.txt"), "b"), "write b");
		expectOk(
			ctx,
			await ctx.platform.fs.writeTextAtomic(joinPath(folder, "sub/c.txt"), "c"),
			"write c",
		);
		const entries = expectOk(ctx, await ctx.platform.fs.readDir(folder), "readDir");
		const names = entries.map((entry) => entry.path.split("/").pop() ?? "").sort();
		ctx.assert(
			names.length === 2 && names[0] === "b.txt" && names[1] === "sub",
			`readDir returned ${names.join(", ")}`,
		);
		const file = entries.find((entry) => entry.path.endsWith("b.txt"));
		const sub = entries.find((entry) => entry.path.endsWith("sub"));
		ctx.assert(file !== undefined && !file.isDirectory, "b.txt is a file");
		ctx.assert(sub?.isDirectory === true, "sub is a folder");
	},

	"fs.dot-segments": async (ctx) => {
		const folder = ctx.path("dots");
		expectOk(ctx, await ctx.platform.fs.mkdirp(joinPath(folder, "inner")), "mkdirp");
		const spelled = joinPath(folder, "inner/./../note.txt");
		const resolved = joinPath(folder, "note.txt");
		expectOk(ctx, await ctx.platform.fs.writeTextAtomic(spelled, "dots"), "writeTextAtomic");
		ctx.assert(await ctx.platform.fs.exists(resolved), "the file is at the resolved path");
		const read = expectOk(ctx, await ctx.platform.fs.readText(resolved), "readText");
		ctx.assert(read === "dots", `readText returned ${JSON.stringify(read)}`);
		ctx.assert(
			!(await ctx.platform.fs.exists(joinPath(folder, "inner/note.txt"))),
			"the file landed inside inner",
		);
	},

	"fs.trash": async (ctx) => {
		const path = ctx.path("trash/me.txt");
		expectOk(ctx, await ctx.platform.fs.mkdirp(ctx.path("trash")), "mkdirp");
		expectOk(ctx, await ctx.platform.fs.writeTextAtomic(path, "bye"), "writeTextAtomic");
		expectOk(ctx, await ctx.platform.fs.trash(path), "trash");
		ctx.assert(!(await ctx.platform.fs.exists(path)), "trash removed the file from its folder");
	},

	"db.roundtrip": async (ctx) => {
		const table = "contract_roundtrip";
		await ctx.platform.db.execute(
			`CREATE TABLE ${table} (id INTEGER PRIMARY KEY, name TEXT NOT NULL)`,
		);
		const inserted = await ctx.platform.db.execute(
			`INSERT INTO ${table} (id, name) VALUES ($1, $2)`,
			[1, "one"],
		);
		ctx.assert(inserted.rowsAffected === 1, `rowsAffected was ${inserted.rowsAffected}`);
		const rows = await ctx.platform.db.select<{ name: string }>(
			`SELECT name FROM ${table} WHERE id = $1`,
			[1],
		);
		ctx.assert(rows.length === 1 && rows[0]?.name === "one", "select did not return the row");
	},

	"db.rows-affected": async (ctx) => {
		const table = "contract_rows_affected";
		await ctx.platform.db.execute(`CREATE TABLE ${table} (id INTEGER PRIMARY KEY, name TEXT)`);
		await ctx.platform.db.execute(`INSERT INTO ${table} (id, name) VALUES ($1, $2)`, [1, "a"]);
		await ctx.platform.db.execute(`INSERT INTO ${table} (id, name) VALUES ($1, $2)`, [2, "b"]);
		const updated = await ctx.platform.db.execute(`UPDATE ${table} SET name = $1`, ["c"]);
		ctx.assert(updated.rowsAffected === 2, `rowsAffected was ${updated.rowsAffected}`);
	},

	"db.transaction-commit": async (ctx) => {
		const table = "contract_commit";
		await ctx.platform.db.execute(`CREATE TABLE ${table} (id INTEGER PRIMARY KEY)`);
		await ctx.platform.db.transaction(async (tx) => {
			await tx.execute(`INSERT INTO ${table} (id) VALUES ($1)`, [1]);
		});
		const rows = await ctx.platform.db.select(`SELECT id FROM ${table}`);
		ctx.assert(rows.length === 1, "the committed row is missing");
	},

	"db.transaction-rollback": async (ctx) => {
		const table = "contract_rollback";
		await ctx.platform.db.execute(`CREATE TABLE ${table} (id INTEGER PRIMARY KEY)`);
		let threw = false;
		try {
			await ctx.platform.db.transaction(async (tx) => {
				await tx.execute(`INSERT INTO ${table} (id) VALUES ($1)`, [1]);
				throw new Error("contract rollback");
			});
		} catch {
			threw = true;
		}
		ctx.assert(threw, "the callback's error did not reach the caller");
		const rows = await ctx.platform.db.select(`SELECT id FROM ${table}`);
		ctx.assert(rows.length === 0, "the rolled-back row remains");
	},

	"db.transaction-serialised": async (ctx) => {
		const table = "contract_serialised";
		await ctx.platform.db.execute(`CREATE TABLE ${table} (id INTEGER PRIMARY KEY)`);
		const order: string[] = [];
		let release: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let markStarted: () => void = () => {};
		const started = new Promise<void>((resolve) => {
			markStarted = resolve;
		});
		const first = ctx.platform.db.transaction(async (tx) => {
			order.push("first-start");
			await tx.execute(`INSERT INTO ${table} (id) VALUES ($1)`, [1]);
			markStarted();
			await gate;
			order.push("first-end");
		});
		await started;
		const second = ctx.platform.db.transaction(async (tx) => {
			order.push("second-start");
			await tx.execute(`INSERT INTO ${table} (id) VALUES ($1)`, [2]);
			order.push("second-end");
		});
		await oneMacrotask();
		release();
		await Promise.all([first, second]);
		ctx.assert(
			order.join(",") === "first-start,first-end,second-start,second-end",
			`transactions overlapped: ${order.join(",")}`,
		);
	},

	"db.foreign-keys": async (ctx) => {
		await ctx.platform.db.execute(`CREATE TABLE contract_fk_parent (id INTEGER PRIMARY KEY)`);
		await ctx.platform.db.execute(
			`CREATE TABLE contract_fk_child (
				id INTEGER PRIMARY KEY,
				parent_id INTEGER NOT NULL,
				FOREIGN KEY (parent_id) REFERENCES contract_fk_parent (id) ON DELETE CASCADE
			)`,
		);
		let rejected = false;
		try {
			await ctx.platform.db.execute(
				`INSERT INTO contract_fk_child (id, parent_id) VALUES ($1, $2)`,
				[1, 99],
			);
		} catch {
			rejected = true;
		}
		ctx.assert(rejected, "a child with a missing parent was accepted");
		await ctx.platform.db.execute(`INSERT INTO contract_fk_parent (id) VALUES ($1)`, [1]);
		await ctx.platform.db.execute(
			`INSERT INTO contract_fk_child (id, parent_id) VALUES ($1, $2)`,
			[1, 1],
		);
		await ctx.platform.db.execute(`DELETE FROM contract_fk_parent WHERE id = $1`, [1]);
		const rows = await ctx.platform.db.select(`SELECT id FROM contract_fk_child`);
		ctx.assert(rows.length === 0, "deleting the parent did not cascade");
	},

	"shell.run-stdout": async (ctx) => {
		const output = expectOk(
			ctx,
			await ctx.platform.shell.run({ program: "/bin/echo", args: ["hello"], cwd: ctx.root }),
			"shell.run",
		);
		ctx.assert(output.exitCode === 0, `exitCode was ${output.exitCode}`);
		ctx.assert(output.stdout === "hello\n", `stdout was ${JSON.stringify(output.stdout)}`);
	},

	"shell.run-nonzero": async (ctx) => {
		const output = expectOk(
			ctx,
			await ctx.platform.shell.run({
				program: "/bin/sh",
				args: ["-c", "printf oops >&2; exit 3"],
				cwd: ctx.root,
			}),
			"shell.run",
		);
		ctx.assert(output.exitCode === 3, `exitCode was ${output.exitCode}`);
		ctx.assert(output.stderr.includes("oops"), `stderr was ${output.stderr}`);
	},

	"shell.run-cwd-env-stdin": async (ctx) => {
		const cwd = ctx.path("cwd-case");
		expectOk(ctx, await ctx.platform.fs.mkdirp(cwd), "mkdirp");
		const marker = "contract-env";
		const stdin = "piped\n";
		const output = expectOk(
			ctx,
			await ctx.platform.shell.run({
				program: "/bin/sh",
				args: ["-c", 'printf "cwd=%s env=%s stdin=" "$PWD" "$CONDUCTED_CONTRACT"; cat'],
				cwd,
				env: { CONDUCTED_CONTRACT: marker },
				stdin,
			}),
			"shell.run",
		);
		ctx.assert(output.stdout.includes("cwd-case"), `cwd missing from ${output.stdout}`);
		ctx.assert(output.stdout.includes(`env=${marker}`), `env missing from ${output.stdout}`);
		ctx.assert(output.stdout.includes(`stdin=${stdin}`), `stdin missing from ${output.stdout}`);
	},

	"shell.run-timeout": async (ctx) => {
		const result = await ctx.platform.shell.run({
			program: "/bin/sleep",
			args: ["5"],
			cwd: ctx.root,
			timeoutMs: 30,
		});
		const error = expectErr(ctx, result, "a command that outlives its timeout");
		ctx.assert(error.code === "shell_timeout", `error code was ${error.code}`);
	},

	"shell.start-cancel": async (ctx) => {
		ctx.controls?.holdNextStart?.();
		const running = ctx.platform.shell.start({
			program: "/bin/sleep",
			args: ["5"],
			cwd: ctx.root,
		});
		await running.cancel();
		const error = expectErr(ctx, await running.done, "cancelled command");
		ctx.assert(error.code === "shell_cancelled", `the error code was ${error.code}`);
		await running.cancel();
	},

	"shell.no-shell-string": async (ctx) => {
		const argument = "two words 'quoted' $HOME";
		const output = expectOk(
			ctx,
			await ctx.platform.shell.run({ program: "/bin/echo", args: [argument], cwd: ctx.root }),
			"shell.run",
		);
		ctx.assert(
			output.stdout === `${argument}\n`,
			`the argument was changed: ${JSON.stringify(output.stdout)}`,
		);
	},

	"shell.login-env": async (ctx) => {
		const first = await ctx.platform.shell.loginEnv();
		const second = await ctx.platform.shell.loginEnv();
		ctx.assert(first.shell.length > 0, "the login shell is empty");
		ctx.assert(first.path.length > 0, "the login PATH is empty");
		ctx.assert(
			first.shell === second.shell && first.path === second.path,
			"loginEnv changed between calls",
		);
	},

	"fileSearch.list-tree-ignores": async (ctx) => {
		const root = ctx.path("tree");
		expectOk(ctx, await ctx.platform.fs.mkdirp(joinPath(root, ".git")), "mkdirp .git");
		expectOk(ctx, await ctx.platform.fs.mkdirp(joinPath(root, "src")), "mkdirp src");
		expectOk(
			ctx,
			await ctx.platform.fs.mkdirp(joinPath(root, "node_modules/pkg")),
			"mkdirp node_modules",
		);
		expectOk(
			ctx,
			await ctx.platform.fs.writeTextAtomic(joinPath(root, ".git/config"), "x"),
			"write .git/config",
		);
		expectOk(
			ctx,
			await ctx.platform.fs.writeTextAtomic(joinPath(root, "src/a.ts"), "a"),
			"write a.ts",
		);
		expectOk(
			ctx,
			await ctx.platform.fs.writeTextAtomic(joinPath(root, "ignored.txt"), "i"),
			"write ignored.txt",
		);
		expectOk(
			ctx,
			await ctx.platform.fs.writeTextAtomic(joinPath(root, "node_modules/pkg/index.js"), "j"),
			"write index.js",
		);
		expectOk(
			ctx,
			await ctx.platform.fs.writeTextAtomic(joinPath(root, "keep.md"), "k"),
			"write keep.md",
		);
		expectOk(
			ctx,
			await ctx.platform.fs.writeTextAtomic(
				joinPath(root, ".gitignore"),
				"ignored.txt\nnode_modules/\n",
			),
			"write .gitignore",
		);
		const entries = expectOk(ctx, await ctx.platform.fileSearch.listTree(root), "listTree");
		const paths = entries.map((entry) => entry.path);
		ctx.assert(paths.includes(joinPath(root, "src/a.ts")), "a normal file is missing");
		ctx.assert(paths.includes(joinPath(root, "keep.md")), "a normal file is missing");
		ctx.assert(!paths.some((path) => path.includes("/.git/")), "the .git folder was listed");
		ctx.assert(!paths.some((path) => path.endsWith("ignored.txt")), "an ignored file was listed");
		ctx.assert(
			!paths.some((path) => path.includes("node_modules")),
			"an ignored folder was listed",
		);
	},

	"fileSearch.fuzzy": async (ctx) => {
		const root = ctx.path("fuzzy");
		expectOk(ctx, await ctx.platform.fs.mkdirp(joinPath(root, "src")), "mkdirp");
		for (const [name, text] of [
			["alpha.ts", "a"],
			["src/alphabet.ts", "b"],
			["src/a-l-p-h-a.ts", "c"],
			["gamma.ts", "d"],
		] as const) {
			expectOk(
				ctx,
				await ctx.platform.fs.writeTextAtomic(joinPath(root, name), text),
				`write ${name}`,
			);
		}
		const results = expectOk(
			ctx,
			await ctx.platform.fileSearch.fuzzyMatch(root, "alpha", 2),
			"fuzzyMatch",
		);
		ctx.assert(results.length > 0 && results.length <= 2, "fuzzyMatch ignored the limit");
		ctx.assert(
			results[0]?.path.endsWith("alpha.ts") === true,
			`the best match was ${results[0]?.path}`,
		);
	},

	"fileSearch.grep-bad-regex": async (ctx) => {
		const result = await ctx.platform.fileSearch.grep(ctx.root, "(", {
			caseSensitive: false,
			wholeWord: false,
			regex: true,
			limit: 10,
		});
		const error = expectErr(ctx, result, "grep with a bad pattern");
		ctx.assert(
			error.message.startsWith("Invalid pattern"),
			`the message was ${JSON.stringify(error.message)}`,
		);
	},

	"fileSearch.list-artifacts": async (ctx) => {
		const workspace = ctx.path("artifacts-workspace");
		const context = joinPath(workspace, ".context");
		expectOk(ctx, await ctx.platform.fs.mkdirp(joinPath(context, "nested")), "mkdirp");
		expectOk(
			ctx,
			await ctx.platform.fs.writeTextAtomic(joinPath(context, "one.json"), "1"),
			"write one.json",
		);
		expectOk(
			ctx,
			await ctx.platform.fs.writeTextAtomic(joinPath(context, "nested/two.png"), "2"),
			"write two.png",
		);
		const first = expectOk(
			ctx,
			await ctx.platform.fileSearch.listArtifacts(workspace, { cursor: null, limit: 1 }),
			"first listArtifacts page",
		);
		ctx.assert(first.entries.length === 1, `the first page had ${first.entries.length} entries`);
		ctx.assert(first.nextCursor !== null, "the first page had no next cursor");
		const second = expectOk(
			ctx,
			await ctx.platform.fileSearch.listArtifacts(workspace, {
				cursor: first.nextCursor,
				limit: 10,
			}),
			"second listArtifacts page",
		);
		ctx.assert(second.entries.length === 1, `the second page had ${second.entries.length} entries`);
		ctx.assert(second.nextCursor === null, "the second page had a next cursor");
		ctx.assert(
			second.entries[0]?.path.startsWith(`${context}/`) === true,
			"an entry was outside the .context folder",
		);
	},

	"fileSearch.list-artifacts-files-only": async (ctx) => {
		const workspace = ctx.path("artifacts-files-only");
		const context = joinPath(workspace, ".context");
		expectOk(ctx, await ctx.platform.fs.mkdirp(joinPath(context, "empty")), "mkdirp empty");
		expectOk(ctx, await ctx.platform.fs.mkdirp(joinPath(context, "nested")), "mkdirp nested");
		expectOk(
			ctx,
			await ctx.platform.fs.writeTextAtomic(joinPath(context, "nested/two.png"), "2"),
			"write two.png",
		);
		const page = expectOk(
			ctx,
			await ctx.platform.fileSearch.listArtifacts(workspace, { cursor: null, limit: 1 }),
			"listArtifacts page",
		);
		const paths = page.entries.map((entry) => entry.path);
		ctx.assert(
			JSON.stringify(paths) === JSON.stringify([joinPath(context, "nested/two.png")]),
			`the page listed ${JSON.stringify(paths)}`,
		);
		ctx.assert(page.nextCursor === null, "a folder took a page slot");
	},

	"fileSearch.list-artifacts-exclusions": async (ctx) => {
		const workspace = ctx.path("artifacts-exclusions");
		const context = joinPath(workspace, ".context");
		const names = [
			"keep.md",
			"plans/todos.md",
			"todos.md",
			"conductor/settings.json",
			"pull-requests/1.md",
			"attachments/comments/1.md",
			"PR instructions.md",
			"[GITHUB]-12.md",
			"[LINEAR]-ABC-3.md",
			"terminal-output-1.txt",
		];
		for (const name of names) {
			const path = joinPath(context, name);
			expectOk(ctx, await ctx.platform.fs.mkdirp(path.slice(0, path.lastIndexOf("/"))), "mkdirp");
			expectOk(ctx, await ctx.platform.fs.writeTextAtomic(path, name), `write ${name}`);
		}
		const page = expectOk(
			ctx,
			await ctx.platform.fileSearch.listArtifacts(workspace, { cursor: null, limit: 50 }),
			"listArtifacts page",
		);
		const listed = page.entries.map((entry) => entry.path.slice(context.length + 1)).sort();
		ctx.assert(
			JSON.stringify(listed) === JSON.stringify(["keep.md", "plans/todos.md"]),
			`the page listed ${JSON.stringify(listed)}`,
		);
		ctx.assert(page.omitted === 8, `omitted was ${page.omitted}`);
	},

	"fileSearch.list-artifacts-omitted": async (ctx) => {
		const workspace = ctx.path("artifacts-omitted");
		const context = joinPath(workspace, ".context");
		expectOk(ctx, await ctx.platform.fs.mkdirp(joinPath(context, "conductor")), "mkdirp");
		for (const name of ["one.md", "two.md", "three.md", "todos.md", "conductor/settings.json"]) {
			expectOk(
				ctx,
				await ctx.platform.fs.writeTextAtomic(joinPath(context, name), name),
				`write ${name}`,
			);
		}
		const first = expectOk(
			ctx,
			await ctx.platform.fileSearch.listArtifacts(workspace, { cursor: null, limit: 2 }),
			"first listArtifacts page",
		);
		const second = expectOk(
			ctx,
			await ctx.platform.fileSearch.listArtifacts(workspace, {
				cursor: first.nextCursor,
				limit: 2,
			}),
			"second listArtifacts page",
		);
		ctx.assert(
			first.entries.length === 2 && second.entries.length === 1,
			`the pages had ${first.entries.length} and ${second.entries.length} entries`,
		);
		ctx.assert(
			first.omitted === 2 && second.omitted === 2,
			`omitted was ${first.omitted} and then ${second.omitted}`,
		);
	},

	"pty.spawn-echo": async (ctx) => {
		const handle = expectOk(
			ctx,
			await ctx.platform.pty.spawn({ cwd: ctx.root, cols: 80, rows: 24 }),
			"pty.spawn",
		);
		const decoder = new TextDecoder();
		const text = await waitForEvent<string>(
			ctx,
			(listener) =>
				handle.onData((chunk) => {
					const decoded = decoder.decode(chunk);
					if (decoded.includes("contract")) listener(decoded);
				}),
			async () => {
				await handle.write("echo contract\n");
			},
			"pty data",
		);
		ctx.assert(text.includes("contract"), `pty output was ${JSON.stringify(text)}`);
		handle.ack(new TextEncoder().encode(text).length);
		await handle.kill();
	},

	"pty.exit-code": async (ctx) => {
		const handle = expectOk(
			ctx,
			await ctx.platform.pty.spawn({ cwd: ctx.root, cols: 80, rows: 24 }),
			"pty.spawn",
		);
		const early: (number | null)[] = [];
		const stopEarly = handle.onExit((code) => early.push(code));
		const code = await waitForEvent<number | null>(
			ctx,
			(listener) => handle.onExit(listener),
			async () => {
				await handle.kill();
			},
			"pty exit after kill",
		);
		const late = await waitForEvent<number | null>(
			ctx,
			(listener) => handle.onExit(listener),
			() => {},
			"pty exit heard by a late listener",
		);
		stopEarly();
		ctx.assert(early.length === 1, `the early listener heard ${early.length} exits`);
		ctx.assert(
			early[0] === code,
			`the early listener heard ${String(early[0])} and another heard ${String(code)}`,
		);
		ctx.assert(late === code, `the late listener heard ${String(late)}, not ${String(code)}`);
	},

	"pty.screen-text": async (ctx) => {
		const handle = expectOk(
			ctx,
			await ctx.platform.pty.spawn({ cwd: ctx.root, cols: 80, rows: 24 }),
			"pty.spawn",
		);
		const decoder = new TextDecoder();
		await waitForEvent<string>(
			ctx,
			(listener) =>
				handle.onData((chunk) => {
					const decoded = decoder.decode(chunk);
					if (decoded.includes("hello screen")) listener(decoded);
				}),
			async () => {
				await handle.write("hello screen\n");
			},
			"pty data",
		);
		const text = await handle.screenText(100);
		ctx.assert(text.includes("hello screen"), `screenText was ${JSON.stringify(text)}`);
		ctx.assert(!text.includes(String.fromCharCode(27)), "screenText kept escape codes");
		await handle.kill();
	},

	"pty.kill": async (ctx) => {
		const handle = expectOk(
			ctx,
			await ctx.platform.pty.spawn({ cwd: ctx.root, cols: 80, rows: 24 }),
			"pty.spawn",
		);
		const code = await waitForEvent<number | null>(
			ctx,
			(listener) => handle.onExit(listener),
			async () => {
				await handle.kill();
			},
			"pty exit after kill",
		);
		ctx.assert(code === null || code !== 0, `a killed process reported exit ${String(code)}`);
		await handle.write("after kill\n");
	},

	"sidecar.ensure-started-twice": async (ctx) => {
		expectOk(ctx, await ctx.platform.sidecar.ensureStarted(), "first ensureStarted");
		expectOk(ctx, await ctx.platform.sidecar.ensureStarted(), "second ensureStarted");
	},

	"sidecar.send-before-start": async (ctx) => {
		const result = await ctx.platform.sidecar.send('{"jsonrpc":"2.0"}');
		ctx.assert(!result.ok, "send before start returned Ok");
	},

	"sidecar.line-roundtrip": async (ctx) => {
		expectOk(ctx, await ctx.platform.sidecar.ensureStarted(), "ensureStarted");
		// With controls the outside world sends the line; without them the loopback child echoes it.
		const deliver = async (line: string): Promise<void> => {
			if (ctx.controls?.emitSidecarLine !== undefined) {
				await ctx.controls.emitSidecarLine(line);
				return;
			}
			expectOk(ctx, await ctx.platform.sidecar.send(line), "send");
		};
		const deliverAndWait = (line: string): Promise<string> =>
			waitForEvent<string>(
				ctx,
				(listener) =>
					ctx.platform.sidecar.onLine((heard) => {
						if (heard === line) listener(heard);
					}),
				() => deliver(line),
				`sidecar line ${line}`,
			);
		const first: string[] = [];
		const second: string[] = [];
		const stopFirst = ctx.platform.sidecar.onLine((line) => first.push(line));
		const stopSecond = ctx.platform.sidecar.onLine((line) => second.push(line));
		try {
			await deliverAndWait("alpha");
			await deliverAndWait("beta");
			ctx.assert(
				first.join(",") === "alpha,beta" && second.join(",") === "alpha,beta",
				`the listeners heard ${first.join(",")} and ${second.join(",")}`,
			);
			stopFirst();
			await deliverAndWait("gamma");
			ctx.assert(
				first.join(",") === "alpha,beta",
				`a listener heard ${first.join(",")} after it unsubscribed`,
			);
			ctx.assert(second.join(",") === "alpha,beta,gamma", `the other heard ${second.join(",")}`);
		} finally {
			stopFirst();
			stopSecond();
		}
	},

	"sidecar.restart-signal": async (ctx) => {
		const emit = ctx.controls?.emitSidecarRestart;
		ctx.assert(emit !== undefined, "the controls do not expose emitSidecarRestart");
		if (emit === undefined) return;
		const restarted = (): Promise<void> =>
			waitForEvent<void>(
				ctx,
				(listener) => ctx.platform.sidecar.onRestart(() => listener()),
				() => emit(),
				"sidecar restart",
			);
		expectOk(ctx, await ctx.platform.sidecar.ensureStarted(), "ensureStarted");
		const heard: number[] = [];
		const stop = ctx.platform.sidecar.onRestart(() => heard.push(1));
		try {
			await restarted();
			ctx.assert(heard.length === 1, `onRestart fired ${heard.length} times`);
			stop();
			expectOk(ctx, await ctx.platform.sidecar.ensureStarted(), "ensureStarted after the restart");
			// The waiting listener below hears the second restart, so the first one is done by then.
			await restarted();
			ctx.assert(heard.length === 1, "a listener fired after unsubscribe");
		} finally {
			stop();
		}
	},

	"keychain.roundtrip": async (ctx) => {
		const key = "contract-key";
		const missing = expectOk(ctx, await ctx.platform.keychain.get(key), "get missing");
		ctx.assert(missing === null, "a missing secret did not read as null");
		expectOk(ctx, await ctx.platform.keychain.set(key, "secret"), "set");
		ctx.assert(
			expectOk(ctx, await ctx.platform.keychain.get(key), "get") === "secret",
			"get did not return the value",
		);
		expectOk(ctx, await ctx.platform.keychain.delete(key), "delete");
		ctx.assert(
			expectOk(ctx, await ctx.platform.keychain.get(key), "get after delete") === null,
			"get after delete was not null",
		);
		expectOk(ctx, await ctx.platform.keychain.delete(key), "delete missing");
	},

	"notifications.badge": async (ctx) => {
		await ctx.platform.notifications.setDockBadge(3);
		ctx.assert(
			ctx.controls?.dockBadge === 3,
			`the layer below recorded ${String(ctx.controls?.dockBadge)}`,
		);
		await ctx.platform.notifications.setDockBadge(null);
		ctx.assert(ctx.controls?.dockBadge === null, "the layer below kept an old badge");
	},

	"notifications.click": async (ctx) => {
		const emit = ctx.controls?.emitNotificationClick;
		ctx.assert(emit !== undefined, "the controls do not expose emitNotificationClick");
		if (emit === undefined) return;
		const received: string[] = [];
		const link = "conducted://workspace/1";
		const heard = await waitForEvent<string>(
			ctx,
			(listener) =>
				ctx.platform.notifications.onClicked((deepLink) => {
					received.push(deepLink);
					listener(deepLink);
				}),
			() => emit(link),
			"notification click",
		);
		ctx.assert(heard === link, `onClicked heard ${heard}`);
		// waitForEvent has unsubscribed the listener, so this click must not reach it.
		await emit("conducted://workspace/2");
		await oneMacrotask();
		ctx.assert(
			received.length === 1,
			`the listener heard ${JSON.stringify(received)} after it unsubscribed`,
		);
	},

	"clipboard.write-text": async (ctx) => {
		await ctx.platform.clipboard.writeText("copied text");
		ctx.assert(
			ctx.controls?.clipboardText === "copied text",
			`clipboard kept ${JSON.stringify(ctx.controls?.clipboardText)}`,
		);
	},

	"app.health": async (ctx) => {
		expectOk(ctx, await ctx.platform.app.health(), "health");
	},

	"app.write-log-never-throws": async (ctx) => {
		const circular: Record<string, unknown> = {};
		circular.self = circular;
		let threw = false;
		try {
			ctx.platform.app.writeLog("info", "contract", circular);
		} catch {
			threw = true;
		}
		ctx.assert(!threw, "writeLog threw on a value that cannot be serialised");
	},

	"app.version": async (ctx) => {
		ctx.assert(ctx.platform.app.version.length > 0, "the version is empty");
		ctx.assert(
			ctx.platform.app.channel === "dev" || ctx.platform.app.channel === "release",
			`the channel is ${ctx.platform.app.channel}`,
		);
	},

	"dialogs.pick-folder": async (ctx) => {
		ctx.controls?.queueDialogAnswers?.({ folder: "/picked/folder" });
		const folder = await ctx.platform.dialogs.pickFolder({ title: "Pick a folder" });
		ctx.assert(folder === "/picked/folder", `pickFolder returned ${JSON.stringify(folder)}`);
		ctx.controls?.queueDialogAnswers?.({ folder: null });
		const cancelled = await ctx.platform.dialogs.pickFolder({ title: "Pick a folder" });
		ctx.assert(cancelled === null, `a cancelled dialog returned ${JSON.stringify(cancelled)}`);
	},

	"dialogs.pick-files": async (ctx) => {
		ctx.controls?.queueDialogAnswers?.({ files: ["/a.txt", "/b.txt"] });
		const files = await ctx.platform.dialogs.pickFiles({ title: "Pick files", multiple: true });
		ctx.assert(
			files.length === 2 && files[0] === "/a.txt" && files[1] === "/b.txt",
			`pickFiles returned ${JSON.stringify(files)}`,
		);
		ctx.controls?.queueDialogAnswers?.({ files: ["/only.txt"] });
		const one = await ctx.platform.dialogs.pickFiles({ title: "Pick a file", multiple: false });
		ctx.assert(
			one.length === 1 && one[0] === "/only.txt",
			`one picked file came back as ${JSON.stringify(one)}`,
		);
		ctx.controls?.queueDialogAnswers?.({ files: [] });
		const none = await ctx.platform.dialogs.pickFiles({ title: "Pick files", multiple: true });
		ctx.assert(none.length === 0, `a cancelled dialog returned ${JSON.stringify(none)}`);
	},

	"dialogs.confirm": async (ctx) => {
		ctx.controls?.queueDialogAnswers?.({ confirm: true });
		const yes = await ctx.platform.dialogs.confirm({
			title: "Confirm",
			message: "Continue?",
			okLabel: "Yes",
		});
		ctx.assert(yes === true, "confirm did not return the scripted yes");
		ctx.controls?.queueDialogAnswers?.({ confirm: false });
		const no = await ctx.platform.dialogs.confirm({
			title: "Confirm",
			message: "Continue?",
			okLabel: "Yes",
		});
		ctx.assert(no === false, "confirm did not return the scripted no");
	},

	"opener.installed-apps": async (ctx) => {
		const apps = await ctx.platform.opener.installedApps();
		ctx.assert(Array.isArray(apps), "installedApps did not return a list");
		ctx.assert(
			apps.every((name) => name.length > 0),
			`installedApps returned an empty name: ${JSON.stringify(apps)}`,
		);
	},

	"speech.available": async (ctx) => {
		const available = await ctx.platform.speech.available();
		ctx.assert(typeof available === "boolean", `available returned ${String(available)}`);
	},

	"speech.stop-ends": async (ctx) => {
		const events: SpeechEvent[] = [];
		const started = await ctx.platform.speech.start((event) => events.push(event));
		expectOk(ctx, started, "speech.start");
		await ctx.platform.speech.stop();
		ctx.assert(
			events.some((event) => event.kind === "ended"),
			`speech.stop sent ${JSON.stringify(events)}`,
		);
	},

	"updater.check": async (ctx) => {
		const value = expectOk(ctx, await ctx.platform.updater.check(), "updater.check");
		ctx.assert(
			value === null || value.version.length > 0,
			`check returned ${JSON.stringify(value)}`,
		);
	},

	"updater.installed-update": async (ctx) => {
		const value = expectOk(
			ctx,
			await ctx.platform.updater.installedUpdate(),
			"updater.installedUpdate",
		);
		ctx.assert(
			value === null || value.version.length > 0,
			`installedUpdate returned ${JSON.stringify(value)}`,
		);
	},

	"window.is-focused": async (ctx) => {
		const focused = await ctx.platform.window.isFocused();
		ctx.assert(typeof focused === "boolean", `isFocused returned ${String(focused)}`);
	},

	"window.focus-events": async (ctx) => {
		const emit = ctx.controls?.emitWindowFocus;
		ctx.assert(emit !== undefined, "the controls do not expose emitWindowFocus");
		if (emit === undefined) return;
		const seen: boolean[] = [];
		const stop = ctx.platform.window.onFocusChanged((focused) => seen.push(focused));
		await emit(true);
		await emit(false);
		ctx.assert(seen.join(",") === "true,false", `the listener saw ${seen.join(",")}`);
		ctx.assert(!(await ctx.platform.window.isFocused()), "isFocused kept the old focus");
		stop();
		await emit(true);
		ctx.assert(seen.length === 2, "a listener kept running after it was removed");
	},

	"window.setters": async (ctx) => {
		expectOk(ctx, await ctx.platform.window.setZoom(1.25), "setZoom");
		expectOk(ctx, await ctx.platform.window.setVibrancy(true), "setVibrancy");
		expectOk(
			ctx,
			await ctx.platform.window.setTrafficLightPosition(12, 12),
			"setTrafficLightPosition",
		);
		await ctx.platform.window.setTheme(null);
	},

	"menu.set-shortcuts": async (ctx) => {
		const result = expectOk(
			ctx,
			await ctx.platform.menu.setShortcuts([
				{ commandId: "view.toggleLeftSidebar", accelerator: "CmdOrCtrl+B" },
				{ commandId: "help.documentation", accelerator: null },
			]),
			"menu.setShortcuts",
		);
		ctx.assert(
			result.applied.includes("view.toggleLeftSidebar"),
			`applied was ${JSON.stringify(result.applied)}`,
		);
		ctx.assert(result.rejected.length === 0, `rejected was ${JSON.stringify(result.rejected)}`);
	},

	"system.info": async (ctx) => {
		const info = await ctx.platform.system.info();
		ctx.assert(/^\d+\./.test(info.osVersion), `osVersion was ${JSON.stringify(info.osVersion)}`);
		ctx.assert(
			info.machineArch === "arm64" || info.machineArch === "x86_64",
			`machineArch was ${info.machineArch}`,
		);
		ctx.assert(
			info.buildArch === "arm64" || info.buildArch === "x86_64",
			`buildArch was ${info.buildArch}`,
		);
	},

	"system.online-and-access": async (ctx) => {
		const online = await ctx.platform.system.isOnline();
		ctx.assert(typeof online === "boolean", `isOnline returned ${String(online)}`);
		const access = await ctx.platform.system.hasFullDiskAccess();
		ctx.assert(typeof access === "boolean", `hasFullDiskAccess returned ${String(access)}`);
	},

	"attachments.materialize": async (ctx) => {
		const source = ctx.path("attachments/source.txt");
		const destination = ctx.path("attachments/destination.txt");
		const text = "copied attachment";
		expectOk(ctx, await ctx.platform.fs.mkdirp(ctx.path("attachments")), "mkdirp");
		expectOk(ctx, await ctx.platform.fs.writeTextAtomic(source, text), "write source");
		const file = expectOk(
			ctx,
			await ctx.platform.attachments.materialize(source, destination, { resizeImage: false }),
			"materialize",
		);
		ctx.assert(file.path === destination, `materialize returned ${file.path}`);
		ctx.assert(
			file.sizeBytes === new TextEncoder().encode(text).length,
			`sizeBytes was ${file.sizeBytes}`,
		);
		ctx.assert(
			expectOk(ctx, await ctx.platform.fs.readText(destination), "read destination") === text,
			"the copy holds different text",
		);
	},

	"attachments.resize-image": async (ctx) => {
		const source = ctx.path("attachments/image.png");
		const destination = ctx.path("attachments/image-small.png");
		expectOk(ctx, await ctx.platform.fs.mkdirp(ctx.path("attachments")), "mkdirp");
		expectOk(ctx, await ctx.platform.fs.writeTextAtomic(source, "pixels"), "write source");
		const file = expectOk(
			ctx,
			await ctx.platform.attachments.resizeImage(source, destination),
			"resizeImage",
		);
		ctx.assert(file.path === destination, `resizeImage returned ${file.path}`);
		ctx.assert(await ctx.platform.fs.exists(destination), "the resized copy is missing");
	},

	"programs.install-status": async (ctx) => {
		const events: ProgramStatus[] = [];
		const unsubscribe = ctx.platform.programs.onStatus((status) => events.push(status));
		expectOk(ctx, await ctx.platform.programs.install("claude"), "install");
		unsubscribe();
		const statuses = expectOk(ctx, await ctx.platform.programs.statuses(), "statuses");
		const claude = statuses.find((status) => status.program === "claude");
		ctx.assert(claude?.state === "ready", `claude state was ${claude?.state}`);
		ctx.assert(claude?.path !== null, "the ready status has no path");
		ctx.assert(
			events.some((status) => status.program === "claude" && status.state === "ready"),
			"onStatus did not report the install",
		);
	},

	"programs.remove-status": async (ctx) => {
		expectOk(ctx, await ctx.platform.programs.install("codex"), "install");
		expectOk(ctx, await ctx.platform.programs.remove("codex"), "remove");
		const statuses = expectOk(ctx, await ctx.platform.programs.statuses(), "statuses");
		const codex = statuses.find((status) => status.program === "codex");
		ctx.assert(codex?.state === "missing", `codex state was ${codex?.state}`);
		ctx.assert(codex?.path === null, `codex path was ${String(codex?.path)}`);
	},

	"http.invalid-url": async (ctx) => {
		const error = expectErr(
			ctx,
			await ctx.platform.http.fetch({ url: "not a url", method: "GET" }),
			"fetch with an invalid URL",
		);
		ctx.assert(error.message.length > 0, "the error has no message");
	},
};

export interface ContractOptions {
	/**
	 * True when the factory exposes the outside-event controls these cases need. A run without
	 * them skips the cases marked `needs: "controls"`, and says so.
	 */
	controls: boolean;
	/**
	 * Cases this run cannot run honestly, by case id, each with the reason. The harness prints
	 * every one as skipped. An id that names no case is a programmer error.
	 */
	skips?: Readonly<Record<string, string>>;
	/** Replaces the method list of the named cases. Only a test of this check needs it. */
	methods?: Readonly<Record<string, readonly string[]>>;
}

/** The handle types some methods return. Their methods count as Platform methods too. */
export const HANDLE_METHODS: readonly string[] = [
	"pty.handle.write",
	"pty.handle.resize",
	"pty.handle.kill",
	"pty.handle.onData",
	"pty.handle.ack",
	"pty.handle.onExit",
	"pty.handle.screenText",
	"pty.handle.screenSnapshot",
	"shell.running.cancel",
	"http.download.cancel",
];

/** Which method returns which handle, so a call on the handle is recorded under its own name. */
const HANDLE_OF: Readonly<Record<string, string>> = {
	"pty.spawn": "pty.handle",
	"shell.start": "shell.running",
	"http.download": "http.download",
};

/**
 * The Platform methods each case must call. The run records the calls and fails a case that
 * skipped one, so a name here is a fact and not a wish.
 */
export const CASE_METHODS: Readonly<Record<string, readonly string[]>> = {
	"fs.write-read": ["fs.mkdirp", "fs.writeTextAtomic", "fs.readText"],
	"fs.atomic-no-partial": ["fs.writeTextAtomic", "fs.mkdirp", "fs.readText", "fs.readDir"],
	"fs.missing-file": ["fs.readText"],
	"fs.exists-stat": ["fs.writeTextAtomic", "fs.mkdirp", "fs.exists", "fs.stat"],
	"fs.mkdirp-idempotent": ["fs.mkdirp", "fs.exists"],
	"fs.read-dir": ["fs.mkdirp", "fs.writeTextAtomic", "fs.readDir"],
	"fs.dot-segments": ["fs.mkdirp", "fs.writeTextAtomic", "fs.exists", "fs.readText"],
	"fs.trash": ["fs.mkdirp", "fs.writeTextAtomic", "fs.trash", "fs.exists"],
	"db.roundtrip": ["db.execute", "db.select"],
	"db.rows-affected": ["db.execute"],
	"db.transaction-commit": ["db.execute", "db.transaction", "db.select"],
	"db.transaction-rollback": ["db.execute", "db.transaction", "db.select"],
	"db.transaction-serialised": ["db.execute", "db.transaction"],
	"db.foreign-keys": ["db.execute", "db.select"],
	"shell.run-stdout": ["shell.run"],
	"shell.run-nonzero": ["shell.run"],
	"shell.run-cwd-env-stdin": ["fs.mkdirp", "shell.run"],
	"shell.run-timeout": ["shell.run"],
	"shell.start-cancel": ["shell.start", "shell.running.cancel"],
	"shell.no-shell-string": ["shell.run"],
	"shell.login-env": ["shell.loginEnv"],
	"fileSearch.list-tree-ignores": ["fs.mkdirp", "fs.writeTextAtomic", "fileSearch.listTree"],
	"fileSearch.fuzzy": ["fs.mkdirp", "fs.writeTextAtomic", "fileSearch.fuzzyMatch"],
	"fileSearch.grep-bad-regex": ["fileSearch.grep"],
	"fileSearch.list-artifacts": ["fs.mkdirp", "fs.writeTextAtomic", "fileSearch.listArtifacts"],
	"fileSearch.list-artifacts-files-only": [
		"fs.mkdirp",
		"fs.writeTextAtomic",
		"fileSearch.listArtifacts",
	],
	"fileSearch.list-artifacts-exclusions": [
		"fs.mkdirp",
		"fs.writeTextAtomic",
		"fileSearch.listArtifacts",
	],
	"fileSearch.list-artifacts-omitted": [
		"fs.mkdirp",
		"fs.writeTextAtomic",
		"fileSearch.listArtifacts",
	],
	"pty.spawn-echo": [
		"pty.spawn",
		"pty.handle.write",
		"pty.handle.onData",
		"pty.handle.ack",
		"pty.handle.kill",
	],
	"pty.exit-code": ["pty.spawn", "pty.handle.onExit", "pty.handle.kill"],
	"pty.screen-text": [
		"pty.spawn",
		"pty.handle.onData",
		"pty.handle.write",
		"pty.handle.screenText",
	],
	"pty.kill": ["pty.spawn", "pty.handle.onExit", "pty.handle.kill", "pty.handle.write"],
	"sidecar.ensure-started-twice": ["sidecar.ensureStarted"],
	"sidecar.send-before-start": ["sidecar.send"],
	"sidecar.line-roundtrip": ["sidecar.ensureStarted", "sidecar.onLine"],
	"sidecar.restart-signal": ["sidecar.ensureStarted", "sidecar.onRestart"],
	"keychain.roundtrip": ["keychain.get", "keychain.set", "keychain.delete"],
	"notifications.badge": ["notifications.setDockBadge"],
	"notifications.click": ["notifications.onClicked"],
	"clipboard.write-text": ["clipboard.writeText"],
	"app.health": ["app.health"],
	"app.write-log-never-throws": ["app.writeLog"],
	"app.version": [],
	"dialogs.pick-folder": ["dialogs.pickFolder"],
	"dialogs.pick-files": ["dialogs.pickFiles"],
	"dialogs.confirm": ["dialogs.confirm"],
	"opener.installed-apps": ["opener.installedApps"],
	"speech.available": ["speech.available"],
	"speech.stop-ends": ["speech.start", "speech.stop"],
	"updater.check": ["updater.check"],
	"updater.installed-update": ["updater.installedUpdate"],
	"window.is-focused": ["window.isFocused"],
	"window.focus-events": ["window.onFocusChanged", "window.isFocused"],
	"window.setters": [
		"window.setZoom",
		"window.setVibrancy",
		"window.setTrafficLightPosition",
		"window.setTheme",
	],
	"menu.set-shortcuts": ["menu.setShortcuts"],
	"system.info": ["system.info"],
	"system.online-and-access": ["system.isOnline", "system.hasFullDiskAccess"],
	"attachments.materialize": [
		"fs.mkdirp",
		"fs.writeTextAtomic",
		"attachments.materialize",
		"fs.readText",
	],
	"attachments.resize-image": [
		"fs.mkdirp",
		"fs.writeTextAtomic",
		"attachments.resizeImage",
		"fs.exists",
	],
	"programs.install-status": ["programs.onStatus", "programs.install", "programs.statuses"],
	"programs.remove-status": ["programs.install", "programs.remove", "programs.statuses"],
	"http.invalid-url": ["http.fetch"],
};

/**
 * Platform methods no case calls, each with the reason. A method that a case calls must not be
 * listed here, and a method that is neither listed nor called fails the coverage test.
 */
export const UNCOVERED_METHODS: Readonly<Record<string, string>> = {
	"pty.loadHistory":
		"Needs a terminal that ended and left saved scrollback; the history file is written by Rust (terminal_history.rs).",
	"pty.handle.resize":
		"Resizing changes a real terminal's size, which no stand-in can show; the Rust pty tests own it.",
	"pty.handle.screenSnapshot":
		"The escape sequences come from the Rust terminal emulator; a stand-in would only echo its own output.",
	"sidecar.logPath": "The path is chosen by Rust at startup; no behaviour to compare yet.",
	"notifications.notify":
		"Showing a native notification checks the system permission; only a real macOS run can.",
	"dialogs.pickSavePath":
		"Same shape as pickFolder; add it with the first caller that needs a save dialog.",
	"opener.openUrl": "Opens the default browser; nothing a stand-in can show.",
	"opener.revealInFinder": "Opens Finder; nothing a stand-in can show.",
	"opener.openWith": "Starts another app; the Rust open_with tests own it.",
	"clipboard.writeImage":
		"Decodes a PNG in the web view's canvas, which Node does not have; needs the launched app.",
	"speech.cancel": "Apple dictation; the node bindings have no microphone or recognizer.",
	"updater.install": "Downloads and installs an update; needs a signed release feed.",
	"updater.relaunch": "Restarts the app; cannot run inside a test.",
	"app.dbVersionWarning": "PLAT-17 builds it.",
	"app.onDeepLink": "PLAT-16 builds it.",
	"app.onQuitRequested": "Needs the Rust quit hook; the Rust job owns it.",
	"app.quit": "Quits the app; cannot run inside a test.",
	"app.resourceUsage": "PLAT-14 builds it.",
	"app.setLogLevel": "Changes the Rust logger; the Rust logger tests own it.",
	"app.exportLogs": "Zips the Rust log folder; the Rust logger tests own it.",
	"app.setQuitHandlerReady": "Needs the Rust quit hook; the Rust job owns it.",
	"window.onFileDrop": "Needs a real window drag; the Tauri adapter tests own the event mapping.",
	"window.toggleInspector": "Opens the web inspector; nothing a stand-in can show.",
	"menu.onCommand": "Needs a real menu; the Tauri adapter tests own the event door.",
	"system.onNetworkChanged": "PLAT-26 builds it.",
	"system.openFullDiskAccessSettings": "Opens System Settings; nothing a stand-in can show.",
	"programs.redownload":
		"Uses the same install path as programs.install, which the install-status case covers.",
	"programs.prefetchForUpdate":
		"Starts installs in the background with no answer to compare; the plugin's install path is covered.",
	"programs.verificationErrors": "Reads the Rust launch check; the Rust job owns it.",
	"programs.syncPathOverrides": "SET-13 builds it.",
	"http.download":
		"Streams to a file in Rust; the Rust download tests own progress, checksum and cancel.",
	"http.download.cancel": "Cancels the Rust download task by id; the Rust download tests own it.",
};

/** Methods that are neither covered by a case nor listed with a reason. */
export function methodsWithoutCoverage(
	allMethods: readonly string[],
	caseMethods: Readonly<Record<string, readonly string[]>> = CASE_METHODS,
	uncovered: Readonly<Record<string, string>> = UNCOVERED_METHODS,
): string[] {
	const covered = new Set(Object.values(caseMethods).flat());
	return allMethods.filter((method) => !covered.has(method) && !(method in uncovered));
}

/**
 * Wraps a platform so every call is recorded under "group.method", and a call on a handle that a
 * method returns is recorded under the handle's own name.
 */
function recordCalls(platform: Platform, called: Set<string>): Platform {
	const wrapObject = <T extends object>(prefix: string, target: T): T =>
		new Proxy(target, {
			get(object, property, receiver) {
				const value = Reflect.get(object, property, receiver) as unknown;
				if (typeof property !== "string" || typeof value !== "function") return value;
				return (...args: unknown[]) => {
					const name = `${prefix}.${property}`;
					called.add(name);
					const result = (value as (...rest: unknown[]) => unknown).apply(object, args);
					const handlePrefix = HANDLE_OF[name];
					if (handlePrefix === undefined) return result;
					if (result instanceof Promise) {
						return result.then((settled: unknown) => {
							const wrapped = settled as { ok?: boolean; value?: object };
							return wrapped.ok === true && wrapped.value !== undefined
								? { ...wrapped, value: wrapObject(handlePrefix, wrapped.value) }
								: settled;
						});
					}
					return wrapObject(handlePrefix, result as object);
				};
			},
		});
	const wrapped: Record<string, unknown> = {};
	for (const [group, value] of Object.entries(platform)) {
		wrapped[group] = wrapObject(group, value as object);
	}
	return wrapped as unknown as Platform;
}

/**
 * Registers one test per case. Each test builds a fresh platform with `create`, runs the case's
 * steps, checks that the case called every method it names, and calls `cleanup`. `kind` names the
 * implementation in the test titles. A case this run cannot run is registered as skipped with its
 * reason, so the output counts it.
 */
export function runPlatformContract(
	harness: ContractHarness,
	kind: "memory" | "tauri",
	create: () => Promise<PlatformUnderTest>,
	options: ContractOptions,
): void {
	const hasControls = options.controls;
	const skips = options.skips ?? {};
	const caseMethods = { ...CASE_METHODS, ...options.methods };
	const caseIds = new Set(PLATFORM_CONTRACT_CASES.map((testCase) => testCase.id));
	for (const id of Object.keys(skips)) {
		if (!caseIds.has(id)) throw new Error(`The ${kind} run skips ${id}, which is not a case.`);
	}
	harness.describe(`PLAT-01 platform contract (${kind})`, () => {
		for (const testCase of PLATFORM_CONTRACT_CASES) {
			const step = STEPS[testCase.id];
			if (step === undefined) {
				throw new Error(`No steps are registered for contract case ${testCase.id}.`);
			}
			const methods = caseMethods[testCase.id];
			if (methods === undefined) {
				throw new Error(`Contract case ${testCase.id} names no methods in CASE_METHODS.`);
			}
			const title = `${testCase.id}: ${testCase.title}`;
			const skipReason =
				skips[testCase.id] ??
				(testCase.needs === "controls" && !hasControls ? "needs scripted controls" : null);
			if (skipReason !== null) {
				if (harness.skip === undefined) {
					throw new Error(`The ${kind} harness cannot skip ${testCase.id}: ${skipReason}.`);
				}
				harness.skip(title, skipReason);
				continue;
			}
			harness.it(title, async () => {
				const underTest = await create();
				const called = new Set<string>();
				const context: ContractContext = {
					platform: recordCalls(underTest.platform, called),
					kind,
					root: underTest.root,
					controls: underTest.controls,
					assert: harness.assert,
					path: (name) => joinPath(underTest.root, name),
				};
				try {
					await step(context);
					const missed = methods.filter((method) => !called.has(method));
					context.assert(
						missed.length === 0,
						`${testCase.id} did not call ${missed.join(", ")}, which CASE_METHODS says it does`,
					);
				} finally {
					await underTest.cleanup();
				}
			});
		}
	});
}
