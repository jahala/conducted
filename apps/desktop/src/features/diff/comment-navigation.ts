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
import { notImplemented } from "@conducted/shared";
import type { DiffComment } from "../../core/model.ts";

export function nextComment(
	_comments: readonly DiffComment[],
	_currentId: string | null,
	_direction: "next" | "previous",
): DiffComment | null {
	return notImplemented("REV-03");
}
