/**
 * @feature REV-03 Review comment tab
 * Owns: A centre tab that shows one review comment with its file and line, and lets the user edit,
 * resolve or delete it.
 * Behaviour: ui-map.md 3.2 (Comment tab: 'Comment by <author>'; 'Loading comment...', 'Comment not
 * found'), 3.6 (comment card: Edit comment, Delete comment, Suggested change).
 * Our design choice: Lives in features/workspace because no worker owns features/diff yet. It
 * should move there with the diff viewer.
 * Must handle: Comment deleted while open ('Comment not found' with a close button); a suggested
 * change block; resolved and outdated flags; a comment by the agent or from GitHub (author label);
 * opening the file at the line.
 * Test first: A comment that no longer exists renders 'Comment not found'.
 */

import type { CommentId, WorkspaceId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";

export interface CommentTabProps {
	workspaceId: WorkspaceId;
	commentId: CommentId;
}

export function CommentTab(_props: CommentTabProps): never {
	return notImplemented("REV-03");
}
