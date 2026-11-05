/**
 * @feature REV-03 Comment thread
 * Owns: one thread of review comments under a diff line: the root comment, its replies, a reply
 * box, and thread actions (resolve, send to chat).
 * Behaviour: ui-map.md 3.6 ("Comment card: author You, Edit comment, Delete comment, Suggested
 * change block"); services-map.md 3.7.4 (GitHub threads and replies). The agent reads comments
 * through the GetDiffComments and DiffComment tools (claude-runner.md).
 * Children: CommentCard, CommentComposer.
 * Must handle: a resolved thread (collapsed, expandable; Resolve and Reopen change every comment of
 * the thread, replies included), an outdated comment (marker), a thread
 * from GitHub (no local edit), a thread the agent wrote (author label), and a failed action
 * (shown beside the thread).
 * Test first: a thread with a root and two replies renders three cards in time order.
 */
import type { CommentId } from "@conducted/shared";
import { useState } from "react";
import type { DiffComment } from "../../core/model.ts";
import { Button } from "../../ui/Button.tsx";
import { CommentCard } from "./CommentCard.tsx";
import { CommentComposer } from "./CommentComposer.tsx";
import type { CommentHandlers } from "./diff-types.ts";

export interface CommentThreadProps {
	/** Root first, then replies in time order. */
	comments: DiffComment[];
	handlers: CommentHandlers;
}

const byTime = (left: DiffComment, right: DiffComment): number =>
	left.createdAt - right.createdAt || left.id.localeCompare(right.id);

export function CommentThread({ comments, handlers }: CommentThreadProps) {
	const ordered = [...comments].sort(byTime);
	const root = ordered[0];
	const [expanded, setExpanded] = useState(root === undefined ? false : !root.resolved);
	const [editing, setEditing] = useState<CommentId | null>(null);
	const [replying, setReplying] = useState(false);
	const [error, setError] = useState<string | null>(null);

	if (root === undefined) return null;

	const target = {
		filePath: root.filePath ?? "",
		side: root.side,
		line: root.line,
		endLine: root.endLine,
	};

	const saveEdit = async (id: CommentId, body: string): Promise<boolean> => {
		const saved = await handlers.onEdit(id, body);
		if (saved) setEditing(null);
		else setError("The comment could not be saved.");
		return saved;
	};

	const remove = async (id: CommentId) => {
		const removed = await handlers.onDelete(id);
		if (!removed) setError("The comment could not be deleted.");
	};

	/** Resolving or reopening a thread changes every comment in it, replies included. */
	const setThreadResolved = async (resolved: boolean) => {
		for (const comment of ordered) {
			if (comment.resolved === resolved) continue;
			const changed = await handlers.onSetResolved(comment.id, resolved);
			if (!changed) {
				setError("The comment could not be resolved.");
				return;
			}
		}
	};

	const visible = expanded ? ordered : [root];

	return (
		<div className="flex flex-col gap-2" data-thread-id={root.threadId ?? root.id}>
			<div className="flex items-center justify-between gap-2">
				<Button variant="ghost" size="xs" onClick={() => setExpanded(!expanded)}>
					{expanded ? "Collapse thread" : "Expand thread"}
				</Button>
				<div className="flex items-center gap-1">
					<Button variant="ghost" size="xs" onClick={() => void setThreadResolved(!root.resolved)}>
						{root.resolved ? "Reopen" : "Resolve"}
					</Button>
					<Button
						variant="ghost"
						size="xs"
						onClick={() => handlers.onSendToChat(ordered.map((comment) => comment.id))}
					>
						Send to chat
					</Button>
				</div>
			</div>
			{visible.map((comment) => (
				<CommentCard
					key={comment.id}
					comment={comment}
					editing={editing === comment.id}
					onStartEdit={() => setEditing(comment.id)}
					onSaveEdit={(body) => saveEdit(comment.id, body)}
					onCancelEdit={() => setEditing(null)}
					onDelete={() => {
						void remove(comment.id);
					}}
				/>
			))}
			{expanded ? (
				replying ? (
					<CommentComposer
						mode="reply"
						initialBody=""
						suggestionBase={null}
						onCancel={() => setReplying(false)}
						onSubmit={async (body) => {
							const added = await handlers.onAdd(target, body);
							if (added) setReplying(false);
							else setError("The reply could not be saved.");
							return added;
						}}
					/>
				) : (
					<Button variant="ghost" size="xs" onClick={() => setReplying(true)}>
						Reply
					</Button>
				)
			) : null}
			{error !== null ? <p className="text-xs text-danger">{error}</p> : null}
		</div>
	);
}
