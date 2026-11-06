/**
 * @feature COMP-09 Prompt snippets
 * Owns: the Edit snippets dialog: the saved snippets, their edit and delete actions, and the
 * "Couldn't save snippet" and "Couldn't delete snippet" messages.
 * Behaviour: ui-map.md 5.2 (Edit snippets: Name, Keyword, Prompt snippet), 5.1 (the palette's Edit
 * snippets action), inventory toast rows 688 and 689.
 * Our design choice: one dialog lists the snippets and swaps to the same fields for an edit, rather
 * than opening a second modal on top. The keyword is shown beside the name when it is set.
 * Must handle: no saved snippets yet; editing a snippet; deleting a snippet; a failed save and a
 * failed delete.
 * Test first: the list shows a saved snippet, editing its name saves, and deleting it removes it.
 */
import { useEffect, useState } from "react";
import type { SnippetInput } from "../../core/api.ts";
import { useServices } from "../../core/context.tsx";
import { useActions, useSnippets } from "../../core/hooks.ts";
import type { Snippet } from "../../core/model.ts";
import { Button } from "../../ui/Button.tsx";
import { Dialog, DialogContent } from "../../ui/Dialog.tsx";
import { Spinner } from "../../ui/Spinner.tsx";
import { toastError } from "../../ui/Toast.tsx";
import { SnippetFields } from "./SnippetForm.tsx";

export interface SnippetManagerDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onCreate: () => void;
}

const emptyInput = (): SnippetInput => ({ name: "", keyword: null, prompt: "" });

export function SnippetManagerDialog({ open, onOpenChange, onCreate }: SnippetManagerDialogProps) {
	const snippets = useSnippets();
	const actions = useActions();
	const { services } = useServices();
	const [editing, setEditing] = useState<Snippet | null>(null);
	const [value, setValue] = useState<SnippetInput>(emptyInput);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		if (!open) {
			setEditing(null);
			return;
		}
		if (editing === null) return;
		setValue({
			name: editing.name,
			keyword: editing.keyword,
			prompt: editing.prompt,
		});
	}, [editing, open]);

	const startEditing = (snippet: Snippet) => {
		setEditing(snippet);
		setValue({ name: snippet.name, keyword: snippet.keyword, prompt: snippet.prompt });
	};

	const save = async () => {
		if (editing === null || busy) return;
		if (value.name.trim() === "" || value.prompt.trim() === "") return;
		setBusy(true);
		try {
			const result = await actions.snippets.update(editing.id, value);
			if (!result.ok) {
				toastError("Couldn't save snippet", result.error);
				return;
			}
			setEditing(null);
		} finally {
			setBusy(false);
		}
	};

	const remove = async (snippet: Snippet) => {
		if (busy) return;
		setBusy(true);
		try {
			const result = await actions.snippets.remove(snippet.id);
			if (!result.ok) {
				toastError("Couldn't delete snippet", result.error);
				return;
			}
			if (editing?.id === snippet.id) setEditing(null);
		} finally {
			setBusy(false);
		}
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) setEditing(null);
				onOpenChange(next);
			}}
		>
			<DialogContent
				title={editing === null ? "Edit snippets" : "Edit snippet"}
				size="lg"
				onConfirm={() => {
					if (editing !== null) void save();
				}}
			>
				{editing !== null ? (
					<>
						<SnippetFields value={value} onChange={setValue} autoFocus />
						<div className="flex justify-end gap-2">
							<Button variant="ghost" onClick={() => setEditing(null)}>
								Cancel
							</Button>
							<Button
								loading={busy}
								disabled={value.name.trim() === "" || value.prompt.trim() === ""}
								onClick={() => void save()}
							>
								Save
							</Button>
						</div>
					</>
				) : (
					<>
						{snippets.state === "loading" ? (
							<div className="flex items-center gap-2 py-6 text-sm text-fg-muted">
								<Spinner label="Loading snippets" size="sm" />
								Loading snippets...
							</div>
						) : null}
						{snippets.state === "error" ? (
							<div className="flex flex-col gap-2 py-3">
								<p role="alert" className="text-sm text-danger">
									Couldn't load snippets. {snippets.error.message}
								</p>
								<div>
									<Button variant="secondary" onClick={() => void services.composer.loadSnippets()}>
										Try again
									</Button>
								</div>
							</div>
						) : null}
						{snippets.state === "ready" && snippets.data.length === 0 ? (
							<p className="py-6 text-center text-sm text-fg-muted">No saved snippets yet.</p>
						) : null}
						{snippets.state === "ready" && snippets.data.length > 0 ? (
							<ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
								{snippets.data.map((snippet) => (
									<li
										key={snippet.id}
										className="flex items-center gap-3 rounded-md px-2 py-2 text-sm text-fg"
									>
										<span className="min-w-0 flex-1 truncate">{snippet.name}</span>
										{snippet.keyword === null ? null : (
											<span className="shrink-0 text-xs text-fg-subtle">{snippet.keyword}</span>
										)}
										<Button
											variant="ghost"
											size="sm"
											aria-label={`Edit ${snippet.name}`}
											onClick={() => startEditing(snippet)}
										>
											Edit
										</Button>
										<Button
											variant="outlineDestructive"
											size="sm"
											disabled={busy}
											aria-label={`Delete ${snippet.name}`}
											onClick={() => void remove(snippet)}
										>
											Delete
										</Button>
									</li>
								))}
							</ul>
						) : null}
						<div className="flex justify-end">
							<Button variant="outline" size="sm" onClick={onCreate}>
								New snippet
							</Button>
						</div>
					</>
				)}
			</DialogContent>
		</Dialog>
	);
}
