/**
 * @feature DATA-07 Cache of the last changes and pull request info of each workspace
 * Owns: tests that reach the cache through the real composition root: a full poll is saved, the
 * startup step paints the saved value before any poll, pull request info is saved, and deleting a
 * workspace removes its files.
 * Behaviour: services-map.md 2.7.2, 3.3.1, 5B.1.5.
 * Test first: a full poll through the container leaves a cache file holding the polled snapshot.
 */
import { ok, type Result, type WorkspaceId } from "@conducted/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ShellCommand, ShellOutput } from "../../platform/platform.ts";
import {
	createTestContainer,
	seedRepo,
	seedWorkspace,
	type TestContainer,
} from "../../test/container.ts";
import type { ChangesSnapshot } from "../git/status.ts";
import {
	changesCacheFile,
	createGitCache,
	GIT_CACHE_VERSION,
	type GitCacheEntry,
	prInfoCacheFile,
} from "./git-cache.ts";
import type { WorkspacePrEntry } from "./github.ts";

const must = <T>(result: Result<T>): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

const output = (stdout = "", stderr = "", exitCode = 0): Result<ShellOutput> =>
	ok({ stdout, stderr, exitCode });

/** Answers a full git poll of a workspace on branch "feature" with two commits ahead. */
function pollShell(command: ShellCommand): Result<ShellOutput> | null {
	if (command.program === "stat") return output("", "", 1);
	if (command.program !== "git") return null;
	const args = command.args;
	if (args.includes("--show-current")) return output("feature\n");
	if (args.includes("--git-path")) return output(`/git/${args.at(-1) ?? ""}\n`);
	if (args.includes("merge-base")) return output("merge-base\n");
	if (args.includes("--name-status") || args.includes("--numstat")) return output("");
	if (args.includes("status")) return output("");
	if (args.includes("ls-files")) return output("");
	if (args.includes("--symbolic-full-name")) return output("refs/remotes/origin/feature\n");
	if (args.includes("@{u}")) return output("head-oid\nhead-oid\n");
	if (args.includes("reflog")) return output("head-oid\n");
	if (args.includes("--left-right")) return output("0\t2\n");
	if (args.includes("--count")) return output("2\n");
	if (args.includes("log")) return output("");
	return null;
}

/** Starts the container with the services that have nothing to do with the cache kept quiet. */
function startQuietly(test: TestContainer): Promise<Result<unknown>> {
	const { services } = test.container;
	for (const service of [
		services.repo,
		services.workspace,
		services.sections,
		services.favoriteModels,
		services.terminals,
		services.system,
	]) {
		vi.spyOn(service, "start").mockResolvedValue(ok(undefined) as never);
	}
	vi.spyOn(services.github, "checkAccess").mockResolvedValue(ok({ status: "unknown" }));
	vi.spyOn(services.runScripts, "stopAll").mockResolvedValue(ok(undefined));
	return test.container.start();
}

const prInfo: WorkspacePrEntry = { pullRequest: null, unavailable: "no_pr", fetchedAt: 1_000 };

afterEach(() => {
	vi.restoreAllMocks();
});

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
			).toEqual(ok(true));
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("saves a full poll's changes, which the next start paints before any poll", async () => {
		const test = createTestContainer();
		try {
			const repo = await seedRepo(test.container);
			must(await test.container.services.repo.loadConfig(repo.id));
			const workspace = await seedWorkspace(test.container, { repoId: repo.id, branch: "feature" });
			test.memory.controls.scriptShell(pollShell);
			const fs = test.container.platform.fs;

			must(await test.container.services.git.refresh(workspace.id, "full"));
			const polled = test.container.services.git.store.getState().byWorkspace[workspace.id];
			expect(polled?.snapshot?.depth).toBe("full");
			await vi.waitFor(async () =>
				expect(await fs.exists(changesCacheFile(fs.paths, workspace.id))).toEqual(ok(true)),
			);
			const saved = must(
				await test.container.services.gitCache.loadChanges(workspace.id, "feature"),
			);
			expect(saved?.value).toEqual(polled?.snapshot);

			// A restart starts with an empty store; the startup step paints the saved value.
			test.container.services.git.store.setState({ byWorkspace: {} });
			must(await startQuietly(test));

			expect(test.container.services.git.store.getState().byWorkspace[workspace.id]).toEqual({
				snapshot: saved?.value,
				error: null,
				refreshedAt: null,
			});
		} finally {
			test.container.services.repo.dispose();
			await test.container.stop();
			test.close();
		}
	});

	it("saves the pull request info the GitHub service holds, and paints it at the next start", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container, { branch: "feature" });
			const fs = test.container.platform.fs;

			test.container.services.github.paintCached(workspace.id, prInfo);
			await vi.waitFor(async () =>
				expect(await fs.exists(prInfoCacheFile(fs.paths, workspace.id))).toEqual(ok(true)),
			);
			const saved = must(
				await test.container.services.gitCache.loadPrInfo(workspace.id, "feature"),
			);
			expect(saved?.value).toEqual(prInfo);

			test.container.services.github.store.setState({ byWorkspace: {} });
			must(await startQuietly(test));

			expect(test.container.services.github.store.getState().byWorkspace[workspace.id]).toEqual(
				prInfo,
			);
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("moves a deleted workspace's cache files to the Trash", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container, {
				branch: "feature",
				path: "/code/workspaces/data-07-delete",
			});
			const { gitCache } = test.container.services;
			const fs = test.container.platform.fs;
			const entry = <T>(value: T): GitCacheEntry<T> => ({
				version: GIT_CACHE_VERSION,
				workspaceId: workspace.id,
				branch: "feature",
				observedAt: 1_000,
				value,
			});
			must(await gitCache.savePrInfo(entry(prInfo)));
			must(await gitCache.saveChanges(entry(snapshot)));
			expect(await fs.exists(prInfoCacheFile(fs.paths, workspace.id))).toEqual(ok(true));

			must(await test.container.actions.workspaces.remove(workspace.id));

			expect(await fs.exists(changesCacheFile(fs.paths, workspace.id))).toEqual(ok(false));
			expect(await fs.exists(prInfoCacheFile(fs.paths, workspace.id))).toEqual(ok(false));
		} finally {
			await test.container.stop();
			test.close();
		}
	});
});
