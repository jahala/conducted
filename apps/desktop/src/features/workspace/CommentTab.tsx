/**
 * @feature REV-03 Review comment tab
 * Owns: A centre tab that shows one review comment with its file and line, and lets the user edit,
 * resolve or delete it.
 * Behaviour: ui-map.md 3.2 (Comment tab: 'Comment by <author>'; 'Loading comment...', 'Comment not
 * found'), 3.6 (comment card: Edit comment, Delete comment, Suggested change).
 * Our design choice: Lives in features/workspace beside the other centre tabs; the comment card
 * and the comment order come from features/diff. The tab is a `diff` command scope, so Cmd+Alt+J
 * and Cmd+Alt+K move to the next and previous comment here as they do in the diff.
 * Not built here: a screen that opens the first comment tab. Today the tab opens from its own
 * previous and next controls and from the route; the diff's comment threads that should open it are
 * part of the File tab's diff pane (REV-08).
 * Must handle: Comment deleted while open ('Comment not found'); a suggested change block; resolved
 * and outdated flags; a comment by the agent or from GitHub (author label); previous and next
 * comment when the screen passes an opener; an edit that fails to save (the editor stays open).
 * Test first: A comment that no longer exists renders 'Comment not found'.
 */
import type { CommentId, WorkspaceId } from "@conducted/shared";
import { useState } from "react";
import { useCommandHandler } from "../../app/command-dispatcher.ts";
import { useServices } from "../../core/context.tsx";
import { useActions, useDiffComments } from "../../core/hooks.ts";
import { Badge } from "../../ui/Badge.tsx";
import { Button } from "../../ui/Button.tsx";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { toastError } from "../../ui/Toast.tsx";
import { CommentCard } from "../diff/CommentCard.tsx";
import { nextComment } from "../diff/comment-navigation.ts";

export interface CommentTabProps {
	workspaceId: WorkspaceId;
	commentId: CommentId;
	/** Opens another comment tab; when absent the previous and next buttons are hidden. */
	onOpenComment?: (id: CommentId) => void;
}

export function CommentTab({ workspaceId, commentId, onOpenComment }: CommentTabProps) {
	const comments = useDiffComments(workspaceId);
	const actions = useActions();
	const review = useServices().services.review;
	const [editing, setEditing] = useState(false);

	const all = comments.state === "ready" ? comments.data : [];
	const go = (direction: "next" | "previous"): boolean => {
		if (onOpenComment === undefined) return false;
		const target = nextComment(all, commentId, direction);
		if (target === null) return false;
		onOpenComment(target.id);
		return true;
	};
	useCommandHandler("review.previousComment", "area", () => go("previous"));
	useCommandHandler("review.nextComment", "area", () => go("next"));

	if (comments.state === "loading") {
		return (
			<div role="status" aria-label="Loading comment" className="p-6 text-sm text-fg-muted">
				Loading comment...
			</div>
		);
	}
	if (comments.state === "error") {
		return (
			<EmptyState
				tone="failed"
				title="Couldn't load the comment"
				body={comments.error.message}
				action={
					<Button variant="secondary" onClick={() => void review.load(workspaceId)}>
						Try again
					</Button>
				}
			/>
		);
	}

	const comment = comments.data.find((entry) => entry.id === commentId);
	if (comment === undefined) {
		return (
			<EmptyState
				title="Comment not found"
				body="It may have been deleted."
				action={
					onOpenComment !== undefined && all.length > 0 ? (
						<Button
							variant="secondary"
							onClick={() => {
								const first = all[0];
								if (first !== undefined) onOpenComment(first.id);
							}}
						>
							Open another comment
						</Button>
					) : undefined
				}
			/>
		);
	}

	const file = comment.filePath ?? "the pull request";
	const lines =
		comment.line === null
			? null
			: comment.endLine !== null && comment.endLine !== comment.line
				? `${comment.line}-${comment.endLine}`
				: String(comment.line);

	const edit = async (body: string): Promise<boolean> => {
		const result = await actions.comments.edit(comment.id, body);
		if (!result.ok) {
			toastError("Couldn't edit the comment", result.error);
			return false;
		}
		setEditing(false);
		return true;
	};
	const remove = async () => {
		const result = await actions.comments.remove(comment.id);
		if (!result.ok) toastError("Couldn't delete the comment", result.error);
	};
	const resolve = async () => {
		const result = await actions.comments.setResolved(comment.id, !comment.resolved);
		if (!result.ok) toastError("Couldn't resolve the comment", result.error);
	};
	const send = async () => {
		const result = await actions.comments.sendToChat(workspaceId, [comment.id]);
		if (!result.ok) toastError("Couldn't add the comment to the chat", result.error);
	};

	return (
		<div data-command-scope="diff" className="flex h-full flex-col gap-3 overflow-auto p-4">
			<div className="flex flex-wrap items-center gap-2">
				<span className="text-sm font-medium text-fg">{file}</span>
				{lines !== null ? <span className="text-xs text-fg-muted">line {lines}</span> : null}
				{comment.outdated ? <Badge tone="warning">Outdated</Badge> : null}
				{comment.resolved ? <Badge tone="success">Resolved</Badge> : null}
				<div className="ml-auto flex items-center gap-1">
					{onOpenComment !== undefined ? (
						<>
							<Button variant="ghost" size="xs" onClick={() => go("previous")}>
								Previous comment
							</Button>
							<Button variant="ghost" size="xs" onClick={() => go("next")}>
								Next comment
							</Button>
						</>
					) : null}
					<Button variant="ghost" size="xs" onClick={() => void resolve()}>
						{comment.resolved ? "Reopen" : "Resolve"}
					</Button>
					<Button variant="ghost" size="xs" onClick={() => void send()}>
						Add to chat
					</Button>
				</div>
			</div>
			<CommentCard
				comment={comment}
				editing={editing}
				onStartEdit={() => setEditing(true)}
				onSaveEdit={edit}
				onCancelEdit={() => setEditing(false)}
				onDelete={() => {
					void remove();
				}}
			/>
		</div>
	);
}
