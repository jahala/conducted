/**
 * @feature REV-08 File tab header
 * Owns: the strip at the top of a file tab. The path, the Diff or Edit mode toggle, the diff view
 * options, and the save state.
 * Behaviour: ui-map.md 3.2, File tab ("Toggle file edit mode" is Cmd+E; "View options": "Hide
 * whitespace changes", "Wrap lines"; "Unified view", "Split view", "Entire file").
 * Children: DiffToolbar (diff/DiffToolbar.tsx) in diff mode.
 * Must handle: long paths (middle truncation, full path in a tooltip), a renamed file (old path
 * shown), edit mode disabled for deleted, binary and too-large files, an unsaved dot, a save in
 * flight, and a save error shown inline.
 * Test first: with mode "diff" and a deleted file, the Edit toggle is disabled with a reason.
 */
import { notImplemented } from "@conducted/shared";
import type { DiffPreferences } from "../diff/diff-types.ts";

export interface FileTabHeaderProps {
	path: string;
	oldPath: string | null;
	mode: "diff" | "edit" | "preview";
	onModeChange: (mode: "diff" | "edit" | "preview") => void;
	editDisabledReason: string | null;
	previewAvailable: boolean;
	preferences: DiffPreferences;
	onPreferencesChange: (next: DiffPreferences) => void;
	dirty: boolean;
	saving: boolean;
	saveError: string | null;
	onSave: () => void;
}

export function FileTabHeader(_props: FileTabHeaderProps): never {
	return notImplemented("REV-08");
}
