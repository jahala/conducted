/**
 * @feature PR-04 PR comments list
 * Owns: the Comments section of the Checks tab: the workspace's review comments whose author is
 * GitHub, each with resolved and outdated markers, and actions to send them to the chat.
 * Behaviour: ui-map.md 3.6, "Checks" paragraph (per comment: Resolved, Outdated, "Add to chat",
 * "Hide", "Resolve"; "Add all to chat"); services-map.md 3.7.4 (sync into diff_comments, resolve a
 * thread with a GraphQL mutation).
 * Comments are synced from GitHub by REV-04; "Resolve" on a thread is handled by the caller, which
 * resolves it on GitHub. "Hide" shows only when the caller can hide a comment; the Checks tab
 * leaves it out until comment states are built (REV-12).
 * Must handle: no comments, a thread with replies (grouped), outdated comments (muted, kept),
 * resolved comments hidden until "Show resolved", a comment on a file that no longer exists, and
 * no way to hide a comment (no Hide button).
 * Test first: a resolved comment is hidden by default and shown after "Show resolved".
 */
import type { CommentId } from "@conducted/shared";
import { useState } from "react";
import type { DiffComment } from "../../../core/model.ts";
import { Button } from "../../../ui/Button.tsx";

export interface PrCommentsListProps {
	comments: DiffComment[];
	onAddToChat: (ids: CommentId[]) => void;
	onResolve: (id: CommentId, resolved: boolean) => void;
	/** Left out, no comment offers Hide. */
	onHide?: (id: CommentId) => void;
	onOpenComment: (id: CommentId) => void;
}

function CommentCard({
	comment,
	onAddToChat,
	onResolve,
	onHide,
	onOpenComment,
	reply,
}: {
	comment: DiffComment;
	onAddToChat: (ids: CommentId[]) => void;
	onResolve: (id: CommentId, resolved: boolean) => void;
	onHide?: (id: CommentId) => void;
	onOpenComment: (id: CommentId) => void;
	reply?: boolean;
}) {
	const author = comment.author.name ?? "GitHub user";
	return (
		<li className={reply ? "ml-4 border-l border-separator pl-2" : undefined}>
			<div className="flex items-center gap-1.5">
				<span className="text-xs font-medium text-fg">{author}</span>
				{comment.resolved ? <span className="text-2xs text-success">Resolved</span> : null}
				{comment.outdated ? <span className="text-2xs text-fg-subtle">Outdated</span> : null}
				{comment.filePath === null ? null : (
					<span className="truncate font-mono text-2xs text-fg-subtle">
						{comment.filePath}
						{comment.line === null ? "" : `:${comment.line}`}
					</span>
				)}
			</div>
			<p className={comment.outdated ? "mt-0.5 text-sm text-fg-subtle" : "mt-0.5 text-sm text-fg"}>
				{comment.body}
			</p>
			<div className="mt-1 flex flex-wrap items-center gap-1">
				<Button variant="ghost" size="xs" onClick={() => onAddToChat([comment.id])}>
					Add to chat
				</Button>
				<Button variant="ghost" size="xs" onClick={() => onResolve(comment.id, !comment.resolved)}>
					{comment.resolved ? "Unresolve" : "Resolve"}
				</Button>
				{onHide === undefined ? null : (
					<Button variant="ghost" size="xs" onClick={() => onHide(comment.id)}>
						Hide
					</Button>
				)}
				{comment.remoteUrl === null ? null : (
					<Button variant="ghost" size="xs" onClick={() => onOpenComment(comment.id)}>
						Open
					</Button>
				)}
			</div>
		</li>
	);
}

export function PrCommentsList({
	comments,
	onAddToChat,
	onResolve,
	onHide,
	onOpenComment,
}: PrCommentsListProps) {
	const [showResolved, setShowResolved] = useState(false);

	const byId = new Map(comments.map((comment) => [comment.id, comment]));
	const replies = new Map<CommentId, DiffComment[]>();
	const roots: DiffComment[] = [];
	for (const comment of comments) {
		const parent = comment.replyToId === null ? undefined : byId.get(comment.replyToId);
		if (parent === undefined) {
			roots.push(comment);
			continue;
		}
		const list = replies.get(parent.id) ?? [];
		list.push(comment);
		replies.set(parent.id, list);
	}

	const hiddenResolved = roots.filter((comment) => comment.resolved).length;
	const visibleRoots = showResolved ? roots : roots.filter((comment) => !comment.resolved);
	const openIds = roots.filter((comment) => !comment.resolved).map((comment) => comment.id);

	return (
		<section aria-label="Comments" className="border-b border-separator px-2 py-2">
			<div className="flex items-center justify-between gap-2">
				<h3 className="text-sm font-medium text-fg">Comments</h3>
				{hiddenResolved > 0 ? (
					<Button variant="link" size="xs" onClick={() => setShowResolved((current) => !current)}>
						{showResolved ? "Hide resolved" : `Show resolved (${hiddenResolved})`}
					</Button>
				) : null}
			</div>
			{comments.length === 0 ? (
				<p className="mt-1 text-xs text-fg-muted">No review comments from GitHub.</p>
			) : (
				<>
					{openIds.length === 0 ? null : (
						<Button
							variant="outline"
							size="xs"
							className="mt-1"
							onClick={() => onAddToChat(openIds)}
						>
							Add all to chat
						</Button>
					)}
					<ul className="mt-1 space-y-2">
						{visibleRoots.map((comment) => (
							<CommentCard
								key={comment.id}
								comment={comment}
								onAddToChat={onAddToChat}
								onResolve={onResolve}
								onHide={onHide}
								onOpenComment={onOpenComment}
							/>
						))}
						{visibleRoots.flatMap((comment) =>
							(replies.get(comment.id) ?? []).map((reply) => (
								<CommentCard
									key={reply.id}
									comment={reply}
									onAddToChat={onAddToChat}
									onResolve={onResolve}
									onHide={onHide}
									onOpenComment={onOpenComment}
									reply
								/>
							)),
						)}
					</ul>
				</>
			)}
		</section>
	);
}
