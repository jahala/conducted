/**
 * @feature REV-03 Comment annotations
 * Owns: the pure mapping from stored comments to the renderer's line annotations, and back from a
 * clicked line to a CommentTarget.
 * Behaviour: ui-map.md 3.6 ("Diff and review comments"); services-map.md 3.7.4 (a thread has a
 * root and replies; GitHub threads can be outdated or resolved).
 * Renderer reference: `DiffLineAnnotation<T>` is { side: "deletions" | "additions", lineNumber,
 * metadata: T } from "@pierre/diffs/react". Use lineNumber 0 for a whole-file comment.
 * Must handle: replies grouped under their root by threadId (or replyToId), several threads on one
 * line (one annotation per line holding all threads), a multi-line comment (anchored at endLine),
 * a comment with no line (whole file), resolved threads (kept, collapsed), outdated comments (put
 * at file level with an outdated marker), and the comment's `side` ("deletions" or "additions") choosing
 * which column of a split diff carries the annotation.
 * Test first: two comments in one thread on line 7 give one annotation on line 7 with both ids.
 */
import { notImplemented } from "@conducted/shared";
import type { DiffLineAnnotation } from "@pierre/diffs/react";
import type { DiffComment } from "../../core/model.ts";

/** The data attached to one annotation: the ids of every comment drawn at that line. */
export interface CommentAnnotation {
	threadIds: string[];
	commentIds: string[];
}

export function commentsToAnnotations(
	_comments: readonly DiffComment[],
	_filePath: string,
): DiffLineAnnotation<CommentAnnotation>[] {
	return notImplemented("REV-03");
}
