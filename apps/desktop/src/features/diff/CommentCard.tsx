/**
 * @feature REV-03 Comment card
 * Owns: one comment. Author, time, body (Markdown), an optional suggested change, and the Edit and
 * Delete actions.
 * Behaviour: ui-map.md 3.6 ("Comment card: author You, Edit comment, Delete comment, Suggested
 * change block"; "Discard comment?" dialog).
 * Must handle: edit mode swapping the body for a CommentComposer, delete asking first when the
 * comment has replies, comments from GitHub having no Edit or Delete (they are synced, not owned),
 * an agent comment (label, no Edit), a very long body, and unresolved versus resolved styling.
 * Test first: a comment by the user shows Edit and Delete, one from GitHub shows neither.
 */
import { notImplemented } from "@conducted/shared";
import type { DiffComment } from "../../core/model.ts";

export interface CommentCardProps {
	comment: DiffComment;
	editing: boolean;
	onStartEdit: () => void;
	onSaveEdit: (body: string) => void;
	onCancelEdit: () => void;
	onDelete: () => void;
}

export function CommentCard(_props: CommentCardProps): never {
	return notImplemented("REV-03");
}
