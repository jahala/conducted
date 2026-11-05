/**
 * @feature NAV-04 Section dialog
 * Owns: The dialog to create or rename a section: a name and an optional emoji.
 * Behaviour: ui-map.md 5.2 ('Section create or edit (name, emoji)'), 4 item 5.
 * Must handle: Empty name (submit disabled); a name that already exists (allowed, sections are told
 * apart by id); Enter submits; Escape closes; the action fails (error under the field, dialog stays
 * open).
 * Our design choice: The emoji is a short text field plus a small set of common choices, so the
 * picker needs no extra library. A section is renamed from the same dialog that creates it.
 * Test first: Submitting 'Review' with no emoji calls sections.create('Review', null).
 */
import type { Result } from "@conducted/shared";
import { useEffect, useId, useRef, useState } from "react";
import { createSingleFlight } from "../../core/async/single-flight.ts";
import { useActions } from "../../core/hooks.ts";
import type { Section } from "../../core/model.ts";
import { Button } from "../../ui/Button.tsx";
import { cn } from "../../ui/cn.ts";
import { Dialog, DialogContent, DialogFooter } from "../../ui/Dialog.tsx";
import { Input, Label } from "../../ui/Input.tsx";

export interface SectionDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Null to create a new section. */
	section: Section | null;
}

const EMOJI_CHOICES = ["📌", "📝", "🚧", "🐛", "✨", "🧪", "🚀", "📚"] as const;

export function SectionDialog({ open, onOpenChange, section }: SectionDialogProps) {
	const actions = useActions();
	const nameId = useId();
	const emojiId = useId();
	const [name, setName] = useState(section?.name ?? "");
	const [emoji, setEmoji] = useState(section?.emoji ?? "");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const flight = useRef(createSingleFlight()).current;
	const initial = useRef(section);
	initial.current = section;

	useEffect(() => {
		if (!open) return;
		setName(initial.current?.name ?? "");
		setEmoji(initial.current?.emoji ?? "");
		setError(null);
	}, [open]);

	const submit = () => {
		const trimmed = name.trim();
		if (trimmed.length === 0) return Promise.resolve();
		const chosenEmoji = emoji.trim() === "" ? null : emoji.trim();
		return flight.run("submit", async () => {
			setBusy(true);
			setError(null);
			try {
				const result: Result<unknown> =
					initial.current === null
						? await actions.sections.create(trimmed, chosenEmoji)
						: await actions.sections.rename(initial.current.id, trimmed, chosenEmoji);
				if (!result.ok) {
					setError(result.error.message);
					return;
				}
				onOpenChange(false);
			} finally {
				setBusy(false);
			}
		});
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				title={initial.current === null ? "New section" : "Edit section"}
				onConfirm={() => void submit()}
				size="md"
			>
				<label htmlFor={nameId} className="flex flex-col gap-1.5 text-sm font-medium text-fg">
					Name
					<Input
						id={nameId}
						autoFocus
						value={name}
						error={error ?? undefined}
						onChange={(event) => setName(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.preventDefault();
								void submit();
							}
						}}
					/>
				</label>
				<div className="flex flex-col gap-2">
					<Label htmlFor={emojiId}>Emoji (optional)</Label>
					<div className="flex items-center gap-2">
						<Input
							id={emojiId}
							value={emoji}
							aria-label="Emoji"
							className="w-20 text-center"
							maxLength={8}
							onChange={(event) => setEmoji(event.target.value)}
						/>
						<div className="flex flex-wrap gap-1">
							{EMOJI_CHOICES.map((choice) => (
								<button
									key={choice}
									type="button"
									aria-label={`Use ${choice}`}
									aria-pressed={emoji === choice}
									onClick={() => setEmoji(choice)}
									className={cn(
										"flex size-7 items-center justify-center rounded-md text-base hover:bg-hover",
										emoji === choice && "bg-active",
									)}
								>
									{choice}
								</button>
							))}
						</div>
					</div>
				</div>
				<DialogFooter>
					<Button variant="ghost" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button
						variant="default"
						loading={busy}
						disabled={name.trim().length === 0}
						onClick={() => void submit()}
					>
						{initial.current === null ? "Create" : "Save"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
