import type { WorkspaceId } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import { createMemoryPlatform } from "../../platform/memory.ts";
import { createTestIds } from "../../test/ids.ts";
import { unusedDatabase } from "../../test/memory-platform.ts";
import type { ChangesSnapshot } from "../git/status.ts";
import {
	CHANGES_CACHE_MAX_BYTES,
	changesCacheFile,
	createGitCache,
	entriesToEvict,
	GIT_CACHE_VERSION,
	type GitCacheEntry,
	PR_INFO_CACHE_MAX_BYTES,
	prInfoCacheFile,
} from "./git-cache.ts";
import type { WorkspacePrEntry } from "./github.ts";

const snapshot = (label: string): ChangesSnapshot => ({
	depth: "full",
	branch: "main",
	mergeBase: null,
	mergeBaseError: null,
	files: [],
	conflictedPaths: [],
	untrackedTruncated: false,
	uncommittedFiles: 0,
	changedFiles: 0,
	operation: "none",
	commits:
		label === ""
			? []
			: [{ hash: label, subject: label, authorName: "", authorEmail: "", authoredAt: 0 }],
	sync: { ahead: 0, behind: 0, rewritten: false, hasUpstream: false },
	behindTarget: 0,
});

const changesEntry = (
	workspaceId: string,
	branch: string,
	observedAt: number,
	label: string,
): GitCacheEntry<ChangesSnapshot> => ({
	version: GIT_CACHE_VERSION,
	workspaceId: workspaceId as WorkspaceId,
	branch,
	observedAt,
	value: snapshot(label),
});

const prValue = (title: string): WorkspacePrEntry => ({
	pullRequest: {
		number: 1,
		url: "https://github.com/o/r/pull/1",
		title,
		body: "",
		state: "open",
		mergeable: "mergeable",
		reviewDecision: null,
		checks: [],
		inMergeQueue: false,
		autoMergeEnabled: false,
		baseBranch: "main",
		authorLogin: null,
		viewerDidAuthor: false,
		viewerCanMerge: true,
		mergeMethod: "squash",
		reviewers: [],
		deployments: [],
		updatedAt: 0,
	},
	unavailable: "none",
	fetchedAt: 0,
});

const prEntry = (
	workspaceId: string,
	branch: string,
	observedAt: number,
	title: string,
): GitCacheEntry<WorkspacePrEntry> => ({
	version: GIT_CACHE_VERSION,
	workspaceId: workspaceId as WorkspaceId,
	branch,
	observedAt,
	value: prValue(title),
});

const bytes = (text: string): number => new TextEncoder().encode(text).length;

function createCache(options: { changesMaxBytes?: number; prInfoMaxBytes?: number } = {}) {
	let now = 1_000;
	const memory = createMemoryPlatform({
		clock: { now: () => now },
		ids: createTestIds(),
		database: unusedDatabase,
	});
	const fs = memory.platform.fs;
	return {
		fs,
		advance: (ms: number) => {
			now += ms;
		},
		cache: createGitCache({ fs, ...options }),
	};
}

describe("DATA-07 cache file paths", () => {
	it("keeps the git caches in their own folders under app data", () => {
		const paths = {
			home: "/Users/a/",
			appData: "/Users/a/Library/App/",
			temp: "/tmp",
			resources: "/App/Resources",
		};
		expect(changesCacheFile(paths, "w1")).toBe("/Users/a/Library/App/git-cache/changes/w1.json");
		expect(prInfoCacheFile(paths, "w1")).toBe("/Users/a/Library/App/git-cache/pr-info/w1.json");
	});
});

describe("DATA-07 entriesToEvict", () => {
	it("keeps every file when they fit under the limit", () => {
		const files = [
			{ path: "/a", size: 10, modifiedAt: 1 },
			{ path: "/b", size: 20, modifiedAt: 2 },
		];
		expect(entriesToEvict(files, 30)).toEqual([]);
		expect(entriesToEvict(files, 100)).toEqual([]);
	});

	it("moves the oldest files first until the rest fit under the limit", () => {
		const files = [
			{ path: "/newest", size: 40, modifiedAt: 3 },
			{ path: "/oldest", size: 40, modifiedAt: 1 },
			{ path: "/middle", size: 40, modifiedAt: 2 },
		];
		expect(entriesToEvict(files, 80)).toEqual(["/oldest"]);
		expect(entriesToEvict(files, 50)).toEqual(["/oldest", "/middle"]);
	});

	it("breaks a tie by path so the answer does not depend on listing order", () => {
		const files = [
			{ path: "/b", size: 10, modifiedAt: 1 },
			{ path: "/a", size: 10, modifiedAt: 1 },
		];
		expect(entriesToEvict(files, 10)).toEqual(["/a"]);
	});
});

describe("DATA-07 cached workspace changes", () => {
	it("writes the changes of a workspace and reads them back for the same branch", async () => {
		const { cache } = createCache();
		const entry = changesEntry("w1", "main", 1_700_000_000_000, "first");
		expect((await cache.saveChanges(entry)).ok).toBe(true);

		const loaded = await cache.loadChanges("w1" as WorkspaceId, "main");

		expect(loaded.ok ? loaded.value : null).toEqual(entry);
	});

	it("keeps one entry per workspace", async () => {
		const { cache } = createCache();
		const first = changesEntry("w1", "main", 100, "one");
		const second = changesEntry("w2", "main", 200, "two");
		expect((await cache.saveChanges(first)).ok).toBe(true);
		expect((await cache.saveChanges(second)).ok).toBe(true);

		const one = await cache.loadChanges("w1" as WorkspaceId, "main");
		const two = await cache.loadChanges("w2" as WorkspaceId, "main");

		expect(one.ok ? one.value?.value.commits[0]?.hash : undefined).toBe("one");
		expect(two.ok ? two.value?.value.commits[0]?.hash : undefined).toBe("two");
	});

	it("is a miss when the workspace has never been cached", async () => {
		const { cache } = createCache();
		const loaded = await cache.loadChanges("missing" as WorkspaceId, "main");
		expect(loaded.ok ? loaded.value : "failed").toBeNull();
	});

	it("is a miss for a branch other than the one in the entry", async () => {
		const { cache, fs } = createCache();
		expect((await cache.saveChanges(changesEntry("w1", "main", 100, "one"))).ok).toBe(true);

		const loaded = await cache.loadChanges("w1" as WorkspaceId, "feature");

		expect(loaded.ok ? loaded.value : "failed").toBeNull();
		expect(await fs.exists(changesCacheFile(fs.paths, "w1"))).toBe(true);
	});

	it("treats a damaged file as a miss and moves it to the Trash", async () => {
		const { cache, fs } = createCache();
		const file = changesCacheFile(fs.paths, "w1");
		expect((await fs.writeTextAtomic(file, "{ not json")).ok).toBe(true);

		const loaded = await cache.loadChanges("w1" as WorkspaceId, "main");

		expect(loaded.ok ? loaded.value : "failed").toBeNull();
		expect(await fs.exists(file)).toBe(false);
	});

	it("treats a file from another version as a miss and moves it to the Trash", async () => {
		const { cache, fs } = createCache();
		const file = changesCacheFile(fs.paths, "w1");
		const stale = { ...changesEntry("w1", "main", 100, "one"), version: 2 };
		expect((await fs.writeTextAtomic(file, JSON.stringify(stale))).ok).toBe(true);

		const loaded = await cache.loadChanges("w1" as WorkspaceId, "main");

		expect(loaded.ok ? loaded.value : "failed").toBeNull();
		expect(await fs.exists(file)).toBe(false);
	});

	it("treats an entry for another workspace as a damaged file", async () => {
		const { cache, fs } = createCache();
		const file = changesCacheFile(fs.paths, "w1");
		const wrong = changesEntry("w2", "main", 100, "one");
		expect((await fs.writeTextAtomic(file, JSON.stringify(wrong))).ok).toBe(true);

		const loaded = await cache.loadChanges("w1" as WorkspaceId, "main");

		expect(loaded.ok ? loaded.value : "failed").toBeNull();
		expect(await fs.exists(file)).toBe(false);
	});

	it("treats a file with no value as a miss and moves it to the Trash", async () => {
		const { cache, fs } = createCache();
		const file = changesCacheFile(fs.paths, "w1");
		const empty = { ...changesEntry("w1", "main", 100, "one"), value: null };
		expect((await fs.writeTextAtomic(file, JSON.stringify(empty))).ok).toBe(true);

		const loaded = await cache.loadChanges("w1" as WorkspaceId, "main");

		expect(loaded.ok ? loaded.value : "failed").toBeNull();
		expect(await fs.exists(file)).toBe(false);
	});

	it("skips a write whose content equals the stored content", async () => {
		const { cache, fs, advance } = createCache();
		const entry = changesEntry("w1", "main", 100, "one");
		expect((await cache.saveChanges(entry)).ok).toBe(true);
		const file = changesCacheFile(fs.paths, "w1");
		const before = await fs.stat(file);
		advance(60_000);

		expect((await cache.saveChanges(entry)).ok).toBe(true);
		const after = await fs.stat(file);

		expect(before.ok ? before.value.modifiedAt : null).toBe(
			after.ok ? after.value.modifiedAt : undefined,
		);
	});

	it("does not store one entry that alone is over the limit", async () => {
		const entry = changesEntry("w1", "main", 100, "large");
		const limit = bytes(JSON.stringify(entry)) - 1;
		const { cache, fs } = createCache({ changesMaxBytes: limit });

		const saved = await cache.saveChanges(entry);

		expect(saved.ok).toBe(false);
		if (!saved.ok) expect(saved.error.code).toBe("cache_too_large");
		expect(await fs.exists(changesCacheFile(fs.paths, "w1"))).toBe(false);
	});

	it("moves the oldest other workspace out before a write goes over the limit", async () => {
		const first = changesEntry("w1", "main", 100, "one");
		const second = changesEntry("w2", "main", 200, "two");
		const limit = bytes(JSON.stringify(first)) + bytes(JSON.stringify(second)) - 1;
		const { cache, fs, advance } = createCache({ changesMaxBytes: limit });

		expect((await cache.saveChanges(first)).ok).toBe(true);
		advance(1);
		expect((await cache.saveChanges(second)).ok).toBe(true);

		expect(await fs.exists(changesCacheFile(fs.paths, "w1"))).toBe(false);
		expect(await fs.exists(changesCacheFile(fs.paths, "w2"))).toBe(true);
	});

	it("uses the 25 MB limit by default", async () => {
		expect(CHANGES_CACHE_MAX_BYTES).toBe(25 * 1024 * 1024);
	});

	it("removes both caches of a workspace and leaves the others alone", async () => {
		const { cache, fs } = createCache();
		expect((await cache.saveChanges(changesEntry("w1", "main", 100, "one"))).ok).toBe(true);
		expect((await cache.savePrInfo(prEntry("w1", "main", 100, "one"))).ok).toBe(true);
		expect((await cache.saveChanges(changesEntry("w2", "main", 100, "two"))).ok).toBe(true);
		expect((await cache.savePrInfo(prEntry("w2", "main", 100, "two"))).ok).toBe(true);

		expect((await cache.remove("w1" as WorkspaceId)).ok).toBe(true);

		expect(await fs.exists(changesCacheFile(fs.paths, "w1"))).toBe(false);
		expect(await fs.exists(prInfoCacheFile(fs.paths, "w1"))).toBe(false);
		expect(await fs.exists(changesCacheFile(fs.paths, "w2"))).toBe(true);
		expect(await fs.exists(prInfoCacheFile(fs.paths, "w2"))).toBe(true);
	});
});

describe("DATA-07 cached pull request info", () => {
	it("writes the pull request info of a workspace and reads it back", async () => {
		const { cache } = createCache();
		const entry = prEntry("w1", "main", 1_700_000_000_000, "Fix it");
		expect((await cache.savePrInfo(entry)).ok).toBe(true);

		const loaded = await cache.loadPrInfo("w1" as WorkspaceId, "main");

		expect(loaded.ok ? loaded.value : null).toEqual(entry);
	});

	it("keeps pull request info for each workspace apart", async () => {
		const { cache } = createCache();
		const first = prEntry("w1", "main", 100, "One");
		const second = prEntry("w2", "main", 200, "Two");
		expect((await cache.savePrInfo(first)).ok).toBe(true);
		expect((await cache.savePrInfo(second)).ok).toBe(true);

		const one = await cache.loadPrInfo("w1" as WorkspaceId, "main");
		const two = await cache.loadPrInfo("w2" as WorkspaceId, "main");

		expect(one.ok ? one.value?.value.pullRequest?.title : undefined).toBe("One");
		expect(two.ok ? two.value?.value.pullRequest?.title : undefined).toBe("Two");
	});

	it("is a miss for a branch other than the one in the entry", async () => {
		const { cache } = createCache();
		expect((await cache.savePrInfo(prEntry("w1", "main", 100, "One"))).ok).toBe(true);

		const loaded = await cache.loadPrInfo("w1" as WorkspaceId, "feature");

		expect(loaded.ok ? loaded.value : "failed").toBeNull();
	});

	it("does not store one entry that alone is over the limit", async () => {
		const entry = prEntry("w1", "main", 100, "large");
		const limit = bytes(JSON.stringify(entry)) - 1;
		const { cache, fs } = createCache({ prInfoMaxBytes: limit });

		const saved = await cache.savePrInfo(entry);

		expect(saved.ok).toBe(false);
		if (!saved.ok) expect(saved.error.code).toBe("cache_too_large");
		expect(await fs.exists(prInfoCacheFile(fs.paths, "w1"))).toBe(false);
	});

	it("moves the oldest other workspace out before a write goes over the limit", async () => {
		const first = prEntry("w1", "main", 100, "One");
		const second = prEntry("w2", "main", 200, "Two");
		const limit = bytes(JSON.stringify(first)) + bytes(JSON.stringify(second)) - 1;
		const { cache, fs, advance } = createCache({ prInfoMaxBytes: limit });

		expect((await cache.savePrInfo(first)).ok).toBe(true);
		advance(1);
		expect((await cache.savePrInfo(second)).ok).toBe(true);

		expect(await fs.exists(prInfoCacheFile(fs.paths, "w1"))).toBe(false);
		expect(await fs.exists(prInfoCacheFile(fs.paths, "w2"))).toBe(true);
	});

	it("uses the 5 MB limit by default", async () => {
		expect(PR_INFO_CACHE_MAX_BYTES).toBe(5 * 1024 * 1024);
	});
});
