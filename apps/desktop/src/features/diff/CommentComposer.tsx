/**
 * @feature REV-03 Comment composer
 * Owns: the box for writing a new comment, a reply or an edit, with an optional suggested change.
 * Behaviour: ui-map.md 3.6 (inline box placeholder "Add a comment for the AI", Discard comment?
 * dialog with Keep editing and Discard). Comments are stored in diff_comments and sent to the
 * agent on request.
 * Children: DiscardCommentDialog, SuggestionBlock (preview).
 * Must handle: empty body (submit disabled), Escape with unsaved text asking before discarding,
 * Cmd+Enter to submit, a submit that fails (text stays, error shown), and "Suggest a change"
 * prefilling the selected lines as editable code.
 * Test first: Escape with text opens the discard dialog, and Keep editing leaves the text intact.
 */
import { useRef, useState } from "react";
import { Button } from "../../ui/Button.tsx";
import { Textarea } from "../../ui/Input.tsx";
import { DiscardCommentDialog } from "./DiscardCommentDialog.tsx";
import { SuggestionBlock } from "./SuggestionBlock.tsx";

export interface CommentComposerProps {
	mode: "new" | "reply" | "edit";
	initialBody: string;
	/** The original lines, offered as a starting point for a suggested change. Null: none. */
	suggestionBase: string | null;
	onSubmit: (body: string, suggestion: string | null) => Promise<boolean>;
	onCancel: () => void;
}

const PLACEHOLDERS: Record<CommentComposerProps["mode"], string> = {
	new: "Add a comment for the AI",
	reply: "Write a reply",
	edit: "Edit comment",
};

export function CommentComposer({
	mode,
	initialBody,
	suggestionBase,
	onSubmit,
	onCancel,
}: CommentComposerProps) {
	const [body, setBody] = useState(initialBody);
	const [suggesting, setSuggesting] = useState(false);
	const [suggestion, setSuggestion] = useState(suggestionBase ?? "");
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const field = useRef<HTMLTextAreaElement>(null);

	const suggestionValue = suggesting ? suggestion : null;
	const dirty = body !== initialBody || suggestionValue !== null;

	const submit = async () => {
		if (body.trim() === "" || busy) return;
		setBusy(true);
		setError(null);
		const saved = await onSubmit(body, suggestionValue);
		setBusy(false);
		if (!saved) setError("The comment could not be saved.");
	};

	const cancel = () => {
		if (dirty) setConfirmOpen(true);
		else onCancel();
	};

	return (
		<fieldset
			aria-label="Comment"
			className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3"
			onKeyDown={(event) => {
				if (event.key === "Escape") {
					event.preventDefault();
					cancel();
				} else if (event.metaKey && event.key === "Enter") {
					event.preventDefault();
					void submit();
				}
			}}
		>
			<Textarea
				ref={field}
				aria-label={PLACEHOLDERS[mode]}
				placeholder={PLACEHOLDERS[mode]}
				value={body}
				error={error ?? undefined}
				onChange={(event) => setBody(event.target.value)}
			/>
			{suggestionBase !== null ? (
				<label className="flex items-center gap-2 text-xs text-fg-muted">
					<input
						type="checkbox"
						aria-label="Suggest a change"
						checked={suggesting}
						onChange={(event) => {
							setSuggesting(event.target.checked);
							if (event.target.checked) setSuggestion(suggestionBase);
						}}
					/>
					Suggest a change
				</label>
			) : null}
			{suggesting ? (
				<>
					<Textarea
						aria-label="Suggested code"
						value={suggestion}
						onChange={(event) => setSuggestion(event.target.value)}
						className="font-mono text-code"
					/>
					<SuggestionBlock original={suggestionBase ?? ""} suggestion={suggestion} filePath="" />
				</>
			) : null}
			<div className="flex justify-end gap-2">
				<Button variant="ghost" size="sm" onClick={cancel} disabled={busy}>
					Cancel
				</Button>
				<Button
					size="sm"
					loading={busy}
					disabled={body.trim() === ""}
					onClick={() => void submit()}
				>
					{mode === "edit" ? "Save" : mode === "reply" ? "Reply" : "Comment"}
				</Button>
			</div>
			<DiscardCommentDialog
				open={confirmOpen}
				onKeep={() => {
					setConfirmOpen(false);
					field.current?.focus();
				}}
				onDiscard={() => {
					setConfirmOpen(false);
					onCancel();
				}}
			/>
		</fieldset>
	);
}
