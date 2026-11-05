/**
 * @feature REV-03 Comment navigation
 * Owns: the pure function that picks the next or previous comment across files, for the
 * Cmd+Alt+J and Cmd+Alt+K shortcuts.
 * Behaviour: ui-map.md 3.6 ("Cmd+Alt+J and Cmd+Alt+K move between comments").
 * Our design choice: order is file path, then line, then creation time. Resolved comments are
 * skipped unless nothing else is left.
 * Must handle: no comments (returns null), no current comment (first or last), the end of the list
 * (wraps around), and a current comment that was deleted (continue from its old position).
 * Test first: with comments on a.ts:3, a.ts:9, b.ts:1 and current a.ts:9, next gives b.ts:1 and
 * next again wraps to a.ts:3.
 */
import type { DiffComment } from "../../core/model.ts";

const compareComments = (left: DiffComment, right: DiffComment): number =>
	(left.filePath ?? "").localeCompare(right.filePath ?? "") ||
	(left.line ?? 0) - (right.line ?? 0) ||
	left.createdAt - right.createdAt ||
	left.id.localeCompare(right.id);

export function nextComment(
	comments: readonly DiffComment[],
	currentId: string | null,
	direction: "next" | "previous",
): DiffComment | null {
	const ordered = comments.slice().sort(compareComments);
	const unresolved = ordered.filter((comment) => !comment.resolved);
	const candidates = unresolved.length > 0 ? unresolved : ordered;
	if (candidates.length === 0) return null;

	const current =
		currentId === null ? -1 : candidates.findIndex((comment) => comment.id === currentId);
	if (current !== -1) {
		const offset = direction === "next" ? 1 : -1;
		return candidates[(current + offset + candidates.length) % candidates.length] ?? null;
	}

	// The current comment may be resolved, and so absent from the candidates. Continue from the
	// place it holds in the full order, so a resolved comment does not send navigation to an edge.
	const position =
		currentId === null ? -1 : ordered.findIndex((comment) => comment.id === currentId);
	if (position === -1)
		return direction === "next" ? (candidates[0] ?? null) : (candidates.at(-1) ?? null);
	const candidateIndex = candidates.map((comment) => ordered.indexOf(comment));
	if (direction === "next") {
		const after = candidateIndex.findIndex((index) => index > position);
		return after === -1 ? (candidates[0] ?? null) : (candidates[after] ?? null);
	}
	let before: DiffComment | null = null;
	for (const [index, comment] of candidates.entries()) {
		if ((candidateIndex[index] ?? -1) >= position) break;
		before = comment;
	}
	return before ?? candidates.at(-1) ?? null;
}
