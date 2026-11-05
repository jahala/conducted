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
 * at the file top), renderer failure (error card "Failed to open editor", not a blank panel),
 * and light and dark theme switches.
 * Test first: given an old and new text that differ on line 3, one comment on additions line 3
 * renders its card under that line.
 */
import type { CommentId } from "@conducted/shared";
import { type DiffLineAnnotation, MultiFileDiff, PatchDiff } from "@pierre/diffs/react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { FileDiff } from "../../core/api.ts";
import type { DiffComment } from "../../core/model.ts";
import { ErrorBoundary } from "../../ui/ErrorBoundary.tsx";
import { CommentComposer } from "./CommentComposer.tsx";
import { CommentThread } from "./CommentThread.tsx";
import { DiffWarning, type DiffWarningKind } from "./DiffWarnings.tsx";
import { type CommentAnnotation, commentsToAnnotations } from "./diff-annotations.ts";
import { toDiffOptions } from "./diff-options.ts";
import type { CommentHandlers, CommentTarget, DiffPreferences, DiffTheme } from "./diff-types.ts";
import { GutterCommentButton } from "./GutterCommentButton.tsx";

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
	comments,
	preferences,
	handlers,
	composerTarget,
	onComposerTargetChange,
	focusCommentId,
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
	const byId = useMemo(
		() => new Map(comments.map((comment) => [String(comment.id), comment])),
		[comments],
	);
	const annotations = useMemo(
		() => commentsToAnnotations(comments, diff.path),
		[comments, diff.path],
	);

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

	const renderAnnotation = (annotation: DiffLineAnnotation<CommentAnnotation>): ReactNode => {
		const threadComments = annotation.metadata.commentIds
			.map((id) => byId.get(id))
			.filter((comment): comment is DiffComment => comment !== undefined)
			.sort((left, right) => left.createdAt - right.createdAt);
		const target =
			composerTarget !== null &&
			composerTarget.filePath === diff.path &&
			composerTarget.line === annotation.lineNumber &&
			composerTarget.side === annotation.side
				? composerTarget
				: null;
		return (
			<div
				data-comment-id={annotation.metadata.commentIds[0]}
				className="border-l-2 border-border-strong bg-surface/60"
			>
				{threadComments.length > 0 ? (
					<CommentThread comments={threadComments} handlers={handlers} />
				) : null}
				{target !== null ? (
					<CommentComposer
						mode="new"
						initialBody=""
						suggestionBase={null}
						onSubmit={async (body, _suggestion) => {
							const saved = await handlers.onAdd(target, body);
							if (saved) onComposerTargetChange(null);
							return saved;
						}}
						onCancel={() => onComposerTargetChange(null)}
					/>
				) : null}
			</div>
		);
	};

	const renderGutterUtility = (
		getHoveredLine: () => { lineNumber: number; side: "deletions" | "additions" } | undefined,
	) => (
		<GutterCommentButton
			getHoveredLine={getHoveredLine}
			onAdd={(line) =>
				onComposerTargetChange({
					filePath: diff.path,
					side: line.side,
					line: line.lineNumber,
					endLine: line.lineNumber,
				})
			}
		/>
	);

	const rendererProps = {
		options,
		lineAnnotations: annotations,
		renderAnnotation,
		renderGutterUtility,
		className: "conducted-diff",
	};

	const cannotRender =
		visibleWarning === "binary" ||
		visibleWarning === "too_large" ||
		(visibleWarning === "updating" && diff.oldText === null && diff.newText === null);

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
					resetKey={`${diff.path}:${diff.oldText?.length ?? -1}:${diff.newText?.length ?? -1}:${forceRender}`}
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
