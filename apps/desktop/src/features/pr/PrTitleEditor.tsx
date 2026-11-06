/**
 * @feature PR-07 PR title editor
 * Owns: the PR tab's title ("PR title" when it has none), its "Edit title" button and the
 * "Edit PR title" dialog that changes it.
 * Behaviour: ui-map.md 3.2 ("PR title" editable) and 5.2 (the "Edit PR title" dialog);
 * services-map.md 3.7.5 (`gh pr edit --title`). As in Conductor's frontend bundle, the dialog has
 * one field (placeholder "PR title", its text selected), Cancel and Save ("Saving..." while it
 * saves); Enter saves; an empty title cannot be saved; an unchanged title just closes it; and the
 * dialog closes once the save is done, whatever its outcome, because the PR tab's toast says why
 * a save failed.
 * Must handle: an empty title (Save disabled), Enter saving once, a save that fails (the old title
 * stays), and a merged or closed PR (no Edit title button).
 * Test first: editing the title and pressing Enter calls onSave with the new text once.
 */
import { useState } from "react";
import { Button } from "../../ui/Button.tsx";
import { Dialog, DialogContent, DialogFooter } from "../../ui/Dialog.tsx";
import { IconButton } from "../../ui/IconButton.tsx";
import { Input } from "../../ui/Input.tsx";
import { PencilIcon } from "../../ui/icons.tsx";

export interface PrTitleEditorProps {
	title: string;
	editable: boolean;
	onSave: (title: string) => Promise<boolean>;
}

export function PrTitleEditor({ title, editable, onSave }: PrTitleEditorProps) {
	const [saved, setSaved] = useState<string | null>(null);
	const [open, setOpen] = useState(false);
	const [draft, setDraft] = useState(title);
	const [saving, setSaving] = useState(false);
	// A title saved here shows at once; the next poll's title replaces it.
	const shown = saved !== null && saved !== title ? saved : title;

	const start = () => {
		setDraft(shown);
		setOpen(true);
	};

	const save = async () => {
		const next = draft.trim();
		if (saving || next === "") return;
		if (next === shown) {
			setOpen(false);
			return;
		}
		setSaving(true);
		try {
			if (await onSave(next)) setSaved(next);
		} finally {
			setSaving(false);
			setOpen(false);
		}
	};

	return (
		<div className="flex min-w-0 items-start gap-1">
			<h2 className="line-clamp-2 min-w-0 text-lg font-medium text-fg [overflow-wrap:anywhere]">
				{shown === "" ? <span className="text-fg-muted">PR title</span> : shown}
			</h2>
			{editable ? (
				<IconButton size="xs" label="Edit title" icon={<PencilIcon />} onClick={start} />
			) : null}
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent title="Edit PR title" size="sm" onConfirm={() => void save()}>
					<Input
						aria-label="PR title"
						placeholder="PR title"
						value={draft}
						autoFocus
						onFocus={(event) => event.target.select()}
						onChange={(event) => setDraft(event.target.value)}
						onKeyDown={(event) => {
							if (event.key !== "Enter") return;
							event.preventDefault();
							void save();
						}}
					/>
					<DialogFooter>
						<Button variant="ghost" onClick={() => setOpen(false)}>
							Cancel
						</Button>
						<Button
							variant="default"
							disabled={saving || draft.trim() === ""}
							onClick={() => void save()}
						>
							{saving ? "Saving..." : "Save"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
