/**
 * @feature PR-07 PR description editor
 * Owns: the PR description as rendered Markdown that switches to a text area for editing, with
 * Save and Discard.
 * Behaviour: ui-map.md 3.2 and 3.6 ("PR description", Save, Discard); services-map.md 3.7.5
 * (`gh pr edit --body`); ui-map.md 7.2 ("No description"). Markdown is rendered by the chat's
 * shared renderer (CHAT-06).
 * Must handle: an empty description (the "No description" placeholder enters edit mode when
 * clicked), Cmd+Enter saving once, Escape discarding, a save that fails (the edit stays, an error
 * shows), an edit kept when the description changes elsewhere while typing, very long text, and a
 * merged or closed PR (not editable).
 * Test first: with an empty description the placeholder shows and clicking it enters edit mode.
 */
import { messageOf } from "@conducted/shared";
import { useEffect, useState } from "react";
import { Button } from "../../ui/Button.tsx";
import { Textarea } from "../../ui/Input.tsx";
import { AssistantText } from "../chat/AssistantText.tsx";

export interface PrDescriptionEditorProps {
	body: string;
	editable: boolean;
	onSave: (body: string) => Promise<boolean>;
}

export function PrDescriptionEditor({ body, editable, onSave }: PrDescriptionEditorProps) {
	const [current, setCurrent] = useState(body);
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(body);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Follow a new description from the poll. Leaving edit mode is not a reason to read the prop
	// again: after a save it still holds the old text until the next poll.
	useEffect(() => {
		setCurrent(body);
	}, [body]);

	const start = () => {
		setDraft(current);
		setError(null);
		setEditing(true);
	};

	const save = async () => {
		if (saving) return;
		setSaving(true);
		setError(null);
		try {
			const saved = await onSave(draft);
			if (saved) {
				setCurrent(draft);
				setEditing(false);
			} else {
				setError("Couldn't save the description.");
			}
		} catch (cause) {
			setError(messageOf(cause));
		} finally {
			setSaving(false);
		}
	};

	if (!editing) {
		if (current.trim() === "") {
			return editable ? (
				<button
					type="button"
					aria-label="Edit PR description"
					onClick={start}
					className="w-full rounded-md px-2 py-1 text-left text-sm text-fg-subtle transition-colors hover:bg-hover"
				>
					No description
				</button>
			) : (
				<p className="px-2 py-1 text-sm text-fg-subtle">No description</p>
			);
		}
		return (
			<div className="px-2 py-1">
				<AssistantText text={current} />
				{editable ? (
					<div className="mt-1">
						<Button variant="ghost" size="xs" onClick={start}>
							Edit
						</Button>
					</div>
				) : null}
			</div>
		);
	}

	return (
		<div className="px-2 py-1">
			<Textarea
				aria-label="PR description"
				value={draft}
				error={error ?? undefined}
				rows={6}
				autoFocus
				onChange={(event) => setDraft(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
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
				<Button variant="default" size="xs" loading={saving} onClick={() => void save()}>
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
				<span className="ml-auto text-2xs text-fg-subtle">Markdown</span>
			</div>
		</div>
	);
}
