/**
 * @feature REV-02 Diff viewer types
 * Owns: the types shared by the diff viewer files: user preferences, comment targets, and the
 * handler bundle the viewer calls. Types only, no logic.
 * Behaviour: ui-map.md 3.6 ("Diff and review comments") and 3.2 (File tab: "Unified view", "Split
 * view", "Entire file", "Hide whitespace changes", "Wrap lines").
 * Our design choice: the viewer takes handlers as one object, so a screen can pass the real
 * useActions().comments functions and a test can pass recorders.
 * Must handle: nothing, there is no runtime code in this file.
 * Test first: none. The compiler checks every file that uses these types.
 */
import type { CommentId } from "@conducted/shared";

/** The side of a diff a line number belongs to. Matches the renderer's own naming. */
export type DiffSide = "deletions" | "additions";

/** The colour theme the renderer draws with; `type` selects the matching default. */
export interface DiffTheme {
	name: string;
	type: "light" | "dark";
}

export interface DiffPreferences {
	layout: "unified" | "split";
	/** Show the whole file with changes marked, not only the changed hunks. */
	entireFile: boolean;
	hideWhitespaceChanges: boolean;
	wrapLines: boolean;
	ligatures: boolean;
}

/** Where a new comment is being written. `line` null means the whole file. */
export interface CommentTarget {
	filePath: string;
	side: DiffSide;
	line: number | null;
	endLine: number | null;
}

export interface CommentHandlers {
	onAdd: (target: CommentTarget, body: string) => Promise<boolean>;
	onEdit: (id: CommentId, body: string) => Promise<boolean>;
	onDelete: (id: CommentId) => Promise<boolean>;
	onSetResolved: (id: CommentId, resolved: boolean) => Promise<boolean>;
	onSendToChat: (ids: CommentId[]) => void;
}
