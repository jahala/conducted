/**
 * @feature COMP-09 Prompt snippets
 * Owns: the Create snippet and Edit snippet forms: a name, an optional keyword and the prompt, and
 * the "Couldn't save snippet" message when the save fails.
 * Behaviour: ui-map.md 5.2 (the Create snippet and Edit snippets dialogs show Name, Keyword and
 * Prompt snippet).
 * Our design choice: the same fields serve both dialogues, so the create and edit forms cannot
 * drift apart. The keyword is optional; a blank keyword is stored as none, which the repository
 * allows to repeat. Snippet sharing ("Visible to") is not built (D025).
 * Must handle: a blank name or prompt (Save stays disabled); a duplicate keyword (the save fails
 * and the user sees "Couldn't save snippet"); Cmd+Enter saving; a cancelled form changing nothing.
 * Test first: filling Name, Keyword and Prompt snippet and saving creates a snippet the picker
 * lists.
 */
import { useEffect, useState } from "react";
import type { SnippetInput } from "../../core/api.ts";
import { useServices } from "../../core/context.tsx";
import { useActions } from "../../core/hooks.ts";
import type { Snippet } from "../../core/model.ts";
import { Button } from "../../ui/Button.tsx";
import { Dialog, DialogContent, DialogFooter } from "../../ui/Dialog.tsx";
import { Input, Label, Textarea } from "../../ui/Input.tsx";
import { toastError } from "../../ui/Toast.tsx";

export interface SnippetFieldsProps {
	value: SnippetInput;
	onChange: (value: SnippetInput) => void;
	/** Focus the name field when the form opens. */
	autoFocus?: boolean;
}

export function SnippetFields({ value, onChange, autoFocus }: SnippetFieldsProps) {
	return (
		<>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="snippet-name">Name</Label>
				<Input
					id="snippet-name"
					autoFocus={autoFocus}
					value={value.name}
					onChange={(event) => onChange({ ...value, name: event.target.value })}
				/>
			</div>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="snippet-keyword">Keyword</Label>
				<Input
					id="snippet-keyword"
					value={value.keyword ?? ""}
					placeholder="Optional"
					onChange={(event) =>
						onChange({
							...value,
							keyword: event.target.value.trim() === "" ? null : event.target.value,
						})
					}
				/>
			</div>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="snippet-prompt">Prompt snippet</Label>
				<Textarea
					id="snippet-prompt"
					value={value.prompt}
					rows={5}
					onChange={(event) => onChange({ ...value, prompt: event.target.value })}
				/>
			</div>
		</>
	);
}

export interface SnippetFormDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** The snippet being changed. Null creates a new one. */
	snippet: Snippet | null;
	onSaved: () => void;
}

const emptyInput = (): SnippetInput => ({ name: "", keyword: null, prompt: "" });

const inputOf = (snippet: Snippet): SnippetInput => ({
	name: snippet.name,
	keyword: snippet.keyword,
	prompt: snippet.prompt,
});

export function SnippetFormDialog({
	open,
	onOpenChange,
	snippet,
	onSaved,
}: SnippetFormDialogProps) {
	const actions = useActions();
	const { services } = useServices();
	const [value, setValue] = useState<SnippetInput>(() =>
		snippet === null ? emptyInput() : inputOf(snippet),
	);
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		if (!open) return;
		setValue(snippet === null ? emptyInput() : inputOf(snippet));
	}, [open, snippet]);

	const canSave = value.name.trim() !== "" && value.prompt.trim() !== "";

	const save = async () => {
		if (!canSave || saving) return;
		setSaving(true);
		try {
			const result =
				snippet === null
					? await actions.snippets.create(value)
					: await actions.snippets.update(snippet.id, value);
			if (!result.ok) {
				toastError("Couldn't save snippet", result.error);
				return;
			}
			await services.composer.loadSnippets();
			onSaved();
			onOpenChange(false);
		} finally {
			setSaving(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				title={snippet === null ? "Create snippet" : "Edit snippet"}
				onConfirm={() => {
					if (canSave) void save();
				}}
				size="lg"
			>
				<SnippetFields value={value} onChange={setValue} autoFocus />
				<DialogFooter>
					<Button variant="ghost" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button loading={saving} disabled={!canSave} onClick={() => void save()}>
						{snippet === null ? "Create" : "Save"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
