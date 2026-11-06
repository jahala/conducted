/**
 * @feature PR-07 PR title editor
 * Owns: the PR title as text that turns into an input on click, with Save and Discard.
 * Behaviour: ui-map.md 3.2 and 3.6 ("PR title", Save, Discard); services-map.md 3.7.5 (`gh pr edit
 * --title`).
 * Must handle: an empty title (Save disabled), Enter saving once, Escape discarding, a save that
 * fails (text stays, error shown), a title over 256 characters (GitHub's limit, a counter shows),
 * an edit kept when the title changes elsewhere while typing, and a merged or closed PR (not
 * editable).
 * Test first: editing the title and pressing Enter calls onSave with the new text once.
 */
import { messageOf } from "@conducted/shared";
import { useEffect, useState } from "react";
import { Button } from "../../ui/Button.tsx";
import { Input } from "../../ui/Input.tsx";

export interface PrTitleEditorProps {
	title: string;
	editable: boolean;
	onSave: (title: string) => Promise<boolean>;
}

const TITLE_LIMIT = 256;

export function PrTitleEditor({ title, editable, onSave }: PrTitleEditorProps) {
	const [current, setCurrent] = useState(title);
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(title);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!editing) setCurrent(title);
	}, [title, editing]);

	const start = () => {
		setDraft(current);
		setError(null);
		setEditing(true);
	};

	const save = async () => {
		const next = draft.trim();
		if (saving || next === "") return;
		setSaving(true);
		setError(null);
		try {
			const saved = await onSave(next);
			if (saved) {
				setCurrent(next);
				setEditing(false);
			} else {
				setError("Couldn't save the title.");
			}
		} catch (cause) {
			setError(messageOf(cause));
		} finally {
			setSaving(false);
		}
	};

	if (!editable) {
		return <h2 className="min-w-0 truncate text-lg font-medium text-fg">{current}</h2>;
	}

	if (!editing) {
		return (
			<button
				type="button"
				aria-label="Edit PR title"
				onClick={start}
				className="min-w-0 rounded-sm text-left text-lg font-medium text-fg transition-colors hover:text-accent"
			>
				<span className="block truncate">{current}</span>
			</button>
		);
	}

	const overLimit = draft.length > TITLE_LIMIT;

	return (
		<div className="min-w-0 flex-1">
			<Input
				aria-label="PR title"
				value={draft}
				error={error ?? undefined}
				autoFocus
				onChange={(event) => setDraft(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						void save();
					}
					if (event.key === "Escape") {
						setEditing(false);
						setError(null);
					}
				}}
			/>
			<div className="mt-1 flex items-center gap-1">
				<Button
					variant="default"
					size="xs"
					loading={saving}
					disabled={draft.trim() === "" || overLimit}
					onClick={() => void save()}
				>
					Save
				</Button>
				<Button
					variant="ghost"
					size="xs"
					onClick={() => {
						setEditing(false);
						setError(null);
					}}
				>
					Discard
				</Button>
				<span
					className={overLimit ? "ml-auto text-2xs text-danger" : "ml-auto text-2xs text-fg-subtle"}
				>
					{draft.length}/{TITLE_LIMIT}
				</span>
			</div>
		</div>
	);
}
