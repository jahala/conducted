/**
 * @feature REV-03 Comment annotations
 * Owns: the pure mapping from stored comments to the renderer's line annotations.
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

import type { CommentId } from "@conducted/shared";
import type { DiffLineAnnotation } from "@pierre/diffs/react";
import type { DiffComment } from "../../core/model.ts";
import type { DiffSide } from "./diff-types.ts";

/** The data attached to one annotation: the ids of every comment drawn at that line. */
export interface CommentAnnotation {
	threadIds: string[];
	commentIds: string[];
}

interface Placement {
	side: DiffSide;
	lineNumber: number;
	threadId: string;
	comments: DiffComment[];
}

/** The root comment of a reply chain, or the comment itself when it has no parent. */
function rootOf(comment: DiffComment, byId: ReadonlyMap<CommentId, DiffComment>): DiffComment {
	let current = comment;
	const seen = new Set<CommentId>();
	while (current.replyToId !== null && !seen.has(current.id)) {
		seen.add(current.id);
		const parent = byId.get(current.replyToId);
		if (parent === undefined) break;
		current = parent;
	}
	return current;
}

/** The thread a comment belongs to: its root's thread id, or the root's own id. */
function threadIdOf(root: DiffComment): string {
	return root.threadId ?? root.id;
}

/** Where a thread is drawn: outdated threads sit at the top of the file. */
function placementOf(root: DiffComment): { side: DiffSide; lineNumber: number } {
	if (root.outdated) return { side: root.side, lineNumber: 0 };
	return {
		side: root.side,
		lineNumber: root.endLine ?? root.line ?? 0,
	};
}

const compareComments = (left: DiffComment, right: DiffComment): number =>
	left.createdAt - right.createdAt || left.id.localeCompare(right.id);

export function commentsToAnnotations(
	comments: readonly DiffComment[],
	filePath: string,
): DiffLineAnnotation<CommentAnnotation>[] {
	const forFile = comments.filter((comment) => comment.filePath === filePath);
	if (forFile.length === 0) return [];
	const byId = new Map<CommentId, DiffComment>(forFile.map((comment) => [comment.id, comment]));

	const groups = new Map<string, Placement>();
	for (const comment of forFile) {
		const root = rootOf(comment, byId);
		const threadId = threadIdOf(root);
		const existing = groups.get(threadId);
		if (existing === undefined) {
			groups.set(threadId, {
				...placementOf(root),
				threadId,
				comments: [comment],
			});
		} else {
			existing.comments.push(comment);
		}
	}

	const byLine = new Map<string, { side: DiffSide; lineNumber: number; placements: Placement[] }>();
	for (const placement of groups.values()) {
		const key = `${placement.side}:${placement.lineNumber}`;
		const entry = byLine.get(key);
		if (entry === undefined) {
			byLine.set(key, {
				side: placement.side,
				lineNumber: placement.lineNumber,
				placements: [placement],
			});
		} else {
			entry.placements.push(placement);
		}
	}

	return [...byLine.values()]
		.sort(
			(left, right) => left.side.localeCompare(right.side) || left.lineNumber - right.lineNumber,
		)
		.map((entry) => {
			const placements = [...entry.placements].sort((left, right) =>
				left.threadId.localeCompare(right.threadId),
			);
			const commentIds = placements
				.flatMap((placement) => placement.comments)
				.sort(compareComments)
				.map((comment) => comment.id);
			return {
				side: entry.side,
				lineNumber: entry.lineNumber,
				metadata: {
					threadIds: placements.map((placement) => placement.threadId),
					commentIds,
				},
			};
		});
}
