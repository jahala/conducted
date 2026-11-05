/**
 * @feature NAV-10 Rename dialog
 * Owns: One small form dialog to rename a workspace, rename a branch or choose the target branch.
 * Behaviour: ui-map.md 3.10 and 5.2 ('Rename workspace', branch rename, target branch).
 * Our design choice: The label and the submit button are parameters, so the target branch dialog
 * and the chat rename reuse this form instead of copying it. Failure stays in the returned Result.
 * The typed text is reset when the dialog opens, never while it is open, so a background update of
 * the workspace cannot overwrite what the user is typing. One submit runs at a time: Enter and
 * Cmd+Enter in the field reach the same handler, so the guard is a single-flight, not a state flag.
 * Must handle: Empty name (submit disabled); Enter submits; Escape closes; the action fails (the
 * Result's message under the field, dialog stays open); the current name is selected on open;
 * Cmd+Enter submits once.
 * Test first: Submitting 'Fix login' calls onSubmit('Fix login'); an empty field disables the
 * submit button.
 */
import type { Result } from "@conducted/shared";
import { useEffect, useId, useRef, useState } from "react";
import { createSingleFlight } from "../../core/async/single-flight.ts";
import { Button } from "../../ui/Button.tsx";
import { Dialog, DialogContent, DialogFooter } from "../../ui/Dialog.tsx";
import { Input } from "../../ui/Input.tsx";

export interface RenameDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	initialName: string;
	onSubmit: (name: string) => Promise<Result<unknown>>;
	fieldLabel?: string;
	submitLabel?: string;
}

export function RenameDialog({
	open,
	onOpenChange,
	title,
	initialName,
	onSubmit,
	fieldLabel = "Name",
	submitLabel = "Rename",
}: RenameDialogProps) {
	const inputId = useId();
	const [name, setName] = useState(initialName);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const flight = useRef(createSingleFlight()).current;
	const initialNameRef = useRef(initialName);
	initialNameRef.current = initialName;

	useEffect(() => {
		if (!open) return;
		setName(initialNameRef.current);
		setError(null);
	}, [open]);

	const submit = () => {
		const trimmed = name.trim();
		if (trimmed.length === 0) return Promise.resolve();
		return flight.run("submit", async () => {
			setBusy(true);
			setError(null);
			try {
				const result = await onSubmit(trimmed);
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
			<DialogContent title={title} onConfirm={() => void submit()} className="max-w-md" size="md">
				<label htmlFor={inputId} className="flex flex-col gap-1.5 text-sm font-medium text-fg">
					{fieldLabel}
					<Input
						id={inputId}
						// The current name is selected so typing replaces it.
						autoFocus
						value={name}
						error={error ?? undefined}
						onChange={(event) => setName(event.target.value)}
						onFocus={(event) => event.target.select()}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.preventDefault();
								void submit();
							}
						}}
					/>
				</label>
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
						{submitLabel}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
