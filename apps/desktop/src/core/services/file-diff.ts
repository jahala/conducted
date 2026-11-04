/**
 * @feature REV-02 File diff content for the diff viewer
 * Owns: producing the old text, new text and patch of one file for a diff scope, with a cache and
 * prefetch of the next files.
 * Behaviour: services-map.md 3.4.2 and 3.4.3 (file contents from git and disk, patch form,
 * guard counts), 2.7.2 (diff cache limit 25 MB), ui-map.md 3.6 (warnings: whitespace only,
 * binary, updating).
 * Must handle: a file added (no old side) or deleted (no new side); a rename (old side read from
 * the old path); the new side of the working-tree comparison is read from disk, not from git;
 * binary files return `binary: true` and no text; files over the size or line limit return
 * `tooLarge: true` and no text; an untracked file is diffed against /dev/null; the cache key
 * includes the two refs and the file's modified time, so an edit invalidates it; the cache
 * evicts the oldest entries beyond 25 MB; a late answer for an older key is dropped.
 * Our design choice: the diff itself is computed in the browser by the diff viewer from old and
 * new text; `patch` is only filled when a renderer asks for it (`withPatch`).
 * Test first: a deleted file returns oldText and a null newText.
 */
import { notImplemented, type Result, type WorkspaceId } from "@conducted/shared";
import type { FileSystem } from "../../platform/platform.ts";
import type { DiffScope, FileDiff } from "../api.ts";
import type { GitRunner } from "../git/runner.ts";

export const FILE_DIFF_CACHE_BYTES = 25 * 1024 * 1024;

export interface FileDiffServiceDeps {
	git: GitRunner;
	fs: Pick<FileSystem, "readText" | "stat">;
	/** Workspace folder and the facts the scope needs (merge bases, checkpoint refs). */
	resolveScope: (
		workspaceId: WorkspaceId,
		scope: DiffScope,
	) => Promise<Result<{ cwd: string; from: string; to: string | null }>>;
}

export class FileDiffService {
	readonly #deps: FileDiffServiceDeps;

	constructor(deps: FileDiffServiceDeps) {
		this.#deps = deps;
	}

	/** Backs `useFileDiff`. */
	load(
		_workspaceId: WorkspaceId,
		_path: string,
		_scope: DiffScope,
		_options: { withPatch: boolean; ignoreWhitespace: boolean },
	): Promise<Result<FileDiff>> {
		void this.#deps;
		return notImplemented("REV-02");
	}

	/** Warms the cache for files the user is likely to open next. Errors are ignored. */
	prefetch(_workspaceId: WorkspaceId, _paths: readonly string[], _scope: DiffScope): Promise<void> {
		return notImplemented("REV-02");
	}

	/** Drops cached entries of a workspace, for example after a revert. */
	invalidate(_workspaceId: WorkspaceId): void {
		notImplemented("REV-02");
	}
}
