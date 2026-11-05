/**
 * @feature REV-02 Diff view
 * Owns: rendering one file's diff with @pierre/diffs, its warnings, and the error card when the
 * renderer fails. It does not fetch anything and it draws no comments itself.
 * Behaviour: ui-map.md 3.6 ("Diff renderer: @pierre/diffs"), 3.2 (File tab, diff mode);
 * services-map.md 3.4.2 (the renderer computes the diff in the browser from the two file texts).
 * Renderer reference: `FileDiff`, `MultiFileDiff` and `PatchDiff` from "@pierre/diffs/react". Use
 * MultiFileDiff with oldFile and newFile ({ name, contents }) when both texts exist, and PatchDiff
 * with FileDiff.patch otherwise. Options come from diff-options.ts.
 * Comments: the comment layer (REV-03) computes the line annotations and supplies
 * `renderAnnotation`, which draws a thread under its line. DiffView only places the slots. The
 * gutter's add-comment control comes in as `renderGutterUtility`.
 * Children: DiffWarnings.
 * Must handle: binary file (warning, no render), huge diff (guard from FileDiff.tooLarge: warning
 * with "Render anyway"), only-whitespace changes (warning with "Show whitespace changes"), file
 * added or deleted (one side empty), a diff that updates while it is on screen (the old diff stays
 * with an "Updating diff" notice), renderer failure (error card "Failed to open editor", not a
 * blank panel), and light and dark theme switches.
 * Test first: given an old and new text that differ on line 3, the real renderer draws the new
 * line under the split layout.
 */
import type { CommentId } from "@conducted/shared";
import { type DiffLineAnnotation, MultiFileDiff, PatchDiff } from "@pierre/diffs/react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { FileDiff } from "../../core/api.ts";
import { ErrorBoundary } from "../../ui/ErrorBoundary.tsx";
import { DiffWarning, type DiffWarningKind } from "./DiffWarnings.tsx";
import type { CommentAnnotation } from "./diff-annotations.ts";
import { toDiffOptions } from "./diff-options.ts";
import type { DiffPreferences, DiffSide, DiffTheme } from "./diff-types.ts";

export interface DiffViewProps {
	diff: FileDiff;
	preferences: DiffPreferences;
	/** Line annotations from the comment layer. No annotations means no comment slots. */
	annotations?: DiffLineAnnotation<CommentAnnotation>[];
	/** Draws one annotation under its line. Supplied by the comment layer (REV-03). */
	renderAnnotation?: (annotation: DiffLineAnnotation<CommentAnnotation>) => ReactNode;
	/** Draws the gutter's add-comment control. Supplied by the comment layer (REV-03). */
	renderGutterUtility?: (
		getHoveredLine: () => { lineNumber: number; side: DiffSide } | undefined,
	) => ReactNode;
	/** Scrolls to this comment, e.g. when opened from the Checks tab. */
	focusCommentId?: CommentId | null;
	/** True when the user overrides the large-file guard. */
	forceRender: boolean;
	onForceRender: () => void;
	/** The colours of the current app theme. */
	theme?: DiffTheme;
	/** A diff of the file is on the way; the current one stays on screen. */
	updating?: boolean;
	/** Lets the whitespace warning turn whitespace changes back on. */
	onPreferencesChange?: (next: DiffPreferences) => void;
}

/** True when the two texts differ only in whitespace (spaces, tabs and line endings). */
export function isWhitespaceOnlyChange(oldText: string | null, newText: string | null): boolean {
	if (oldText === null || newText === null || oldText === newText) return false;
	return oldText.replace(/\s+/g, "") === newText.replace(/\s+/g, "");
}

/** A small content fingerprint, so a dismissed warning returns when the file's text changes. */
function contentHash(text: string | null): number {
	if (text === null) return 0;
	let hash = 2_166_136_261;
	for (let index = 0; index < text.length; index += 1) {
		hash ^= text.charCodeAt(index);
		hash = Math.imul(hash, 16_777_619);
	}
	return hash >>> 0;
}

const DEFAULT_THEME: DiffTheme = { name: "", type: "light" };

export function DiffView({
	diff,
	preferences,
	annotations,
	renderAnnotation,
	renderGutterUtility,
	focusCommentId = null,
	forceRender,
	onForceRender,
	theme = DEFAULT_THEME,
	updating = false,
	onPreferencesChange,
}: DiffViewProps) {
	const rootRef = useRef<HTMLDivElement>(null);
	const resetKey = `${diff.path}:${contentHash(diff.oldText)}:${contentHash(diff.newText)}:${
		diff.binary ? "binary" : "text"
	}:${diff.tooLarge ? "large" : "small"}`;
	const [dismissed, setDismissed] = useState<{ key: string; kind: DiffWarningKind } | null>(null);

	const options = useMemo(() => toDiffOptions(preferences, theme), [preferences, theme]);

	useEffect(() => {
		if (focusCommentId === null) return;
		const element = rootRef.current?.querySelector(`[data-comment-id="${String(focusCommentId)}"]`);
		element?.scrollIntoView?.({ block: "center" });
	}, [focusCommentId]);

	const whitespaceOnly = isWhitespaceOnlyChange(diff.oldText, diff.newText);
	let warning: DiffWarningKind | null = null;
	if (updating) warning = "updating";
	else if (diff.binary) warning = "binary";
	else if (diff.tooLarge && !forceRender) warning = "too_large";
	else if (whitespaceOnly && preferences.hideWhitespaceChanges) warning = "whitespace_only";

	const warningAction = (kind: DiffWarningKind) => {
		if (kind === "too_large") onForceRender();
		if (kind === "whitespace_only") {
			onPreferencesChange?.({ ...preferences, hideWhitespaceChanges: false });
		}
	};

	const visibleWarning =
		dismissed !== null && dismissed.key === resetKey && dismissed.kind === warning ? null : warning;

	const rendererProps = {
		options,
		lineAnnotations: annotations,
		renderAnnotation,
		renderGutterUtility,
		className: "conducted-diff",
	};

	// Whether the diff may be drawn does not depend on the warning being on screen: dismissing the
	// "too large" notice, or an "updating" notice taking its place, must not draw the huge file.
	const cannotRender =
		diff.binary ||
		(diff.tooLarge && !forceRender) ||
		(updating && diff.oldText === null && diff.newText === null);

	const oldFile = diff.oldText === null ? null : { name: diff.path, contents: diff.oldText };
	const newFile = diff.newText === null ? null : { name: diff.path, contents: diff.newText };
	let content: ReactNode = null;
	if (!cannotRender) {
		if (oldFile !== null && newFile !== null) {
			content = (
				<MultiFileDiff<CommentAnnotation, undefined>
					oldFile={oldFile}
					newFile={newFile}
					{...rendererProps}
				/>
			);
		} else if (oldFile !== null) {
			content = (
				<MultiFileDiff<CommentAnnotation, undefined>
					oldFile={oldFile}
					newFile={null}
					{...rendererProps}
				/>
			);
		} else if (newFile !== null) {
			content = (
				<MultiFileDiff<CommentAnnotation, undefined>
					oldFile={null}
					newFile={newFile}
					{...rendererProps}
				/>
			);
		} else if (diff.patch.length > 0) {
			content = <PatchDiff<CommentAnnotation, undefined> patch={diff.patch} {...rendererProps} />;
		}
	}

	return (
		<div ref={rootRef} className="flex h-full min-h-0 flex-col overflow-auto">
			{visibleWarning !== null ? (
				<DiffWarning
					kind={visibleWarning}
					onAction={() => warningAction(visibleWarning)}
					onDismiss={() => {
						if (visibleWarning !== null) setDismissed({ key: resetKey, kind: visibleWarning });
					}}
				/>
			) : null}
			{cannotRender ? null : (
				<ErrorBoundary
					resetKey={`${diff.path}:${diff.oldText?.length ?? -1}:${diff.newText?.length ?? -1}:${
						forceRender
					}:${preferences.layout}:${preferences.wrapLines}:${
						preferences.hideWhitespaceChanges
					}:${preferences.entireFile}`}
					fallback={(_error, reset) => (
						<DiffWarning kind="render_failed" onAction={reset} onDismiss={reset} />
					)}
				>
					{content}
				</ErrorBoundary>
			)}
		</div>
	);
}
