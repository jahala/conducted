/**
 * @feature REV-03 Comment thread
 * Owns: one thread of review comments under a diff line: the root comment, its replies, a reply
 * box, and thread actions (resolve, send to chat).
 * Behaviour: ui-map.md 3.6 ("Comment card: author You, Edit comment, Delete comment, Suggested
 * change block"); services-map.md 3.7.4 (GitHub threads and replies). The agent reads comments
 * through the GetDiffComments and DiffComment tools (claude-runner.md).
 * Children: CommentCard, CommentComposer.
 * Must handle: a resolved thread (collapsed to one line, expandable), an outdated thread (marker),
 * a thread from GitHub (read-only except resolve and reply), a thread the agent wrote (author
 * label), a delete that fails (the card returns), and a long thread (older replies collapsed).
 * Test first: a thread with a root and two replies renders three cards in time order.
 */
import { notImplemented } from "@conducted/shared";
import type { DiffComment } from "../../core/model.ts";
import type { CommentHandlers } from "./diff-types.ts";

export interface CommentThreadProps {
	/** Root first, then replies in time order. */
	comments: DiffComment[];
	handlers: CommentHandlers;
}

export function CommentThread(_props: CommentThreadProps): never {
	return notImplemented("REV-03");
}
