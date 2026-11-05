/**
 * @feature DATA-07 Cache of the last changes and pull request info of each workspace
 * Owns: saving the last changed-file snapshot and the last pull request info of each workspace to
 * files, reading them back at startup so the screens paint at once, and keeping the two caches
 * under their size limits.
 * Behaviour: services-map.md 2.7.2 (limits: 25 MB for workspace changes, 5 MB for PR info; when a
 * write goes over, the oldest entries go first), 3.3.1 (the last changes are cached so a restart
 * paints at once), 5B.1.5 (one entry per workspace with the branch and the time it was seen,
 * written only when the content changed).
 * Must handle: a file that is missing, damaged or from another version is a cache miss
 * (`ok(null)`) and the file is moved to the Trash, never a failure; an entry for a branch other
 * than the workspace's current one is a miss; a write whose content equals the stored content is
 * skipped; writes are atomic; one entry that alone exceeds its limit is not stored; removing a
 * workspace removes its entries; a cached entry is shown as old until a poll replaces it, so
 * callers pass `observedAt` through to the screen.
 * Our design choice: files under the app data folder (`git-cache/changes` and `git-cache/pr-info`,
 * named by `changesCacheFile` and `prInfoCacheFile` below), one JSON file per workspace, because
 * decision D038 has no `cache.db`. The limits count the bytes of the files. An entry carries
 * `version`; a change to the shape of `ChangesSnapshot` or `WorkspacePrEntry` bumps it, which makes
 * every old file a miss.
 * Test first: `entriesToEvict` returns the oldest files until the rest fit under the limit.
 */
import { notImplemented, type Result, type WorkspaceId } from "@conducted/shared";
import type { FileStat, FileSystem } from "../../platform/platform.ts";
import { type AppPaths, appDataPath } from "../app-paths.ts";
import type { ChangesSnapshot } from "../git/status.ts";
import type { WorkspacePrEntry } from "./github.ts";

/** Most bytes the cached changes may take together (25 MiB). */
export const CHANGES_CACHE_MAX_BYTES = 25 * 1024 * 1024;
/** Most bytes the cached pull request info may take together (5 MiB). */
export const PR_INFO_CACHE_MAX_BYTES = 5 * 1024 * 1024;
/** Written into every file. Reading a file with another number is a cache miss. */
export const GIT_CACHE_VERSION = 1;

/** The last changed-file list of one workspace, so a restart can paint at once. */
export const changesCacheFile = (paths: AppPaths, workspaceId: string): string =>
	appDataPath(paths, "git-cache", "changes", `${workspaceId}.json`);

/** The last pull request information of one workspace. */
export const prInfoCacheFile = (paths: AppPaths, workspaceId: string): string =>
	appDataPath(paths, "git-cache", "pr-info", `${workspaceId}.json`);

/** One cached value with where and when it was seen. */
export interface GitCacheEntry<T> {
	version: typeof GIT_CACHE_VERSION;
	workspaceId: WorkspaceId;
	/** The branch the value belongs to. A different current branch makes the entry a miss. */
	branch: string;
	/** Milliseconds since the epoch, when the value was read from git or GitHub. */
	observedAt: number;
	value: T;
}

/** Paths of the files to move to the Trash so the rest fit in `limitBytes`, oldest first. */
export function entriesToEvict(
	_files: readonly Pick<FileStat, "path" | "size" | "modifiedAt">[],
	_limitBytes: number,
): string[] {
	return notImplemented("DATA-07");
}

export interface GitCache {
	/** The cached changes of a workspace on `branch`. A miss is `ok(null)`. */
	loadChanges(
		workspaceId: WorkspaceId,
		branch: string,
	): Promise<Result<GitCacheEntry<ChangesSnapshot> | null>>;
	/** Stores a changes snapshot, then enforces `CHANGES_CACHE_MAX_BYTES`. */
	saveChanges(entry: GitCacheEntry<ChangesSnapshot>): Promise<Result<void>>;
	/** The cached pull request info of a workspace on `branch`. A miss is `ok(null)`. */
	loadPrInfo(
		workspaceId: WorkspaceId,
		branch: string,
	): Promise<Result<GitCacheEntry<WorkspacePrEntry> | null>>;
	/** Stores pull request info, then enforces `PR_INFO_CACHE_MAX_BYTES`. */
	savePrInfo(entry: GitCacheEntry<WorkspacePrEntry>): Promise<Result<void>>;
	/** Removes both entries of a workspace, for when the workspace is deleted. */
	remove(workspaceId: WorkspaceId): Promise<Result<void>>;
}

export interface GitCacheDeps {
	fs: Pick<FileSystem, "readText" | "writeTextAtomic" | "mkdirp" | "readDir" | "trash" | "paths">;
}

export function createGitCache(_deps: GitCacheDeps): GitCache {
	return {
		loadChanges: async () => notImplemented("DATA-07"),
		saveChanges: async () => notImplemented("DATA-07"),
		loadPrInfo: async () => notImplemented("DATA-07"),
		savePrInfo: async () => notImplemented("DATA-07"),
		remove: async () => notImplemented("DATA-07"),
	};
}
