/**
 * @feature GIT-02 Parsing git output and refreshing a workspace's change state
 * Owns: pure parsers for the text git prints (name-status, numstat, porcelain status, rev-list
 * counts, commit log, worktree list), and the refresh pipeline that runs the polling commands.
 * Behaviour: services-map.md 3.0.5 (how output is parsed), 3.3 (polling commands and schedule),
 * 3.6.4 (ahead and behind), 3.7.7 and 3.15 (minimal command set).
 * Must handle: C-style quoted paths; rename lines in both numstat forms (`a => b` and
 * `dir/{a => b}/f`); binary files (`-` counts); a branch with no upstream (probe exits 128);
 * a detached HEAD (empty `branch --show-current`); no merge base (empty file list plus an error
 * field, never a throw); more than 100 untracked files (listed up to the cap, flagged truncated);
 * untracked files over 300 KB (counted as 501 lines, not read); a stale answer for a branch that
 * changed while the read ran must be dropped by the caller.
 * Our design choice: the parsers return values or a Result and never throw, and the pipeline
 * gets its runner as a parameter. The refresh interval (5 s for the visible workspace) belongs
 * to services/git.ts.
 * Test first: parseNumstat reads `src/{a => b}/x.ts` as a rename to `src/b/x.ts`.
 */
import type { FileChange } from "@conducted/protocol";
import {
	appError,
	err,
	notImplemented,
	ok,
	type Result,
	type WorkspaceId,
} from "@conducted/shared";
import type { BranchSync } from "../model.ts";
import type { GitRunner } from "./runner.ts";

// ---------------------------------------------------------------- limits (services-map 3.3.2)

export const UNTRACKED_FILE_CAP = 100;
export const UNTRACKED_COUNT_MAX_BYTES = 300 * 1024;
/** Line count reported for an untracked file too large to read. */
export const UNTRACKED_LARGE_FILE_LINES = 501;
export const TURN_CHANGES_FILE_CAP = 200;

// ---------------------------------------------------------------- paths

/** Decodes a C-style quoted path as git prints it when `core.quotePath` is on. */
export function unquotePath(raw: string): string {
	if (raw.length < 2 || !raw.startsWith('"') || !raw.endsWith('"')) return raw;
	const inner = raw.slice(1, -1);
	const bytes: number[] = [];
	const encoder = new TextEncoder();
	for (let i = 0; i < inner.length; i++) {
		const ch = inner[i] as string;
		if (ch !== "\\") {
			bytes.push(...encoder.encode(ch));
			continue;
		}
		const next = inner[i + 1] ?? "";
		const octal = /^[0-7]{3}/.exec(inner.slice(i + 1));
		if (octal) {
			bytes.push(Number.parseInt(octal[0], 8));
			i += 3;
			continue;
		}
		const simple: Record<string, number> = { n: 10, t: 9, r: 13, "\\": 92, '"': 34 };
		bytes.push(simple[next] ?? next.charCodeAt(0));
		i += 1;
	}
	return new TextDecoder().decode(new Uint8Array(bytes));
}

// ---------------------------------------------------------------- name-status

export interface NameStatusEntry {
	path: string;
	oldPath?: string;
	status: FileChange["status"];
}

/** Parses `git diff --name-status`. Unknown status letters (for example `T`) are skipped. */
export function parseNameStatus(text: string): NameStatusEntry[] {
	const entries: NameStatusEntry[] = [];
	for (const line of text.split("\n")) {
		if (line.length === 0) continue;
		const parts = line.split("\t");
		const code = parts[0] ?? "";
		const first = parts[1];
		const second = parts[2];
		if (first === undefined) continue;
		if (code === "A") entries.push({ path: unquotePath(first), status: "added" });
		else if (code === "M") entries.push({ path: unquotePath(first), status: "modified" });
		else if (code === "D") entries.push({ path: unquotePath(first), status: "deleted" });
		else if ((code.startsWith("R") || code.startsWith("C")) && second !== undefined) {
			entries.push({
				path: unquotePath(second),
				oldPath: unquotePath(first),
				status: code.startsWith("R") ? "renamed" : "copied",
			});
		}
	}
	return entries;
}

// ---------------------------------------------------------------- numstat

export interface NumstatEntry {
	path: string;
	oldPath?: string;
	linesAdded: number;
	linesRemoved: number;
	binary: boolean;
}

/** Repository paths are relative, so an empty brace side must not leave a leading slash. */
const collapseSlashes = (path: string): string => path.replace(/\/{2,}/g, "/").replace(/^\//, "");

/** Reads the path column of numstat, which shows renames as `a => b` or `dir/{a => b}/f`. */
export function parseNumstatPath(raw: string): { path: string; oldPath?: string } {
	const braces = /^(.*)\{(.*) => (.*)\}(.*)$/.exec(raw);
	if (braces) {
		const [, prefix = "", from = "", to = "", suffix = ""] = braces;
		return {
			path: unquotePath(collapseSlashes(`${prefix}${to}${suffix}`)),
			oldPath: unquotePath(collapseSlashes(`${prefix}${from}${suffix}`)),
		};
	}
	const arrow = raw.split(" => ");
	if (arrow.length === 2) {
		const [from = "", to = ""] = arrow;
		return from === "/dev/null"
			? { path: unquotePath(to) }
			: { path: unquotePath(to), oldPath: unquotePath(from) };
	}
	return { path: unquotePath(raw) };
}

/** Parses `git diff --numstat`: `added<TAB>removed<TAB>path`, with `-` for binary files. */
export function parseNumstat(text: string): NumstatEntry[] {
	const entries: NumstatEntry[] = [];
	for (const line of text.split("\n")) {
		if (line.length === 0) continue;
		const [added, removed, ...rest] = line.split("\t");
		if (added === undefined || removed === undefined || rest.length === 0) continue;
		const binary = added === "-" && removed === "-";
		const linesAdded = binary ? 0 : Number.parseInt(added, 10);
		const linesRemoved = binary ? 0 : Number.parseInt(removed, 10);
		if (Number.isNaN(linesAdded) || Number.isNaN(linesRemoved)) continue;
		entries.push({ ...parseNumstatPath(rest.join("\t")), linesAdded, linesRemoved, binary });
	}
	return entries;
}

/** Joins the two listings on the new path. A name-status entry without numstat counts as 0/0. */
export function mergeChanges(
	nameStatus: readonly NameStatusEntry[],
	numstat: readonly NumstatEntry[],
): FileChange[] {
	const counts = new Map(numstat.map((entry) => [entry.path, entry]));
	return nameStatus.map((entry) => {
		const count = counts.get(entry.path);
		return {
			path: entry.path,
			...(entry.oldPath === undefined ? {} : { oldPath: entry.oldPath }),
			status: entry.status,
			linesAdded: count?.linesAdded ?? 0,
			linesRemoved: count?.linesRemoved ?? 0,
			binary: count?.binary ?? false,
		};
	});
}

// ---------------------------------------------------------------- porcelain status

const CONFLICT_CODES = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

/** Paths marked as conflicted in `git status --porcelain` (two-letter code, a space, the path). */
export function parseConflictedPaths(porcelain: string): string[] {
	const paths: string[] = [];
	for (const line of porcelain.split("\n")) {
		if (line.length < 4) continue;
		if (CONFLICT_CODES.has(line.slice(0, 2))) paths.push(unquotePath(line.slice(3)));
	}
	return paths;
}

export type GitOperation = "none" | "rebase" | "merge" | "cherry_pick" | "revert";

/**
 * Which operation is in progress, from the names that exist in the git directory
 * (`rebase-merge`, `rebase-apply`, `MERGE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`).
 */
export function operationFromMarkers(present: ReadonlySet<string>): GitOperation {
	if (present.has("rebase-merge") || present.has("rebase-apply")) return "rebase";
	if (present.has("MERGE_HEAD")) return "merge";
	if (present.has("CHERRY_PICK_HEAD")) return "cherry_pick";
	if (present.has("REVERT_HEAD")) return "revert";
	return "none";
}

/** The marker names `operationFromMarkers` looks for. The pipeline checks each under the git dir. */
export const OPERATION_MARKERS = [
	"rebase-merge",
	"rebase-apply",
	"MERGE_HEAD",
	"CHERRY_PICK_HEAD",
	"REVERT_HEAD",
] as const;

// ---------------------------------------------------------------- counts, log, worktrees

/** Parses the output of `rev-list --left-right --count A...B`: "<left>\t<right>". */
export function parseLeftRightCount(text: string): Result<{ left: number; right: number }> {
	const match = /^\s*(\d+)\s+(\d+)\s*$/.exec(text);
	if (!match) return err(appError("git_parse", `Unexpected rev-list output: ${text.trim()}`));
	return ok({ left: Number(match[1]), right: Number(match[2]) });
}

export interface CommitSummary {
	hash: string;
	subject: string;
	authorName: string;
	authorEmail: string;
	/** Seconds since the epoch, as git prints it. */
	authoredAt: number;
}

/**
 * Parses `log --format=%H|%s|%an|%ae|%at`. The subject may contain `|`, so the last three
 * fields are read from the right and the first field is the hash.
 */
export function parseCommitLog(text: string): CommitSummary[] {
	const commits: CommitSummary[] = [];
	for (const line of text.split("\n")) {
		if (line.length === 0) continue;
		const fields = line.split("|");
		if (fields.length < 5) continue;
		const authoredAt = Number(fields.at(-1));
		const authorEmail = fields.at(-2) ?? "";
		const authorName = fields.at(-3) ?? "";
		const hash = fields[0] ?? "";
		const subject = fields.slice(1, -3).join("|");
		if (Number.isNaN(authoredAt)) continue;
		commits.push({ hash, subject, authorName, authorEmail, authoredAt });
	}
	return commits;
}

export interface WorktreeEntry {
	path: string;
	/** Null for a detached HEAD. */
	branch: string | null;
}

/** Parses `git worktree list --porcelain`. */
export function parseWorktreeList(text: string): WorktreeEntry[] {
	const entries: WorktreeEntry[] = [];
	let current: { path: string; branch: string | null } | null = null;
	for (const line of text.split("\n")) {
		if (line.startsWith("worktree ")) {
			if (current) entries.push(current);
			current = { path: line.slice("worktree ".length), branch: null };
		} else if (line.startsWith("branch ") && current) {
			current.branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
		}
	}
	if (current) entries.push(current);
	return entries;
}

// ---------------------------------------------------------------- the refresh pipeline

export interface ChangesSnapshot {
	branch: string | null;
	mergeBase: string | null;
	mergeBaseError: string | null;
	files: FileChange[];
	conflictedPaths: string[];
	untrackedTruncated: boolean;
	operation: GitOperation;
	/** Commits on the branch that are not on the target. */
	commits: CommitSummary[];
	sync: BranchSync;
	/** Commits the target has that the branch lacks. */
	behindTarget: number;
}

export interface RefreshChangesInput {
	workspaceId: WorkspaceId;
	workspacePath: string;
	/** For example "origin/main". */
	targetRef: string;
	remote: string;
	depth: "metadata" | "uncommitted" | "full";
}

export interface BranchSyncInput {
	workspacePath: string;
	targetRef: string;
}

/**
 * Computes ahead and behind against the upstream and against the target (services-map 3.3.2
 * steps 8 and 9, 3.6.4), and whether the remote branch was rewritten: both sides have commits
 * and the local tip is not in the reflog of the remote-tracking ref. A branch with no upstream
 * returns `hasUpstream: false` and zero counts, not an error.
 */
export function refreshBranchSync(
	_runner: GitRunner,
	_input: BranchSyncInput,
): Promise<Result<{ sync: BranchSync; behindTarget: number }>> {
	return notImplemented("GIT-03");
}

/**
 * Runs the polling commands of services-map 3.3.2 in the documented order, in parallel where
 * the research says so, and assembles one snapshot. Runs no lock (read-only commands).
 */
export function refreshWorkspaceChanges(
	_runner: GitRunner,
	_input: RefreshChangesInput,
): Promise<Result<ChangesSnapshot>> {
	return notImplemented("GIT-02");
}
