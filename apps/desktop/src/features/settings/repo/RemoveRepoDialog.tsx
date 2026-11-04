/**
 * @feature SET-07 Remove repository dialog
 * Owns: the confirm dialog for removing a repository from the app.
 * Behaviour: ui-map.md 6, "Misc (repo)" (Remove repository: removes the repository and its
 * workspaces from the app; do not move or delete the folders yourself).
 * Our design choice: removal never deletes the user's main clone. Workspace folders go to the
 * Trash, as all deletes in the app do (CLAUDE.md, deleting files).
 * Must handle: workspaces with running agents (listed, stopping them is part of confirming),
 * workspaces with unmerged work (called out), the delete failing half-way (what remains is shown),
 * and Escape cancelling.
 * Test first: with two workspaces the dialog names the count and Confirm calls onConfirm once.
 */
import { notImplemented } from "@conducted/shared";

export interface RemoveRepoDialogProps {
	open: boolean;
	repoName: string;
	workspaceCount: number;
	runningAgentCount: number;
	onOpenChange: (open: boolean) => void;
	onConfirm: () => Promise<boolean>;
}

export function RemoveRepoDialog(_props: RemoveRepoDialogProps): never {
	return notImplemented("SET-07");
}
