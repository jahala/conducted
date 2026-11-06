/**
 * @feature CHAT-15 Reset chat dialog
 * Owns: The confirmation to revert a chat to an earlier turn, with the option to restore files too.
 * Behaviour: ui-map.md 3.3 (Reset dialog: 'Reset chat?', 'Later messages will be deleted.',
 * checkbox 'Also reset files' with changed-file count, Cancel and Reset with Cmd+Enter), 3.3
 * checkpoint controls.
 * Must handle: Files option off (only the chat rewinds); the revert fails (message in the dialog,
 * chat unchanged, dialog stays open); Cmd+Enter confirms; an agent that is working is cancelled
 * first, and a failed cancel leaves the chat untouched. The file count is every file that differs
 * between the turn's start and the working tree now (useChangedSinceTurn), read only while the
 * dialog is open; while it loads, or when it cannot be read, no count shows, and the reset itself
 * reports why it cannot restore files.
 * Our design choice: the checkbox is remembered as the `reset_chat_also_reset_files` setting, and
 * it is written before the revert so the service reads the same choice the user saw.
 * Test first: Confirming with 'Also reset files' ticked calls sessions.revertTo(id, turnId); the
 * dialog closes on success only.
 */
import type { SessionId, TurnId } from "@conducted/shared";
import { useEffect, useRef, useState } from "react";
import { createSingleFlight } from "../../core/async/single-flight.ts";
import { useActions, useChangedSinceTurn, useSetting } from "../../core/hooks.ts";
import { Button } from "../../ui/Button.tsx";
import { Checkbox } from "../../ui/Checkbox.tsx";
import { Dialog, DialogContent, DialogFooter } from "../../ui/Dialog.tsx";

const ALSO_RESET_FILES_KEY = "reset_chat_also_reset_files";

export interface ResetChatDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	sessionId: SessionId;
	turnId: TurnId;
	/** The agent is still working on this turn. It is cancelled before the reset. */
	busy?: boolean;
}

export function ResetChatDialog({
	open,
	onOpenChange,
	sessionId,
	turnId,
	busy = false,
}: ResetChatDialogProps) {
	const actions = useActions();
	const preferred = useSetting<boolean>(ALSO_RESET_FILES_KEY);
	const [alsoResetFiles, setAlsoResetFiles] = useState(preferred);
	const [resetting, setResetting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const flight = useRef(createSingleFlight()).current;

	useEffect(() => {
		if (!open) return;
		setError(null);
	}, [open]);

	useEffect(() => {
		if (!open) return;
		setAlsoResetFiles(preferred);
	}, [open, preferred]);

	const reset = () =>
		flight.run("reset", async () => {
			setResetting(true);
			setError(null);
			try {
				if (busy) {
					const stopped = await actions.sessions.cancel(sessionId);
					if (!stopped.ok) {
						setError(stopped.error.message);
						return;
					}
				}
				const saved = await actions.settings.set(ALSO_RESET_FILES_KEY, alsoResetFiles);
				if (!saved.ok) {
					setError(saved.error.message);
					return;
				}
				const reverted = await actions.sessions.revertTo(sessionId, turnId);
				if (!reverted.ok) {
					setError(reverted.error.message);
					return;
				}
				onOpenChange(false);
			} finally {
				setResetting(false);
			}
		});

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				title="Reset chat?"
				description="Later messages will be deleted."
				onConfirm={() => void reset()}
				size="md"
			>
				<div className="flex flex-col gap-2">
					<div className="flex items-center gap-2 text-sm text-fg">
						<Checkbox
							checked={alsoResetFiles}
							onCheckedChange={setAlsoResetFiles}
							aria-label="Also reset files"
						/>
						<span>Also reset files</span>
						<ChangedFileCount sessionId={sessionId} turnId={turnId} />
					</div>
					{error === null ? null : <p className="text-sm text-danger">{error}</p>}
				</div>
				<DialogFooter>
					<Button variant="ghost" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button
						variant="destructive"
						loading={resetting}
						disabled={resetting}
						onClick={() => void reset()}
					>
						Reset
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/** The files a reset with "Also reset files" puts back. Mounted only while the dialog is open. */
function ChangedFileCount({ sessionId, turnId }: { sessionId: SessionId; turnId: TurnId }) {
	const changed = useChangedSinceTurn(sessionId, turnId);
	if (changed.state !== "ready") return null;
	const count = changed.data;
	return (
		<span className="text-xs text-fg-subtle">
			{count === 1 ? "1 file changed" : `${count} files changed`}
		</span>
	);
}
