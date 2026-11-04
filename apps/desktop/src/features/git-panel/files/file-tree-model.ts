/**
 * @feature REV-06 File tree model
 * Owns: pure functions that turn the flat path list from useFileTree into visible tree rows, given
 * which folders are expanded and the filter text.
 * Behaviour: ui-map.md 3.6, "All files" paragraph ("Filter files").
 * Must handle: folders sorted before files and both alphabetically (Our design choice), a filter
 * that keeps the parents of every match visible and expanded, case-insensitive matching on the whole
 * path, a path list with no folder entries (folders implied by file paths), and 100,000 entries
 * without blocking (the function is linear in the entry count).
 * Test first: entries ["a/b.ts", "a/c.ts", "d.ts"] with "a" collapsed give rows a, d.ts; expanded
 * they give a, a/b.ts, a/c.ts, d.ts.
 */
import { notImplemented } from "@conducted/shared";

export interface FileTreeEntry {
	path: string;
	isDirectory: boolean;
}

export interface FileTreeRowModel {
	path: string;
	name: string;
	depth: number;
	isDirectory: boolean;
	expanded: boolean;
}

export function buildFileTreeRows(
	_entries: readonly FileTreeEntry[],
	_expanded: ReadonlySet<string>,
	_filter: string,
): FileTreeRowModel[] {
	return notImplemented("REV-06");
}
