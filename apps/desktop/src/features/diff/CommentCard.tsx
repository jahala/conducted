/**
 * @feature REV-03 Comment card
 * Owns: one comment. Author, time, body, an optional suggested change, and the Edit and Delete
 * actions.
 * Behaviour: ui-map.md 3.6 ("Comment card: author You, Edit comment, Delete comment, Suggested
 * change block"; "Discard comment?" dialog).
 * Must handle: edit mode swapping the body for a CommentComposer (with the suggested change, when
 * its original lines are known), an edit that fails to save (the composer stays open and says
 * so), a suggested change shown against the lines it replaces, comments from GitHub having no
 * Edit or Delete (they are synced, not owned), an agent comment (label, no Edit), a long body that
 * wraps, and unresolved versus resolved styling.
 * Test first: a comment by the user shows Edit and Delete, one from GitHub shows neither.
 */
import type { CommentSuggestion } from "../../core/api.ts";
import type { DiffComment } from "../../core/model.ts";
import { Badge } from "../../ui/Badge.tsx";
import { Button } from "../../ui/Button.tsx";
import { CommentComposer } from "./CommentComposer.tsx";
import { SuggestionBlock } from "./SuggestionBlock.tsx";

export interface CommentCardProps {
	comment: DiffComment;
	editing: boolean;
	onStartEdit: () => void;
	/**
	 * Resolves true when the edit was saved; false keeps the editor open with the error. The
	 * suggestion is undefined when the comment's suggested change cannot be edited (its original
	 * lines are unknown), so it stays as it is.
	 */
	onSaveEdit: (body: string, suggestion: CommentSuggestion | null | undefined) => Promise<boolean>;
	onCancelEdit: () => void;
	onDelete: () => void;
	/** Shown in place of a body with nothing written, as the comment tab says "No comment body". */
	emptyBody?: string;
}

function authorName(comment: DiffComment): string {
	if (comment.author.name !== null && comment.author.name.trim() !== "") {
		return comment.author.name;
	}
	if (comment.author.kind === "user") return "You";
	if (comment.author.kind === "github") return "GitHub";
	return "Agent";
}

function timeText(createdAt: number): string {
	return new Date(createdAt).toLocaleString();
}

export function CommentCard({
	comment,
	editing,
	onStartEdit,
	onSaveEdit,
	onCancelEdit,
	onDelete,
	emptyBody,
}: CommentCardProps) {
	const owned = comment.author.kind === "user";
	const deletable = comment.author.kind !== "github";
	// The suggested change can be edited only against the lines it replaces.
	const base = comment.suggestionBaseCode;

	return (
		<article
			data-testid="comment-card"
			data-comment-id={comment.id}
			data-resolved={comment.resolved ? "true" : undefined}
			className={`flex flex-col gap-2 rounded-lg border bg-raised p-3 ${
				comment.resolved ? "border-border opacity-70" : "border-border"
			}`}
		>
			<div className="flex items-center gap-2">
				<span className="text-sm font-medium text-fg">{authorName(comment)}</span>
				<span className="text-xs text-fg-muted">{timeText(comment.createdAt)}</span>
				{comment.outdated ? <Badge tone="warning">Outdated</Badge> : null}
				{comment.resolved ? <Badge tone="success">Resolved</Badge> : null}
			</div>
			{editing ? (
				<CommentComposer
					mode="edit"
					initialBody={comment.body}
					suggestionBase={base}
					initialSuggestion={comment.suggestion}
					onCancel={onCancelEdit}
					onSubmit={(body, suggestion) =>
						onSaveEdit(
							body,
							base === null
								? undefined
								: suggestion === null
									? null
									: { code: suggestion, baseCode: base },
						)
					}
				/>
			) : comment.body.trim().length === 0 && emptyBody !== undefined ? (
				<p className="text-sm text-fg-muted italic">{emptyBody}</p>
			) : (
				<p className="whitespace-pre-wrap break-words text-sm text-fg">{comment.body}</p>
			)}
			{comment.suggestion !== null && !editing ? (
				<SuggestionBlock
					original={comment.suggestionBaseCode ?? ""}
					suggestion={comment.suggestion}
					filePath={comment.filePath ?? ""}
				/>
			) : null}
			<div className="flex items-center gap-1">
				{owned && !editing ? (
					<Button variant="ghost" size="xs" onClick={onStartEdit}>
						Edit comment
					</Button>
				) : null}
				{deletable && !editing ? (
					<Button variant="ghost" size="xs" onClick={onDelete}>
						Delete comment
					</Button>
				) : null}
			</div>
		</article>
	);
}
