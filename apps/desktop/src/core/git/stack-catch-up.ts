/**
 * @feature PR-12 Catch up a stack branch after GitHub rewrites it
 * Owns: the per-worktree baseline ref, the path-and-ref guards around the automatic rebase, the
 * sequence-editor guard that re-checks the branch just before git starts, and the abort command
 * used when the rebase stops partway.
 * Behaviour: services-map.md 3.8.3 (steps 4 and 6: the baseline ref named by the hash of the
 * branch, its upstream, the remote and the remote's identity; the ignored-file collision guard),
 * 3.0.3 (the catch-up holds the worktree lock, then the repo lock).
 * Our design choice: the ref namespace is `refs/worktree/conducted/synced/` instead of Conductor's
 * `refs/worktree/conductor/synced/`, to match the `refs/conducted/...` refs in refs.ts. The guard
 * values reach the sequence editor as `CONDUCTED_CATCH_UP_*` variables (D027), so no branch name
 * or URL is ever joined into a shell command.
 * Must handle: an empty NUL-separated list; an ignored folder colliding with a file the rebase
 * would add; a guarded rebase that stops partway (abort it).
 * Test first: an ignored `build/` folder collides with an added `build/out.js`.
 */
import { trimTrailingSlashes } from "@conducted/shared";
import type { GitCommand } from "./commands.ts";

/** Per-worktree refs that remember the tip a stack branch last synced to. */
export const SYNCED_REF_PREFIX = "refs/worktree/conducted/synced/";

/** The baseline ref for one branch, remote and remote identity, named by the hash of that tuple. */
export const syncedBaselineRef = (tupleHash: string): string => `${SYNCED_REF_PREFIX}${tupleHash}`;

/** Reads a NUL-separated path list, as `git ls-files -z` and `git diff-tree -z` print it. */
export const parseNulPaths = (text: string): string[] =>
	text.split("\0").filter((path) => path.length > 0);

/** The form paths are compared in: Unicode NFC, lower case, without a directory's trailing slash. */
const normalisedPath = (path: string): string =>
	trimTrailingSlashes(path.normalize("NFC").toLowerCase());

/**
 * Whether an ignored path would be overwritten by a path the rebase adds. An ignored folder
 * (`--directory` prints it with a trailing slash) collides with every added file under it.
 */
export function hasIgnoredPathCollision(
	ignoredPaths: readonly string[],
	addedPaths: readonly string[],
): boolean {
	const ignored = new Set(ignoredPaths.map(normalisedPath));
	const ignoredFolders = [...ignored];
	for (const raw of addedPaths) {
		const path = normalisedPath(raw);
		if (ignored.has(path)) return true;
		if (ignoredFolders.some((folder) => path.startsWith(`${folder}/`))) return true;
	}
	return false;
}

export interface CatchUpGuardInput {
	/** The full ref HEAD named when the rebase was planned, for example `refs/heads/feat-b`. */
	headRef: string;
	/** The local tip the branch is on when the rebase starts. */
	localOid: string;
	/** The full ref of the upstream, for example `refs/remotes/origin/feat-b`. */
	upstreamRef: string;
	/** The rewritten upstream tip the branch moves onto. */
	upstreamOid: string;
	/** The remote the branch tracks. */
	remote: string;
	/** The hash of the remote's URL, read when the rebase was planned. */
	remoteIdentity: string;
}

/**
 * The sequence-editor guard: git runs this script after it has built the rebase todo but before it
 * replays any commit. It re-reads the rebase state and stops when the branch, the local tip, the
 * upstream tip or the remote changed since planning.
 */
const REBASE_GUARD_SCRIPT = [
	'test "$(cat "$(git rev-parse --git-path rebase-merge/head-name)")" = "$CONDUCTED_CATCH_UP_HEAD_REF"',
	'test "$(cat "$(git rev-parse --git-path rebase-merge/orig-head)")" = "$CONDUCTED_CATCH_UP_LOCAL_OID"',
	'test "$(git rev-parse HEAD)" = "$CONDUCTED_CATCH_UP_LOCAL_OID"',
	'test "$(git rev-parse "$CONDUCTED_CATCH_UP_UPSTREAM_REF")" = "$CONDUCTED_CATCH_UP_UPSTREAM_OID"',
	'test "$(printf %s "$(git remote get-url "$CONDUCTED_CATCH_UP_REMOTE")" | git hash-object --stdin)" = "$CONDUCTED_CATCH_UP_REMOTE_ID"',
].join(" && ");

/** The environment that runs the guard as git's sequence editor, with the planned values. */
export function catchUpGuardEnv(input: CatchUpGuardInput): Readonly<Record<string, string>> {
	return {
		GIT_SEQUENCE_EDITOR: `sh -c '${REBASE_GUARD_SCRIPT}' --`,
		CONDUCTED_CATCH_UP_HEAD_REF: input.headRef,
		CONDUCTED_CATCH_UP_LOCAL_OID: input.localOid,
		CONDUCTED_CATCH_UP_UPSTREAM_REF: input.upstreamRef,
		CONDUCTED_CATCH_UP_UPSTREAM_OID: input.upstreamOid,
		CONDUCTED_CATCH_UP_REMOTE: input.remote,
		CONDUCTED_CATCH_UP_REMOTE_ID: input.remoteIdentity,
	};
}

/** Stops a rebase that failed or was refused by the guard, so the worktree is not left partway. */
export const rebaseAbortCommand = (): GitCommand => ({
	program: "git",
	args: ["rebase", "--abort"],
	retryOnLock: false,
});
