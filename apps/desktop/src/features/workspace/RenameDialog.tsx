/**
 * @feature NAV-10 Rename dialog
 * Owns: One small dialog to rename a workspace or a chat.
 * Behaviour: ui-map.md 3.10 and 5.2 ('Rename workspace', 'Rename chat').
 * Must handle: Empty name (submit disabled); Enter submits; Escape closes; the action fails (error
 * under the field, dialog stays open); the current name is selected on open.
 * Test first: Submitting 'Fix login' calls onSubmit('Fix login'); an empty field disables the
 * submit button.
 */
import { useEffect, useId, useState } from "react";
import { Button } from "../../ui/Button.tsx";
import { Dialog, DialogContent, DialogFooter } from "../../ui/Dialog.tsx";
import { Input } from "../../ui/Input.tsx";

export interface RenameDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	initialName: string;
	onSubmit: (name: string) => Promise<void>;
}

export function RenameDialog({
	open,
	onOpenChange,
	title,
	initialName,
	onSubmit,
}: RenameDialogProps) {
	const inputId = useId();
	const [name, setName] = useState(initialName);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!open) return;
		setName(initialName);
		setError(null);
	}, [open, initialName]);

	const submit = async () => {
		const trimmed = name.trim();
		if (trimmed.length === 0 || busy) return;
		setBusy(true);
		setError(null);
		try {
			await onSubmit(trimmed);
			onOpenChange(false);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "The name could not be saved.");
		} finally {
			setBusy(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent title={title} onConfirm={() => void submit()} className="max-w-md" size="md">
				<label htmlFor={inputId} className="flex flex-col gap-1.5 text-sm font-medium text-fg">
					Name
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
						Rename
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
