/**
 * @feature COMP-04 @ file mentions
 * Owns: The '@' trigger: fuzzy search of files and directories in the workspace, and the chip it
 * inserts.
 * Behaviour: ui-map.md 3.5 ('@' mentions: files and directories with fuzzy search, plans, 'Attach
 * current terminal output', linked directories 'Select working directories'), sessions-and-chats.md
 * (mentions are expanded by the sidecar).
 * Data: useFileSearch(workspaceId, query) does the fuzzy search. The chip stores the relative path,
 * and the sidecar expands it.
 * Must handle: No matches ('No files found'); a very large tree (search stays responsive, show the
 * first 20); ignored files are not offered; a mention of a file that is later deleted (chip shows
 * it struck through); Escape closes the popup without removing the typed '@'.
 * Test first: Typing '@rea' offers 'README.md' first; choosing it inserts a chip with the path.
 */
import { notImplemented } from "@conducted/shared";
import type { Node } from "@tiptap/react";

export interface FileMentionItem {
	path: string;
	isDirectory: boolean;
}

export interface FileMentionDeps {
	search: (query: string) => FileMentionItem[];
}

export function createFileMention(_props: FileMentionDeps): Node {
	return notImplemented("COMP-04");
}
