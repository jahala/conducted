/**
 * @feature PR-04 PR comments list
 * Owns: the Comments section of the Checks tab. Review comments synced from GitHub, each with
 * resolved and outdated markers, and actions to send them to the chat.
 * Behaviour: ui-map.md 3.6, "Checks" paragraph (per comment: Resolved, Outdated, "Add to chat",
 * "Hide", "Resolve"; "Add all to chat"); services-map.md 3.7.4 (sync into diff_comments, resolve a
 * thread with a GraphQL mutation).
 * Data: comments from useDiffComments filtered to author kind "github"; actions from
 * useActions().comments (setResolved, sendToChat).
 * Must handle: no comments, a thread with replies (grouped), outdated comments (muted, kept),
 * resolve failing (the comment returns to unresolved), "Hide" being local only, a comment on a file
 * that no longer exists, and the sync running while the user resolves (newest answer wins).
 * Test first: a resolved comment is hidden by default and shown after "Show resolved".
 */
import type { CommentId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";
import type { DiffComment } from "../../../core/model.ts";

export interface PrCommentsListProps {
	comments: DiffComment[];
	onAddToChat: (ids: CommentId[]) => void;
	onResolve: (id: CommentId, resolved: boolean) => void;
	onOpenComment: (id: CommentId) => void;
}

export function PrCommentsList(_props: PrCommentsListProps): never {
	return notImplemented("PR-04");
}
