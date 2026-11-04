/**
 * @feature REV-07 Search in files
 * Owns: The Cmd+Shift+F dialog that searches file contents in the workspace and opens a match.
 * Behaviour: ui-map.md 3.6 (search in files Cmd+Shift+F with Match case, Whole word, Regular
 * expression), 3.10.
 * Data: useContentSearch(workspaceId, query, { matchCase, wholeWord, regex }), which greps through
 * the Platform file search (PLAT-06). Results are grouped by file, with the line text and the match
 * marked.
 * Must handle: Invalid regular expression (message under the box, no search); thousands of matches
 * (first 200, 'Refine your search'); a slow search can be replaced by typing again (older results
 * are dropped); binary and ignored files are skipped; no workspace selected.
 * Test first: Searching 'retry' returns matches grouped by file; turning on 'Whole word' removes
 * 'retrying'.
 */
import { notImplemented } from "@conducted/shared";
import type { OverlayProps } from "../../ui/overlay-props.ts";

export function SearchInFiles(_props: OverlayProps): never {
	return notImplemented("REV-07");
}
