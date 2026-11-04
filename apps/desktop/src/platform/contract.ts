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
import { notImplemented } from "@conducted/shared";
import type { Platform } from "./platform.ts";

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

export interface ContractHarness {
	describe(name: string, body: () => void): void;
	it(name: string, body: () => Promise<void>): void;
	assert(condition: boolean, message: string): void;
}

export interface PlatformUnderTest {
	platform: Platform;
	/** Removes everything the run created. Called after every case, even a failed one. */
	cleanup(): Promise<void>;
}

/**
 * Registers one test per case. Each test builds a fresh platform with `create`, runs the case's
 * steps, and calls `cleanup`. `kind` names the implementation in the test titles.
 */
export function runPlatformContract(
	_harness: ContractHarness,
	_kind: "memory" | "tauri",
	_create: () => Promise<PlatformUnderTest>,
): void {
	notImplemented("PLAT-01");
}
