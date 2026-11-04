/**
 * @feature REV-08 FileTab
 * Owns: a center tab showing one file. In diff mode it shows the file's diff, in edit mode a
 * CodeMirror editor, and for previewable types a rendered preview. Entry point embedded by the
 * workspace tab strip.
 * Behaviour: ui-map.md 3.2, "Tab content: File" (modes diff and edit, Cmd+E toggles edit mode,
 * previews for Markdown, SVG, images, PDF, CSV and video, "File changed on disk" banner);
 * services-map.md 3.4.2 (diff texts come from git and from disk).
 * Data: useFileDiff(workspaceId, path, scope), useWorkspace (archived state), useSetting for the
 * diff preferences, useDiffComments. File text for edit mode and previews come from
 * useFileContent; saving goes through useActions().files.write.
 * Children: FileTabHeader, FileDiffPane, FileEditorPane, FilePreviewPane, FileTabState,
 * ExternalChangeBanner.
 * Our design choice: a file with a previewable type opens in preview first; "Edit" and "Diff"
 * switch to the other panes. Saving is explicit with Cmd+S.
 * Must handle: loading, error with retry, file deleted or missing, binary file, file too large to
 * edit, archived workspace ("Workspace archived. Unarchive to view files"), the file changing on
 * disk while the user has edits (banner with Discard my edits or Keep mine), a path outside the
 * workspace (refused), a mode or scope change while a request is in flight (newest answer wins),
 * and unsaved edits when the tab closes (the tab calls `onDirtyChange` so the tab strip can warn).
 * Test first: with mode "diff" and a FileDiff of one changed line the tab shows the diff pane, and
 * switching to "edit" shows the editor with the new text.
 */
import type { WorkspaceId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";
import type { DiffScope } from "../../core/api.ts";

export function FileTab(_props: {
	workspaceId: WorkspaceId;
	path: string;
	mode: "diff" | "edit";
	scope: DiffScope;
	/** Called when the file gains or loses unsaved edits. */
	onDirtyChange?: (dirty: boolean) => void;
}): never {
	return notImplemented("REV-08");
}
