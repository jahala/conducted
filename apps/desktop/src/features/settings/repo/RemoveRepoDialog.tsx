/**
 * @feature SET-07 Remove repository dialog
 * Owns: the confirm dialog for removing a repository from the app.
 * Behaviour: ui-map.md 6, "Misc (repo)" (Remove repository: removes the repository and its
 * workspaces from the app; do not move or delete the folders yourself).
 * Our design choice: removal never deletes the user's main clone. Workspace folders go to the
 * Trash, as all deletes in the app do (CLAUDE.md, deleting files).
 * Must handle: the count of workspaces with running agents (stopping them is part of confirming),
 * the delete failing (the dialog stays open with the failure), and Escape cancelling.
 * Test first: with two workspaces the dialog names the count and Confirm calls onConfirm once.
 */
import { useState } from "react";
import { Button } from "../../../ui/Button.tsx";
import { Dialog, DialogContent, DialogFooter } from "../../../ui/Dialog.tsx";

export interface RemoveRepoDialogProps {
	open: boolean;
	repoName: string;
	workspaceCount: number;
	runningAgentCount: number;
	onOpenChange: (open: boolean) => void;
	onConfirm: () => Promise<boolean>;
}

const plural = (count: number, one: string, many: string): string =>
	count === 1 ? `1 ${one}` : `${count} ${many}`;

export function RemoveRepoDialog({
	open,
	repoName,
	workspaceCount,
	runningAgentCount,
	onOpenChange,
	onConfirm,
}: RemoveRepoDialogProps) {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const confirm = async () => {
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			const removed = await onConfirm();
			if (removed) onOpenChange(false);
			else setError("The repository could not be fully removed.");
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "The repository could not be removed.");
		} finally {
			setBusy(false);
		}
	};

	const workspaces = plural(workspaceCount, "workspace", "workspaces");
	const agents = plural(runningAgentCount, "agent is", "agents are");

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (busy) return;
				if (!next) setError(null);
				onOpenChange(next);
			}}
		>
			<DialogContent
				letShortcutsThrough
				title="Remove repository"
				description={`Remove ${repoName} and its ${workspaces} from Conducted? The repository folder is not deleted.`}
				onConfirm={() => void confirm()}
			>
				<div className="flex flex-col gap-3 text-sm text-fg-muted">
					<p>
						Workspace folders are moved to the Trash. Your main clone stays where it is, and
						anything already pushed to GitHub stays there.
					</p>
					{runningAgentCount > 0 ? (
						<p role="alert" className="text-warning">
							{agents} running. They will be stopped before the repository is removed.
						</p>
					) : null}
					{error !== null ? (
						<p role="alert" className="text-danger">
							{error}
						</p>
					) : null}
				</div>
				<DialogFooter>
					<Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button variant="destructive" loading={busy} onClick={() => void confirm()}>
						Remove repository
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
