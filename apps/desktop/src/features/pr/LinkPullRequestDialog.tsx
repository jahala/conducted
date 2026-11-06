/**
 * @feature PR-10 Link a pull request by URL or number
 * Owns: the "Link pull request" dialog: one field for a pull request URL or number, Cancel and Link.
 * Behaviour: ui-map.md 3.10 and 5.2 (the "Link pull request" dialog with "PR URL or number").
 * Our design choice: the same field accepts a full URL or a bare number, and the service decides
 * which it is. The typed text is reset when the dialog opens, never while it is open. One submit
 * runs at a time, because Enter and Cmd+Enter reach the same handler.
 * Must handle: an empty field (Link disabled); Enter and Cmd+Enter submitting once; a refused link
 * (the message under the field, the dialog stays open); Escape and Cancel closing it.
 * Test first: typing a pull request URL and pressing Link calls onSubmit with that URL once.
 */
import type { Result } from "@conducted/shared";
import { useEffect, useId, useRef, useState } from "react";
import { createSingleFlight } from "../../core/async/single-flight.ts";
import { Button } from "../../ui/Button.tsx";
import { Dialog, DialogContent, DialogFooter } from "../../ui/Dialog.tsx";
import { Input } from "../../ui/Input.tsx";

export interface LinkPullRequestDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSubmit: (urlOrNumber: string) => Promise<Result<unknown>>;
}

export function LinkPullRequestDialog({
	open,
	onOpenChange,
	onSubmit,
}: LinkPullRequestDialogProps) {
	const inputId = useId();
	const [text, setText] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const flight = useRef(createSingleFlight()).current;

	useEffect(() => {
		if (!open) return;
		setText("");
		setError(null);
	}, [open]);

	const submit = () => {
		const trimmed = text.trim();
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
			<DialogContent title="Link pull request" size="sm" onConfirm={() => void submit()}>
				<label htmlFor={inputId} className="flex flex-col gap-1.5 text-sm font-medium text-fg">
					PR URL or number
					<Input
						id={inputId}
						autoFocus
						value={text}
						placeholder="https://github.com/owner/repo/pull/123"
						error={error ?? undefined}
						onChange={(event) => setText(event.target.value)}
						onKeyDown={(event) => {
							if (event.key !== "Enter") return;
							event.preventDefault();
							void submit();
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
						disabled={text.trim().length === 0}
						onClick={() => void submit()}
					>
						Link
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
