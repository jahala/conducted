/**
 * @feature DATA-07 Cache of the last changes and pull request info of each workspace
 * Owns: saving the last changed-file snapshot and the last pull request info of each workspace to
 * files, reading them back for a caller that paints before the first poll answers, and keeping the
 * two caches under their size limits.
 * Behaviour: services-map.md 2.7.2 (limits: 25 MB for workspace changes, 5 MB for PR info; when a
 * write goes over, the oldest entries go first), 3.3.1 (the last changes are cached so a restart
 * paints at once), 5B.1.5 (one entry per workspace with the branch and the time it was seen,
 * written only when the content changed).
 * Must handle: a missing file is a cache miss (`ok(null)`); a damaged file or one from another
 * version is a cache miss after it is moved to the Trash, and a Trash that fails is returned; a
 * read error other than a missing file is returned; an entry for a branch other than the
 * workspace's current one is a miss and is left for the next save; a write whose branch and value
 * equal the stored ones is skipped and keeps the stored `observedAt`, so a poll that saw nothing
 * new writes nothing; writes are atomic; one entry that alone exceeds its limit is an
 * error and is not stored; a write that would go over the limit moves the oldest other files to
 * the Trash first; deleting a workspace moves both of its files to the Trash (the workspace
 * service calls `remove`); the entry carries `observedAt` so a caller can show the cached value as
 * old until a poll replaces it; saves and removes of one cache run one at a time, so two writes
 * cannot evict the same file twice.
 * Callers: `connectGitCache` saves each full git poll that changed a workspace's changes and each
 * pull request answer that changed (the GitHub service's store), and the startup step "git cache"
 * paints every active workspace from the files before its first poll answers.
 * Our design choice: a failed save is logged and nothing else changes, because the cache only
 * makes a restart paint sooner; the next poll that changes the value tries the save again.
 * Our design choice: files under the app data folder (`git-cache/changes` and `git-cache/pr-info`,
 * named by `changesCacheFile` and `prInfoCacheFile` below), one JSON file per workspace, because
 * decision D038 has no `cache.db`. The limits count the bytes of the files. An entry carries
 * `version`; a change to the shape of `ChangesSnapshot` or `WorkspacePrEntry` bumps it, which makes
 * every old file a miss.
 * Test first: `entriesToEvict` returns the oldest files until the rest fit under the limit.
 */
import { type AppError, appError, err, ok, type Result, type WorkspaceId } from "@conducted/shared";
import type { FileStat, FileSystem } from "../../platform/platform.ts";
import { type AppPaths, appDataPath } from "../app-paths.ts";
import { createKeyedQueue } from "../async/serial-queue.ts";
import { trashIfPresent } from "../fs-helpers.ts";
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
	files: readonly Pick<FileStat, "path" | "size" | "modifiedAt">[],
	limitBytes: number,
): string[] {
	const oldestFirst = [...files].sort(
		(left, right) => left.modifiedAt - right.modifiedAt || left.path.localeCompare(right.path),
	);
	let total = oldestFirst.reduce((sum, file) => sum + file.size, 0);
	const evicted: string[] = [];
	for (const file of oldestFirst) {
		if (total <= limitBytes) break;
		evicted.push(file.path);
		total -= file.size;
	}
	return evicted;
}

const utf8 = new TextEncoder();
const byteLength = (text: string): number => utf8.encode(text).length;

type ParsedEntry<T> = { kind: "hit"; entry: GitCacheEntry<T> } | { kind: "miss" };

/** Reads the envelope a cache file holds. Anything else is a miss and is trashed by the caller. */
function parseEntry<T>(text: string, workspaceId: string): ParsedEntry<T> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return { kind: "miss" };
	}
	if (typeof parsed !== "object" || parsed === null) return { kind: "miss" };
	const candidate = parsed as Record<string, unknown>;
	if (candidate.version !== GIT_CACHE_VERSION) return { kind: "miss" };
	if (candidate.workspaceId !== workspaceId) return { kind: "miss" };
	if (typeof candidate.branch !== "string") return { kind: "miss" };
	if (typeof candidate.observedAt !== "number" || !Number.isFinite(candidate.observedAt)) {
		return { kind: "miss" };
	}
	if (typeof candidate.value !== "object" || candidate.value === null) return { kind: "miss" };
	return { kind: "hit", entry: candidate as unknown as GitCacheEntry<T> };
}

const parentFolder = (path: string): string => path.slice(0, path.lastIndexOf("/"));

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
	fs: Pick<
		FileSystem,
		"readText" | "writeTextAtomic" | "mkdirp" | "readDir" | "trash" | "exists" | "paths"
	>;
	/** A smaller limit for tests. The real limits are the constants above. */
	changesMaxBytes?: number;
	/** A smaller limit for tests. The real limits are the constants above. */
	prInfoMaxBytes?: number;
}

const CHANGES_CACHE = "changes";
const PR_INFO_CACHE = "pr-info";

class FileGitCache implements GitCache {
	readonly #fs: GitCacheDeps["fs"];
	readonly #changesMaxBytes: number;
	readonly #prInfoMaxBytes: number;
	/** One writer per cache folder, so two saves cannot evict the same file at once. */
	readonly #writes = createKeyedQueue<string>();

	constructor(deps: GitCacheDeps) {
		this.#fs = deps.fs;
		this.#changesMaxBytes = deps.changesMaxBytes ?? CHANGES_CACHE_MAX_BYTES;
		this.#prInfoMaxBytes = deps.prInfoMaxBytes ?? PR_INFO_CACHE_MAX_BYTES;
	}

	loadChanges(
		workspaceId: WorkspaceId,
		branch: string,
	): Promise<Result<GitCacheEntry<ChangesSnapshot> | null>> {
		return this.#load<ChangesSnapshot>(
			changesCacheFile(this.#fs.paths, String(workspaceId)),
			workspaceId,
			branch,
		);
	}

	saveChanges(entry: GitCacheEntry<ChangesSnapshot>): Promise<Result<void>> {
		const file = changesCacheFile(this.#fs.paths, String(entry.workspaceId));
		return this.#writes.run(CHANGES_CACHE, () => this.#save(file, entry, this.#changesMaxBytes));
	}

	loadPrInfo(
		workspaceId: WorkspaceId,
		branch: string,
	): Promise<Result<GitCacheEntry<WorkspacePrEntry> | null>> {
		return this.#load<WorkspacePrEntry>(
			prInfoCacheFile(this.#fs.paths, String(workspaceId)),
			workspaceId,
			branch,
		);
	}

	savePrInfo(entry: GitCacheEntry<WorkspacePrEntry>): Promise<Result<void>> {
		const file = prInfoCacheFile(this.#fs.paths, String(entry.workspaceId));
		return this.#writes.run(PR_INFO_CACHE, () => this.#save(file, entry, this.#prInfoMaxBytes));
	}

	remove(workspaceId: WorkspaceId): Promise<Result<void>> {
		return this.#writes.runBarrier([CHANGES_CACHE, PR_INFO_CACHE], async () => {
			const paths = this.#fs.paths;
			let failure: AppError | null = null;
			for (const file of [
				changesCacheFile(paths, String(workspaceId)),
				prInfoCacheFile(paths, String(workspaceId)),
			]) {
				const removed = await trashIfPresent(this.#fs, file);
				if (!removed.ok && failure === null) failure = removed.error;
			}
			return failure === null ? ok(undefined) : err(failure);
		});
	}

	async #load<T>(
		file: string,
		workspaceId: WorkspaceId,
		branch: string,
	): Promise<Result<GitCacheEntry<T> | null>> {
		const read = await this.#fs.readText(file);
		if (!read.ok) {
			if (read.error.code === "fs_not_found") return ok(null);
			return read;
		}
		const parsed = parseEntry<T>(read.value, String(workspaceId));
		if (parsed.kind === "miss") {
			const trashed = await trashIfPresent(this.#fs, file);
			return trashed.ok ? ok(null) : trashed;
		}
		// The value belongs to another branch. Leave it for the next save to replace.
		if (parsed.entry.branch !== branch) return ok(null);
		return ok(parsed.entry);
	}

	async #save<T>(file: string, entry: GitCacheEntry<T>, limitBytes: number): Promise<Result<void>> {
		const text = JSON.stringify(entry);
		const bytes = byteLength(text);
		if (bytes > limitBytes) {
			return err(
				appError(
					"cache_too_large",
					`A cache entry of ${bytes} bytes is larger than the ${limitBytes} byte limit.`,
				),
			);
		}
		const existing = await this.#fs.readText(file);
		if (!existing.ok && existing.error.code !== "fs_not_found") return existing;
		// The same branch and value is no change, whenever it was seen: the stored entry and its
		// `observedAt` stay. A file that cannot be read as an entry is replaced.
		if (existing.ok) {
			const stored = parseEntry<T>(existing.value, String(entry.workspaceId));
			if (
				stored.kind === "hit" &&
				stored.entry.branch === entry.branch &&
				JSON.stringify(stored.entry.value) === JSON.stringify(entry.value)
			) {
				return ok(undefined);
			}
		}
		const folder = parentFolder(file);
		const made = await this.#fs.mkdirp(folder);
		if (!made.ok) return made;
		const room = await this.#makeRoom(folder, file, bytes, limitBytes);
		if (!room.ok) return room;
		return this.#fs.writeTextAtomic(file, text);
	}

	/** Moves the oldest other files of `folder` to the Trash until `incomingBytes` fits. */
	async #makeRoom(
		folder: string,
		ownFile: string,
		incomingBytes: number,
		limitBytes: number,
	): Promise<Result<void>> {
		const listing = await this.#fs.readDir(folder);
		if (!listing.ok) return listing;
		const others = listing.value.filter((entry) => !entry.isDirectory && entry.path !== ownFile);
		for (const path of entriesToEvict(others, limitBytes - incomingBytes)) {
			const trashed = await this.#fs.trash(path);
			if (!trashed.ok) return trashed;
		}
		return ok(undefined);
	}
}

export function createGitCache(deps: GitCacheDeps): GitCache {
	return new FileGitCache(deps);
}

/** The part of a service store the cache reads: one entry per workspace id. */
interface WatchedStore<Entry> {
	getState(): { byWorkspace: Readonly<Record<string, Entry>> };
	subscribe(
		listener: (
			state: { byWorkspace: Readonly<Record<string, Entry>> },
			previous: { byWorkspace: Readonly<Record<string, Entry>> },
		) => void,
	): () => void;
}

export interface GitCacheConnectionDeps {
	cache: GitCache;
	/** The git service: its polled changes, and the door that paints a cached snapshot. */
	changes: {
		store: WatchedStore<{ snapshot: ChangesSnapshot | null }>;
		paintCached(workspaceId: WorkspaceId, snapshot: ChangesSnapshot): void;
	};
	/** The GitHub service: its pull request info, and the door that paints a cached entry. */
	pullRequests: {
		store: WatchedStore<WorkspacePrEntry>;
		paintCached(workspaceId: WorkspaceId, entry: WorkspacePrEntry): void;
	};
	/** The branch a workspace has checked out now, or null for a workspace the app no longer has. */
	branchOf: (workspaceId: WorkspaceId) => string | null;
	now: () => number;
	/** Where a failed cache write goes. The cache only speeds up a restart, so nothing else waits. */
	log: (level: "warn" | "info", message: string) => void;
}

export interface GitCacheConnection {
	/**
	 * Paints the cached changes and pull request info of these workspaces before their first poll
	 * answers. A workspace that already has a polled value keeps it. Every workspace is tried, and
	 * the read failures come back together.
	 */
	paint(workspaces: readonly { id: WorkspaceId; branch: string }[]): Promise<Result<void>>;
	/** Stops saving. The container's `stop()` calls it. */
	stop(): void;
}

/** Pull request info worth keeping: an answer from GitHub, not a missing or failed read. */
const isAnsweredPrInfo = (entry: WorkspacePrEntry): boolean =>
	entry.unavailable === "none" || entry.unavailable === "no_pr";

/**
 * Connects the cache to the git and GitHub services (DATA-07). Each full poll that changed a
 * workspace's changes, and each pull request answer that changed, is saved; the cache itself skips
 * a value it already holds. `paint` reads the files back at startup.
 */
export function connectGitCache(deps: GitCacheConnectionDeps): GitCacheConnection {
	const report = (what: string, workspaceId: string) => (saved: Result<void>) => {
		if (!saved.ok) {
			deps.log(
				"warn",
				`Couldn't cache the ${what} of workspace ${workspaceId}: ${saved.error.message}`,
			);
		}
	};
	const stopChanges = deps.changes.store.subscribe((state, previous) => {
		for (const [key, entry] of Object.entries(state.byWorkspace)) {
			const snapshot = entry.snapshot;
			const before = previous.byWorkspace[key]?.snapshot ?? null;
			if (snapshot === null || snapshot === before) continue;
			// A shallower poll leaves counts unknown, so only a full snapshot is worth a restart.
			if (snapshot.depth !== "full") continue;
			// A poll every few seconds mostly sees the same state; that needs no file read at all.
			if (before !== null && JSON.stringify(before) === JSON.stringify(snapshot)) continue;
			const workspaceId = key as WorkspaceId;
			const branch = deps.branchOf(workspaceId);
			if (branch === null) continue;
			void deps.cache
				.saveChanges({
					version: GIT_CACHE_VERSION,
					workspaceId,
					branch,
					observedAt: deps.now(),
					value: snapshot,
				})
				.then(report("changes", key));
		}
	});
	const stopPullRequests = deps.pullRequests.store.subscribe((state, previous) => {
		for (const [key, entry] of Object.entries(state.byWorkspace)) {
			const before = previous.byWorkspace[key];
			if (entry === before || !isAnsweredPrInfo(entry)) continue;
			// `fetchedAt` changes with every poll; only the pull request and its state are content.
			if (
				before !== undefined &&
				before.unavailable === entry.unavailable &&
				JSON.stringify(before.pullRequest) === JSON.stringify(entry.pullRequest)
			) {
				continue;
			}
			const workspaceId = key as WorkspaceId;
			const branch = deps.branchOf(workspaceId);
			if (branch === null) continue;
			void deps.cache
				.savePrInfo({
					version: GIT_CACHE_VERSION,
					workspaceId,
					branch,
					observedAt: deps.now(),
					value: entry,
				})
				.then(report("pull request info", key));
		}
	});

	return {
		paint: async (workspaces) => {
			const failures: string[] = [];
			for (const workspace of workspaces) {
				const changes = await deps.cache.loadChanges(workspace.id, workspace.branch);
				if (!changes.ok) failures.push(`${workspace.id}: ${changes.error.message}`);
				else if (changes.value !== null) {
					deps.changes.paintCached(workspace.id, changes.value.value);
				}
				const prInfo = await deps.cache.loadPrInfo(workspace.id, workspace.branch);
				if (!prInfo.ok) failures.push(`${workspace.id}: ${prInfo.error.message}`);
				else if (prInfo.value !== null) {
					deps.pullRequests.paintCached(workspace.id, prInfo.value.value);
				}
			}
			if (failures.length === 0) return ok(undefined);
			return err(
				appError(
					"git_cache_read_failed",
					`The cached git state could not be read for ${failures.length} workspace${
						failures.length === 1 ? "" : "s"
					}. ${failures.join("; ")}`,
				),
			);
		},
		stop: () => {
			stopChanges();
			stopPullRequests();
		},
	};
}
