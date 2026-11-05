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
 * untracked files over 300 KB (counted as 501 lines, not read); a failed untracked count, sync
 * probe, distance or log is returned as an error, never a clean-looking zero; a stale answer for
 * a branch that changed while the read ran must be dropped by the caller.
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
import {
	branchShowCurrent,
	diffNameStatus,
	diffNoIndexNumstat,
	diffNumstat,
	type GitCommand,
	logRange,
	lsFilesUntracked,
	mergeBase,
	revListCount,
	revListLeftRightCount,
	revParseGitPath,
	revParseHeadAndUpstream,
	statusPorcelain,
} from "./commands.ts";
import type { GitRunner } from "./runner.ts";

// ---------------------------------------------------------------- limits (services-map 3.3.2)

export const UNTRACKED_FILE_CAP = 100;
/** An untracked file larger than this is not read; its line count is reported as the sentinel. */
export const UNTRACKED_COUNT_MAX_BYTES = 300 * 1024;
/** One batch of untracked-file commands stays under this many bytes of paths (services-map 3.3.2). */
export const UNTRACKED_COUNT_BATCH_BYTES = 200_000;
/** Line count reported for an untracked file too large to read. */
export const UNTRACKED_LARGE_FILE_LINES = 501;
export const TURN_CHANGES_FILE_CAP = 200;

// ---------------------------------------------------------------- diff target (services-map 3.3.2)

export type DiffTargetSource = "graphite_parent" | "pull_request" | "intended";

export interface DiffTargetInput {
	/** The stack parent Graphite reports for this branch, as a local branch name. */
	graphiteParentBranch: string | null;
	/** The base branch of the open pull request, as GitHub names it. */
	pullRequestBaseBranch: string | null;
	/** The target branch stored on the workspace, for example "origin/main". */
	intendedTargetBranch: string;
	/** The repository's remote name, for example "origin". */
	remote: string;
}

export interface DiffTarget {
	branch: string;
	/** The ref the merge base and the commit range are read against. */
	ref: string;
	source: DiffTargetSource;
	/** A stack parent is a local branch, so its remote-tracking ref says nothing (services-map 3.3.4). */
	isLocalStackParent: boolean;
}

/** The remote-tracking ref of a branch, accepting a branch already prefixed with the remote. */
export function remoteTargetRef(branch: string, remote: string): string {
	if (branch.startsWith("refs/")) return branch;
	if (remote.length === 0) return branch;
	if (branch === remote || branch.startsWith(`${remote}/`)) return `refs/remotes/${branch}`;
	return `refs/remotes/${remote}/${branch}`;
}

/**
 * Picks the diff target: a Graphite stack parent first, then the open pull request's base, then
 * the workspace's intended target branch (services-map 3.3.2 step 2).
 */
export function diffTargetOf(input: DiffTargetInput): DiffTarget {
	const graphite = input.graphiteParentBranch;
	if (graphite !== null && graphite.length > 0) {
		return {
			branch: graphite,
			ref: graphite,
			source: "graphite_parent",
			isLocalStackParent: true,
		};
	}
	const pullRequestBase = input.pullRequestBaseBranch;
	const fromPullRequest = pullRequestBase !== null && pullRequestBase.length > 0;
	const branch = fromPullRequest ? pullRequestBase : input.intendedTargetBranch;
	return {
		branch,
		ref: remoteTargetRef(branch, input.remote),
		source: fromPullRequest ? "pull_request" : "intended",
		isLocalStackParent: false,
	};
}

/**
 * Splits untracked paths into command batches under `UNTRACKED_COUNT_BATCH_BYTES`. A path longer
 * than the cap still gets a batch of its own, so nothing is dropped.
 */
export function untrackedCountBatches(paths: readonly string[]): string[][] {
	const encoder = new TextEncoder();
	const batches: string[][] = [];
	let batch: string[] = [];
	let bytes = 0;
	for (const path of paths) {
		const size = encoder.encode(path).length + 1;
		if (batch.length > 0 && bytes + size > UNTRACKED_COUNT_BATCH_BYTES) {
			batches.push(batch);
			batch = [];
			bytes = 0;
		}
		batch.push(path);
		bytes += size;
	}
	if (batch.length > 0) batches.push(batch);
	return batches;
}

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
	/** The ref to compare against, for example "refs/remotes/origin/main". */
	targetRef: string;
	remote: string;
	depth: "metadata" | "uncommitted" | "full";
	/** When present, the diff target is chosen from these by `diffTargetOf` instead of `targetRef`. */
	diffTarget?: DiffTargetInput;
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

const emptySync = (): BranchSync => ({
	ahead: 0,
	behind: 0,
	rewritten: false,
	hasUpstream: false,
});

/** `stat` is used only to test whether a marker path exists and to size an untracked file. */
const statCommand = (path: string): GitCommand => ({
	program: "stat",
	args: ["-f", "%z", "--", path],
	retryOnLock: false,
});

const pathExists = async (runner: GitRunner, cwd: string, path: string): Promise<boolean> => {
	const result = await runner.run(statCommand(path), { cwd });
	return result.ok && result.value.exitCode === 0;
};

/** Checks the names git keeps in its directory while a multi-step operation is open. */
async function readOperation(runner: GitRunner, cwd: string): Promise<GitOperation> {
	const markers = await Promise.all(
		OPERATION_MARKERS.map(async (marker) => {
			const path = await runner.stdout(revParseGitPath(marker), { cwd });
			if (!path.ok || path.value.length === 0) return null;
			return (await pathExists(runner, cwd, path.value)) ? marker : null;
		}),
	);
	const present = new Set<string>();
	for (const marker of markers) {
		if (marker !== null) present.add(marker);
	}
	return operationFromMarkers(present);
}

async function countUntrackedLines(
	runner: GitRunner,
	cwd: string,
	path: string,
): Promise<Result<number>> {
	const result = await runner.run(diffNoIndexNumstat(path), { cwd });
	if (!result.ok) return result;
	// Exit 1 means the files differ. Any other exit code with a message is a real failure.
	if (result.value.exitCode !== 0 && result.value.stderr.trim().length > 0) {
		return err(appError("git_failed", result.value.stderr.trim()));
	}
	const [entry] = parseNumstat(result.value.stdout.trim());
	return ok(entry?.linesAdded ?? 0);
}

/**
 * One untracked file as an added file. A file over `UNTRACKED_COUNT_MAX_BYTES` is not read; it
 * keeps the sentinel count so an enormous log or archive cannot stall a poll.
 */
async function untrackedFile(
	runner: GitRunner,
	cwd: string,
	path: string,
): Promise<Result<FileChange>> {
	const size = await runner.stdout(statCommand(path), { cwd });
	const bytes = size.ok ? Number.parseInt(size.value, 10) : Number.NaN;
	if (Number.isFinite(bytes) && bytes > UNTRACKED_COUNT_MAX_BYTES) {
		return ok({
			path,
			status: "added",
			linesAdded: UNTRACKED_LARGE_FILE_LINES,
			linesRemoved: 0,
			binary: false,
		});
	}
	const lines = await countUntrackedLines(runner, cwd, path);
	if (!lines.ok) return lines;
	return ok({ path, status: "added", linesAdded: lines.value, linesRemoved: 0, binary: false });
}

/** The untracked files of a worktree, with their line counts and the truncation flag. */
export async function readUntracked(
	runner: GitRunner,
	cwd: string,
): Promise<Result<{ files: FileChange[]; truncated: boolean }>> {
	const listed = await runner.run(lsFilesUntracked(), { cwd });
	if (!listed.ok) return listed;
	if (listed.value.exitCode !== 0) {
		return err(
			appError(
				"git_failed",
				listed.value.stderr.trim() || `git ls-files exited with code ${listed.value.exitCode}`,
			),
		);
	}
	// `-z` output is NUL separated and never quoted (services-map 3.0.5).
	const all = listed.value.stdout.split("\0").filter((path) => path.length > 0);
	const paths = all.slice(0, UNTRACKED_FILE_CAP);
	const files: FileChange[] = [];
	for (const batch of untrackedCountBatches(paths)) {
		const results = await Promise.all(batch.map((path) => untrackedFile(runner, cwd, path)));
		for (const result of results) {
			if (!result.ok) return result;
			files.push(result.value);
		}
	}
	return ok({ files, truncated: all.length > UNTRACKED_FILE_CAP });
}

/**
 * Reads how far the branch is ahead of and behind its upstream (services-map 3.3.2 step 8).
 * Exit 128 is the one normal "no upstream" answer; every other failure is returned.
 */
async function readUpstreamSync(runner: GitRunner, cwd: string): Promise<Result<BranchSync>> {
	const refs = await runner.run(revParseHeadAndUpstream(), { cwd });
	if (!refs.ok) return refs;
	if (refs.value.exitCode === 128) return ok(emptySync());
	if (refs.value.exitCode !== 0) {
		return err(
			appError(
				"git_failed",
				refs.value.stderr.trim() || `git rev-parse exited with code ${refs.value.exitCode}`,
			),
		);
	}
	const [headOid, upstreamOid] = refs.value.stdout
		.trim()
		.split("\n")
		.filter((line) => line.length > 0);
	if (headOid === undefined || upstreamOid === undefined) {
		return err(appError("git_parse", "Unexpected rev-parse HEAD @{u} output."));
	}
	const counts = await runner.stdout(revListLeftRightCount(upstreamOid, headOid), { cwd });
	if (!counts.ok) return counts;
	const parsed = parseLeftRightCount(counts.value);
	if (!parsed.ok) return parsed;
	return ok({
		ahead: parsed.value.right,
		behind: parsed.value.left,
		rewritten: false,
		hasUpstream: true,
	});
}

/** How many commits the target has that the branch lacks (services-map 3.3.2 step 9). */
async function readBehindTarget(
	runner: GitRunner,
	cwd: string,
	targetRef: string,
): Promise<Result<number>> {
	const result = await runner.stdout(revListCount(`HEAD..${targetRef}`), { cwd });
	if (!result.ok) return result;
	const count = Number.parseInt(result.value, 10);
	return Number.isNaN(count)
		? err(appError("git_parse", `Unexpected rev-list count: ${result.value}`))
		: ok(count);
}

/** The branch's own commits over the target (services-map 3.3.2 step 10). */
async function readCommits(
	runner: GitRunner,
	cwd: string,
	targetRef: string,
): Promise<Result<CommitSummary[]>> {
	const result = await runner.stdout(logRange(`${targetRef}..HEAD`), { cwd });
	return result.ok ? ok(parseCommitLog(result.value)) : result;
}

interface SnapshotParts {
	branch: string | null;
	mergeBase: string | null;
	mergeBaseError: string | null;
	operation: GitOperation;
}

async function readChanges(
	runner: GitRunner,
	cwd: string,
	from: string,
	parts: SnapshotParts,
	targetRef: string,
): Promise<Result<ChangesSnapshot>> {
	const [nameStatus, numstat, porcelain, untracked] = await Promise.all([
		runner.stdout(diffNameStatus(from), { cwd }),
		runner.stdout(diffNumstat(from), { cwd }),
		runner.stdout(statusPorcelain(), { cwd }),
		readUntracked(runner, cwd),
	]);
	if (!nameStatus.ok) return nameStatus;
	if (!numstat.ok) return numstat;
	if (!porcelain.ok) return porcelain;
	if (!untracked.ok) return untracked;

	const [sync, behindTarget, commits] = await Promise.all([
		readUpstreamSync(runner, cwd),
		readBehindTarget(runner, cwd, targetRef),
		readCommits(runner, cwd, targetRef),
	]);
	if (!sync.ok) return sync;
	if (!behindTarget.ok) return behindTarget;
	if (!commits.ok) return commits;

	return ok({
		...parts,
		files: [
			...mergeChanges(parseNameStatus(nameStatus.value), parseNumstat(numstat.value)),
			...untracked.value.files,
		],
		conflictedPaths: parseConflictedPaths(porcelain.value),
		untrackedTruncated: untracked.value.truncated,
		commits: commits.value,
		sync: sync.value,
		behindTarget: behindTarget.value,
	});
}

/**
 * Runs the polling commands of services-map 3.3.2 in the documented order, in parallel where
 * the research says so, and assembles one snapshot. Runs no lock (read-only commands).
 *
 * A metadata poll reads only the branch and the operation. An uncommitted poll compares against
 * HEAD. A full poll compares against the merge base of the target and the branch, and adds the
 * untracked files, the upstream sync, the distance behind the target and the branch commits.
 */
export async function refreshWorkspaceChanges(
	runner: GitRunner,
	input: RefreshChangesInput,
): Promise<Result<ChangesSnapshot>> {
	const cwd = input.workspacePath;
	const targetRef =
		input.diffTarget === undefined ? input.targetRef : diffTargetOf(input.diffTarget).ref;

	const branchResult = await runner.stdout(branchShowCurrent(), { cwd });
	if (!branchResult.ok) return branchResult;
	const branch = branchResult.value.length > 0 ? branchResult.value : null;

	// The cheapest poll reads only the local branch (services-map 3.3.3).
	if (input.depth === "metadata") {
		return ok({
			branch,
			mergeBase: null,
			mergeBaseError: null,
			files: [],
			conflictedPaths: [],
			untrackedTruncated: false,
			operation: "none",
			commits: [],
			sync: emptySync(),
			behindTarget: 0,
		});
	}

	const operation = await readOperation(runner, cwd);
	const parts: SnapshotParts = {
		branch,
		mergeBase: null,
		mergeBaseError: null,
		operation,
	};

	if (input.depth === "uncommitted") {
		return readChanges(runner, cwd, "HEAD", parts, targetRef);
	}

	const mergedBase = await runner.stdout(mergeBase(targetRef, branch ?? "HEAD"), { cwd });
	if (!mergedBase.ok || mergedBase.value.length === 0) {
		const mergeBaseError = mergedBase.ok
			? `No common ancestor with ${targetRef}.`
			: mergedBase.error.message;
		return ok({
			...parts,
			mergeBaseError,
			files: [],
			conflictedPaths: [],
			untrackedTruncated: false,
			commits: [],
			sync: emptySync(),
			behindTarget: 0,
		});
	}

	return readChanges(
		runner,
		cwd,
		mergedBase.value,
		{ ...parts, mergeBase: mergedBase.value },
		targetRef,
	);
}
