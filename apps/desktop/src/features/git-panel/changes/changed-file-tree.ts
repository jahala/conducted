/**
 * @feature REV-01 Changed file tree model
 * Owns: pure functions that turn the flat changed-file list into what the list renders: filtered,
 * sorted, and optionally grouped into folders.
 * Behaviour: ui-map.md 3.6, Changes paragraph ("Filter changed files", "Show flat list" or "Show
 * folder hierarchy"). Conflicted files come first (research: conflict badge; the ordering is
 * Our design choice).
 * Must handle: an empty list, a filter that matches the path or the old path of a renamed file,
 * case-insensitive matching, folders that hold one child folder merged into one node, stable
 * order between calls so the list does not jump, and paths with no folder.
 * Test first: ["src/a/x.ts", "src/a/y.ts", "README.md"] in folder view gives one folder node
 * "src/a" with two files, then README.md.
 */
import { notImplemented } from "@conducted/shared";
import type { ChangedFile } from "../../../core/api.ts";

export type ChangedTreeNode =
	| { kind: "file"; file: ChangedFile; depth: number }
	| {
			kind: "folder";
			/** Joined path of a merged chain, e.g. "src/features/diff". */
			path: string;
			depth: number;
			linesAdded: number;
			linesRemoved: number;
	  };

export function filterChangedFiles(_files: ChangedFile[], _query: string): ChangedFile[] {
	return notImplemented("REV-01");
}

/** Flat view returns file nodes at depth 0. Folder view returns folders and files in display order. */
export function buildChangedTree(
	_files: ChangedFile[],
	_view: "flat" | "folders",
	_collapsedFolders: ReadonlySet<string>,
): ChangedTreeNode[] {
	return notImplemented("REV-01");
}
