/**
 * @feature REV-06 Workspace files: tree, quick open, read and write
 * Owns: listing a workspace's files, fuzzy file search, and reading and saving a file for the
 * viewer and editor.
 * Behaviour: services-map.md 5A.5 (transport pattern, UI queries), ui-map.md 3.6 (All files tab,
 * quick open). The tab polls `tree` because JS file watchers do nothing under CEF
 * (services-map.md 5A.9).
 * Must handle: paths outside the workspace folder (and its linked folders) are refused before any
 * file is read or written; the tree respects `.gitignore` (done by the Rust search commands); a
 * blank quick-open query returns no rows; saving writes atomically and refuses when the file
 * changed on disk since it was opened (returns a conflict Err with the new modified time).
 * Our design choice: the base path check compares resolved paths in TypeScript before every file
 * call, in addition to whatever the Rust side checks.
 * Test first: readFile("../outside") returns an Err with code `path_outside_workspace`.
 */
import {
	appError,
	err,
	notImplemented,
	ok,
	type Result,
	type WorkspaceId,
} from "@conducted/shared";
import type { FileSearch, FileSystem, GrepMatch, TreeEntry } from "../../platform/platform.ts";
import type { ConflictChoice, DiffScope, FileEntry } from "../api.ts";
import { workspaceRelativePath } from "./git.ts";

export interface WorkspaceFilesServiceDeps {
	fs: FileSystem;
	search: FileSearch;
	/** Workspace folder plus linked folders that are allowed. */
	rootsOf: (workspaceId: WorkspaceId) => Promise<Result<string[]>>;
}

interface ResolvedPath {
	root: string;
	/** Relative to the workspace root, with no leading slash. */
	relative: string;
	absolute: string;
}

const trimRoot = (root: string): string => (root === "/" ? "" : root.replace(/\/+$/, ""));

const toRelative = (root: string, path: string): string | null => {
	const base = trimRoot(root);
	if (base === "") return path.startsWith("/") ? path.slice(1) : path;
	if (path === base) return "";
	const prefix = `${base}/`;
	return path.startsWith(prefix) ? path.slice(prefix.length) : null;
};

const toEntries = (root: string, entries: readonly TreeEntry[]): FileEntry[] => {
	const result: FileEntry[] = [];
	for (const entry of entries) {
		const relative = toRelative(root, entry.path);
		if (relative === null || relative.length === 0) continue;
		result.push({ path: relative, isDirectory: entry.isDirectory });
	}
	return result.sort((left, right) => left.path.localeCompare(right.path));
};

export class WorkspaceFilesService {
	readonly #deps: WorkspaceFilesServiceDeps;

	constructor(deps: WorkspaceFilesServiceDeps) {
		this.#deps = deps;
	}

	/** Backs `useFileTree`. The platform lists the whole tree; the tab shows depth 1 until expanded. */
	async tree(workspaceId: WorkspaceId): Promise<Result<FileEntry[]>> {
		const root = await this.#rootOf(workspaceId);
		if (!root.ok) return root;
		const listed = await this.#deps.search.listTree(root.value);
		if (!listed.ok) return listed;
		return ok(toEntries(root.value, listed.value));
	}

	async quickOpen(
		workspaceId: WorkspaceId,
		query: string,
		limit: number,
	): Promise<Result<FileEntry[]>> {
		const root = await this.#rootOf(workspaceId);
		if (!root.ok) return root;
		const trimmed = query.trim();
		const count = Math.max(0, Math.floor(limit));
		if (trimmed.length === 0 || count === 0) return ok([]);
		const found = await this.#deps.search.fuzzyMatch(root.value, trimmed, count);
		if (!found.ok) return found;
		return ok(toEntries(root.value, found.value));
	}

	grep(
		_workspaceId: WorkspaceId,
		_query: string,
		_options: { caseSensitive: boolean; wholeWord: boolean; regex: boolean },
	): Promise<Result<GrepMatch[]>> {
		return notImplemented("REV-07");
	}

	async readFile(
		workspaceId: WorkspaceId,
		relativePath: string,
	): Promise<Result<{ text: string; modifiedAt: number }>> {
		const resolved = await this.#resolve(workspaceId, relativePath);
		if (!resolved.ok) return resolved;
		const stat = await this.#deps.fs.stat(resolved.value.absolute);
		if (!stat.ok) return stat;
		const read = await this.#deps.fs.readText(resolved.value.absolute);
		if (!read.ok) return read;
		return ok({ text: read.value, modifiedAt: stat.value.modifiedAt });
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
	async saveFile(
		workspaceId: WorkspaceId,
		relativePath: string,
		text: string,
		expectedModifiedAt: number,
	): Promise<Result<{ modifiedAt: number }>> {
		const resolved = await this.#resolve(workspaceId, relativePath);
		if (!resolved.ok) return resolved;
		const stat = await this.#deps.fs.stat(resolved.value.absolute);
		if (!stat.ok) {
			if (stat.error.code === "fs_not_found") {
				return err(
					appError("missing", `"${relativePath}" is no longer in the workspace.`, stat.error),
				);
			}
			return stat;
		}
		if (stat.value.modifiedAt !== expectedModifiedAt) {
			return err(
				appError("changed_on_disk", `"${relativePath}" changed on disk after it was opened.`, {
					modifiedAt: stat.value.modifiedAt,
				}),
			);
		}
		const written = await this.#deps.fs.writeTextAtomic(resolved.value.absolute, text);
		if (!written.ok) {
			return err(appError("other", written.error.message, written.error));
		}
		const after = await this.#deps.fs.stat(resolved.value.absolute);
		if (!after.ok) return after;
		return ok({ modifiedAt: after.value.modifiedAt });
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

	async #rootOf(workspaceId: WorkspaceId): Promise<Result<string>> {
		const roots = await this.#deps.rootsOf(workspaceId);
		if (!roots.ok) return roots;
		const root = roots.value[0];
		if (root === undefined) {
			return err(appError("workspace_path_missing", "That workspace has no folder on this Mac."));
		}
		return ok(root);
	}

	/**
	 * Resolves a workspace-relative path against the first root that holds it. The checked path
	 * can never be absolute or climb with `..`, so the result stays inside one allowed root.
	 */
	async #resolve(workspaceId: WorkspaceId, relativePath: string): Promise<Result<ResolvedPath>> {
		const checked = workspaceRelativePath(relativePath);
		if (!checked.ok) return checked;
		const roots = await this.#deps.rootsOf(workspaceId);
		if (!roots.ok) return roots;
		if (roots.value.length === 0) {
			return err(appError("workspace_path_missing", "That workspace has no folder on this Mac."));
		}
		const candidates: ResolvedPath[] = roots.value.map((root) => ({
			root,
			relative: checked.value,
			absolute: `${trimRoot(root)}/${checked.value}`,
		}));
		for (const candidate of candidates) {
			if (await this.#deps.fs.exists(candidate.absolute)) return ok(candidate);
		}
		const first = candidates[0];
		if (first === undefined) {
			return err(appError("workspace_path_missing", "That workspace has no folder on this Mac."));
		}
		return ok(first);
	}
}
