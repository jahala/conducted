import type { WorkspaceId } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import { createTestContainer } from "../../test/container.ts";
import type { ChangesSnapshot } from "../git/status.ts";
import {
	changesCacheFile,
	createGitCache,
	GIT_CACHE_VERSION,
	type GitCacheEntry,
} from "./git-cache.ts";

const snapshot: ChangesSnapshot = {
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
	commits: [],
	sync: { ahead: 0, behind: 0, rewritten: false, hasUpstream: false },
	behindTarget: 0,
};

describe("DATA-07 the cache uses the app data platform the container builds", () => {
	it("round-trips a changes snapshot over the real container's platform", async () => {
		const test = createTestContainer();
		try {
			const cache = createGitCache({ fs: test.container.platform.fs });
			const entry: GitCacheEntry<ChangesSnapshot> = {
				version: GIT_CACHE_VERSION,
				workspaceId: "w1" as WorkspaceId,
				branch: "main",
				observedAt: 1_700_000_000_000,
				value: snapshot,
			};

			expect((await cache.saveChanges(entry)).ok).toBe(true);
			const loaded = await cache.loadChanges("w1" as WorkspaceId, "main");

			expect(loaded.ok ? loaded.value : null).toEqual(entry);
			expect(
				await test.container.platform.fs.exists(
					changesCacheFile(test.container.platform.fs.paths, "w1"),
				),
			).toBe(true);
		} finally {
			await test.container.stop();
			test.close();
		}
	});
});
