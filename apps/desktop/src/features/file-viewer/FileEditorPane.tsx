/**
 * @feature REV-08 File editor pane
 * Owns: the edit mode of the File tab. It owns the draft text, save, and the disk-change check.
 * Behaviour: ui-map.md 3.2 (edit uses CodeMirror, find and replace bar, "File changed on disk":
 * "Discard my edits" or "Keep mine").
 * Data: useFileContent and useActions().files.write.
 * Children: editor/EditorSurface, editor/FindReplaceBar, ExternalChangeBanner, FileTabState.
 * Our design choice: save writes through a temp file and rename (Platform.fs.writeTextAtomic), and
 * passes the modified time it read, so a write over a newer disk version is refused and the banner
 * is shown.
 * Must handle: save failing (draft kept, error shown), disk change while clean (silently reload),
 * disk change while dirty (banner), the file deleted while open, line endings and a final newline
 * preserved, very large files (read-only), and leaving the tab with unsaved edits.
 * Test first: with a dirty draft and a newer modified time on disk, the banner shows and the draft
 * is unchanged.
 */
import type { WorkspaceId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";

export interface FileEditorPaneProps {
	workspaceId: WorkspaceId;
	path: string;
	onDirtyChange: (dirty: boolean) => void;
}

export function FileEditorPane(_props: FileEditorPaneProps): never {
	return notImplemented("REV-08");
}
