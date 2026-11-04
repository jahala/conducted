/**
 * @feature REV-03 Comment composer
 * Owns: the box for writing a new comment, a reply or an edit, with an optional suggested change.
 * Behaviour: ui-map.md 3.6 (inline box placeholder "Add a comment for the AI", Discard comment?
 * dialog with Keep editing and Discard). Comments are stored in diff_comments and sent to the
 * agent on request.
 * Children: DiscardCommentDialog, SuggestionBlock (preview).
 * Must handle: empty body (submit disabled), Escape on non-empty text asking before discarding,
 * Cmd+Enter to submit, a submit that fails (text stays, error shown), the target line vanishing
 * while typing, and "Suggest a change" prefilling the selected lines as editable code.
 * Test first: Escape with text opens the discard dialog, and Keep editing leaves the text intact.
 */
import { notImplemented } from "@conducted/shared";

export interface CommentComposerProps {
	mode: "new" | "reply" | "edit";
	initialBody: string;
	/** The original lines, offered as a starting point for a suggested change. Null: none. */
	suggestionBase: string | null;
	onSubmit: (body: string, suggestion: string | null) => Promise<boolean>;
	onCancel: () => void;
}

export function CommentComposer(_props: CommentComposerProps): never {
	return notImplemented("REV-03");
}
