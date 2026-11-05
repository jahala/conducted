/**
 * @feature REV-06 Workspace files: tree, quick open, search, read and write
 * Owns: listing a workspace's files, fuzzy file search, text search, and reading and saving a file
 * for the viewer and editor.
 * Behaviour: services-map.md 5A.5 (transport pattern, UI queries, min grep length 2, polling the
 * tree), ui-map.md 3.6 (All files tab, quick open, search in files), 3.2 (file tabs).
 * Must handle: paths outside the workspace folder (and its linked folders) are refused; the tree
 * respects `.gitignore` (done by the Rust search commands); a search query under two characters
 * returns nothing; a bad regular expression returns an Err with the pattern error; saving writes
 * atomically and refuses when the file changed on disk since it was opened (returns a conflict
 * Err with the new modified time); large files open read-only; symlinks outside the workspace are
 * not followed for writes; the tree is polled while shown, every 30 s, because the worktree is
 * not watched.
 * Our design choice: the base path check compares resolved paths in TypeScript before every
 * file call, in addition to whatever the Rust side checks.
 * Test first: readFile("../outside") returns an Err with code `path_outside_workspace`.
 */
import { notImplemented, type Result, type WorkspaceId } from "@conducted/shared";
import type { FileSearch, FileSystem, GrepMatch, TreeEntry } from "../../platform/platform.ts";
import type { ConflictChoice, DiffScope } from "../api.ts";

export interface WorkspaceFilesServiceDeps {
	fs: FileSystem;
	search: FileSearch;
	/** Workspace folder plus linked folders that are allowed. */
	rootsOf: (workspaceId: WorkspaceId) => Promise<Result<string[]>>;
}

export class WorkspaceFilesService {
	readonly #deps: WorkspaceFilesServiceDeps;

	constructor(deps: WorkspaceFilesServiceDeps) {
		this.#deps = deps;
	}

	/** Backs `useFileTree`. */
	tree(_workspaceId: WorkspaceId): Promise<Result<TreeEntry[]>> {
		void this.#deps;
		return notImplemented("REV-06");
	}

	quickOpen(
		_workspaceId: WorkspaceId,
		_query: string,
		_limit: number,
	): Promise<Result<TreeEntry[]>> {
		return notImplemented("REV-07");
	}

	grep(
		_workspaceId: WorkspaceId,
		_query: string,
		_options: { caseSensitive: boolean; wholeWord: boolean; regex: boolean },
	): Promise<Result<GrepMatch[]>> {
		return notImplemented("REV-07");
	}

	readFile(
		_workspaceId: WorkspaceId,
		_relativePath: string,
	): Promise<Result<{ text: string; modifiedAt: number }>> {
		return notImplemented("REV-08");
	}

	/** Backs `Actions.files.open`: asks the workspace screen to show the file in a tab. */
	open(
		_workspaceId: WorkspaceId,
		_relativePath: string,
		_mode: "diff" | "edit",
		_scope: DiffScope,
	): Promise<Result<void>> {
		return notImplemented("REV-08");
	}

	/** Backs `Actions.files.write`. Fails with code "changed_on_disk" when the file moved on. */
	saveFile(
		_workspaceId: WorkspaceId,
		_relativePath: string,
		_text: string,
		_expectedModifiedAt: number,
	): Promise<Result<{ modifiedAt: number }>> {
		return notImplemented("REV-08");
	}

	/** Backs `Actions.files.resolveConflicts`. Malformed markers fail without changing the file. */
	resolveConflicts(
		_workspaceId: WorkspaceId,
		_path: string,
		_choices: readonly ConflictChoice[],
	): Promise<Result<void>> {
		return notImplemented("REV-11");
	}

	/** Backs `Actions.artifacts.loadMore`. */
	loadMoreArtifacts(_workspaceId: WorkspaceId): Promise<Result<void>> {
		return notImplemented("REV-10");
	}

	/** Backs `Actions.artifacts.upload`. */
	uploadArtifacts(_workspaceId: WorkspaceId, _paths: readonly string[]): Promise<Result<void>> {
		return notImplemented("REV-10");
	}
}
