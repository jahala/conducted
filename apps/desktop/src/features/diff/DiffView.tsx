/**
 * @feature REV-02 Diff view
 * Owns: rendering one file's diff with @pierre/diffs, with inline comment threads and the comment
 * composer. It is used by the File tab (diff mode). It does not fetch anything.
 * Behaviour: ui-map.md 3.6 ("Diff renderer: @pierre/diffs"), 3.2 (File tab, diff mode);
 * services-map.md 3.4.2 (the renderer computes the diff in the browser from the two file texts).
 * Renderer reference: `FileDiff`, `MultiFileDiff` and `PatchDiff` from "@pierre/diffs/react". Use
 * MultiFileDiff with oldFile and newFile ({ name, contents }) when both texts exist, and PatchDiff
 * with FileDiff.patch otherwise. Comments are `lineAnnotations` ({ side, lineNumber, metadata })
 * drawn by `renderAnnotation`; the add-comment affordance is `renderGutterUtility`; options come
 * from diff-options.ts.
 * Children: DiffToolbar (in the File tab header), DiffWarnings, CommentThread, CommentComposer,
 * GutterCommentButton.
 * Must handle: binary file (warning, no render), huge diff (guard from FileDiff.tooLarge: warning
 * with "Render anyway"), only-whitespace changes (warning with "Show whitespace changes"), file
 * added or deleted (one side empty), a diff that updates while the user is typing a comment (the
 * composer keeps its text and line), a comment on a line that no longer exists (shown as outdated
 * at the file top), renderer failure (error card "Failed to open the diff", not a blank panel),
 * and light and dark theme switches.
 * Test first: given an old and new text that differ on line 3, one comment on additions line 3
 * renders its card under that line.
 */
import type { CommentId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";
import type { FileDiff } from "../../core/api.ts";
import type { DiffComment } from "../../core/model.ts";
import type { CommentHandlers, CommentTarget, DiffPreferences } from "./diff-types.ts";

export interface DiffViewProps {
	diff: FileDiff;
	/** Only the comments for this file. */
	comments: DiffComment[];
	preferences: DiffPreferences;
	handlers: CommentHandlers;
	/** The line the user is writing a new comment on, or null. */
	composerTarget: CommentTarget | null;
	onComposerTargetChange: (target: CommentTarget | null) => void;
	/** Scrolls to and highlights this comment, e.g. when opened from the Checks tab. */
	focusCommentId: CommentId | null;
	/** True when the user overrides the large-file guard. */
	forceRender: boolean;
	onForceRender: () => void;
}

export function DiffView(_props: DiffViewProps): never {
	return notImplemented("REV-02");
}
