/**
 * @feature PLAT-01 Platform contract: one list of behaviours both implementations must show
 * Owns: the list of behaviours of the Platform interface (as data) and the function that turns
 * the list into tests. The in-memory stand-in (memory.ts) and the Tauri implementation (tauri.ts)
 * must both pass it, so a service tested on the stand-in behaves the same on the real thing.
 * Behaviour: services-map.md 1.1 (Platform object), native-and-sidecar-map.md A2 (what each
 * Rust command promises), docs/plans/tauri-commands.md.
 * Must handle: every case builds its own Platform and cleans it up, even when the case fails (no
 * temp folders, scratch databases or processes left behind); cases that need a real operating
 * system (pty, keychain, trash) are marked `needs: "os"` so the stand-in may run them against its
 * own model while the Tauri run uses a scratch folder; no case waits a fixed time (they wait for
 * events); a case that needs the sidecar uses a loopback echo child, never a real agent.
 * Our design choice: the harness (`describe`, `it`, `assert`) is passed in, so this file imports
 * no test framework and can sit in `src/`. Cases are plain data, so a missing group shows up as a
 * missing case in review.
 * Test first: the in-memory Platform passes "fs: write then read returns the same text".
 */
import { type AppError, appError, err, ok, type Result } from "@conducted/shared";
import type { ShellScript } from "./memory.ts";
import type { Platform, Unsubscribe } from "./platform.ts";

export type ContractGroup = keyof Platform;

export interface ContractCase {
	/** Stable id, "<group>.<name>". */
	id: string;
	group: ContractGroup;
	title: string;
	/** What must hold, in one or two sentences. */
	behaviour: string;
	/** "os" cases need a real operating system on the Tauri side. */
	needs: "none" | "os";
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
		"cancel() ends the process; done resolves with Ok and a signal exit, and a second cancel() is harmless.",
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
		"pty",
		"spawn-echo",
		"spawn, write, read output",
		"Writing a line to a spawned shell produces output through onData; ack() lets more flow.",
		"os",
	),
	c(
		"pty",
		"exit-code",
		"onExit reports the exit code",
		"A command that exits 5 calls onExit(5) once.",
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
		"A line passed to send() is delivered to onLine listeners after the child echoes it; listeners stop after unsubscribe.",
		"os",
	),
	c(
		"sidecar",
		"restart-signal",
		"onRestart fires when the process exits",
		"Killing the child calls onRestart listeners once.",
		"os",
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
		"setDockBadge(3) then setDockBadge(null) both resolve; the stand-in records the last value.",
	),
	c(
		"notifications",
		"click",
		"a click calls onClicked with the deep link",
		"Clicking a notification that carried deepLink X calls listeners with X; listeners stop after unsubscribe.",
	),
	c(
		"clipboard",
		"write-text",
		"writeText stores text",
		"writeText resolves; the stand-in exposes the last text.",
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
];

/**
 * The controls a test factory may expose so a case can act on the outside world. The in-memory
 * Platform provides all of them; a real-platform harness provides the ones its cases need.
 */
export interface ContractControls {
	scriptShell?(script: ShellScript): void;
	holdNextStart?(): void;
	queuePtyExit?(code: number | null): void;
	emitSidecarLine?(line: string): void;
	emitSidecarRestart?(): void;
	emitNotificationClick?(deepLink: string): void;
	readonly dockBadge?: number | null;
	readonly clipboardText?: string | null;
	readonly sidecarSent?: readonly string[];
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

type ContractStep = (ctx: ContractContext) => Promise<void>;

const STEPS: Record<string, ContractStep> = {
	"fs.write-read": async (ctx) => {
		const path = ctx.path("notes/hello.txt");
		const text = "héllo, 世界\nand a second line";
		expectOk(ctx, await ctx.platform.fs.writeTextAtomic(path, text), "writeTextAtomic");
		const read = expectOk(ctx, await ctx.platform.fs.readText(path), "readText");
		ctx.assert(read === text, `readText returned ${JSON.stringify(read)}`);
	},

	"fs.atomic-no-partial": async (ctx) => {
		const folder = ctx.path("atomic");
		const target = joinPath(folder, "keep.txt");
		expectOk(ctx, await ctx.platform.fs.writeTextAtomic(target, "old"), "first write");
		expectOk(ctx, await ctx.platform.fs.mkdirp(folder), "mkdirp");
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
		expectOk(ctx, await ctx.platform.fs.writeTextAtomic(file, text), "writeTextAtomic");
		expectOk(ctx, await ctx.platform.fs.mkdirp(folder), "mkdirp");
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

	"fs.trash": async (ctx) => {
		const path = ctx.path("trash/me.txt");
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
		await new Promise((resolve) => setTimeout(resolve, 0));
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
		ctx.controls?.scriptShell?.((command) =>
			command.program === "/bin/echo" && command.args[0] === "hello"
				? ok({ exitCode: 0, stdout: "hello\n", stderr: "" })
				: null,
		);
		const output = expectOk(
			ctx,
			await ctx.platform.shell.run({ program: "/bin/echo", args: ["hello"], cwd: ctx.root }),
			"shell.run",
		);
		ctx.assert(output.exitCode === 0, `exitCode was ${output.exitCode}`);
		ctx.assert(output.stdout === "hello\n", `stdout was ${JSON.stringify(output.stdout)}`);
	},

	"shell.run-nonzero": async (ctx) => {
		ctx.controls?.scriptShell?.((command) =>
			command.program === "/bin/sh" ? ok({ exitCode: 3, stdout: "", stderr: "oops\n" }) : null,
		);
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
		ctx.controls?.scriptShell?.((command) =>
			command.program === "/bin/sh"
				? ok({ exitCode: 0, stdout: `cwd=${cwd} env=${marker} stdin=${stdin}`, stderr: "" })
				: null,
		);
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
		ctx.controls?.scriptShell?.((command) =>
			command.program === "/bin/sleep"
				? err(appError("shell_timeout", "The command was stopped after its timeout."))
				: null,
		);
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
		const output = expectOk(ctx, await running.done, "cancelled command");
		ctx.assert(output.exitCode !== 0, "a cancelled command reports a signal exit");
		await running.cancel();
	},

	"shell.no-shell-string": async (ctx) => {
		const argument = "two words 'quoted' $HOME";
		ctx.controls?.scriptShell?.((command) =>
			command.program === "/bin/echo" && command.args[0] === argument
				? ok({ exitCode: 0, stdout: `${argument}\n`, stderr: "" })
				: null,
		);
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
		ctx.controls?.queuePtyExit?.(5);
		const handle = expectOk(
			ctx,
			await ctx.platform.pty.spawn({
				cwd: ctx.root,
				cols: 80,
				rows: 24,
				command: { program: "/bin/sh", args: ["-c", "exit 5"] },
			}),
			"pty.spawn",
		);
		const code = await waitForEvent<number | null>(
			ctx,
			(listener) => handle.onExit(listener),
			() => {},
			"pty exit",
		);
		ctx.assert(code === 5, `the exit code was ${String(code)}`);
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
		ctx.assert(typeof code === "number" || code === null, "onExit reported no code");
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
		if (ctx.controls?.emitSidecarLine !== undefined) {
			const received: string[] = [];
			const unsubscribe = ctx.platform.sidecar.onLine((line) => received.push(line));
			ctx.controls.emitSidecarLine("hello");
			ctx.assert(
				received.length === 1 && received[0] === "hello",
				`onLine received ${JSON.stringify(received)}`,
			);
			unsubscribe();
			ctx.controls.emitSidecarLine("after");
			ctx.assert(received.length === 1, "a listener fired after unsubscribe");
			expectOk(ctx, await ctx.platform.sidecar.send("to-sidecar"), "send");
			ctx.assert(
				ctx.controls.sidecarSent?.includes("to-sidecar") === true,
				"send did not record the line",
			);
			return;
		}
		const line = await waitForEvent<string>(
			ctx,
			(listener) => ctx.platform.sidecar.onLine(listener),
			async () => {
				expectOk(ctx, await ctx.platform.sidecar.send("contract-ping"), "send");
			},
			"sidecar echo",
		);
		ctx.assert(line.length > 0, "the loopback child echoed nothing");
	},

	"sidecar.restart-signal": async (ctx) => {
		if (ctx.controls?.emitSidecarRestart === undefined) {
			ctx.assert(false, "this factory must expose emitSidecarRestart for the restart case");
			return;
		}
		const events: number[] = [];
		const unsubscribe = ctx.platform.sidecar.onRestart(() => events.push(1));
		ctx.controls.emitSidecarRestart();
		ctx.assert(events.length === 1, `onRestart fired ${events.length} times`);
		unsubscribe();
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
		await ctx.platform.notifications.setDockBadge(null);
		if (ctx.controls?.dockBadge !== undefined) {
			ctx.assert(ctx.controls.dockBadge === null, "the stand-in kept an old badge");
		}
	},

	"notifications.click": async (ctx) => {
		if (ctx.controls?.emitNotificationClick === undefined) {
			const unsubscribe = ctx.platform.notifications.onClicked(() => {});
			unsubscribe();
			return;
		}
		const received: string[] = [];
		const unsubscribe = ctx.platform.notifications.onClicked((deepLink) => received.push(deepLink));
		ctx.controls.emitNotificationClick("conducted://workspace/1");
		ctx.assert(
			received.length === 1 && received[0] === "conducted://workspace/1",
			`onClicked received ${JSON.stringify(received)}`,
		);
		unsubscribe();
		ctx.controls.emitNotificationClick("conducted://workspace/2");
		ctx.assert(received.length === 1, "a listener fired after unsubscribe");
	},

	"clipboard.write-text": async (ctx) => {
		await ctx.platform.clipboard.writeText("copied text");
		if (ctx.controls?.clipboardText !== undefined) {
			ctx.assert(ctx.controls.clipboardText === "copied text", "clipboard kept another value");
		}
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
};

/**
 * Registers one test per case. Each test builds a fresh platform with `create`, runs the case's
 * steps, and calls `cleanup`. `kind` names the implementation in the test titles.
 */
export function runPlatformContract(
	harness: ContractHarness,
	kind: "memory" | "tauri",
	create: () => Promise<PlatformUnderTest>,
): void {
	harness.describe(`PLAT-01 platform contract (${kind})`, () => {
		for (const testCase of PLATFORM_CONTRACT_CASES) {
			const step = STEPS[testCase.id];
			harness.it(`${testCase.id}: ${testCase.title}`, async () => {
				if (step === undefined) {
					throw new Error(`No steps are registered for contract case ${testCase.id}.`);
				}
				const underTest = await create();
				const context: ContractContext = {
					platform: underTest.platform,
					kind,
					root: underTest.root,
					controls: underTest.controls,
					assert: harness.assert,
					path: (name) => joinPath(underTest.root, name),
				};
				try {
					await step(context);
				} finally {
					await underTest.cleanup();
				}
			});
		}
	});
}
