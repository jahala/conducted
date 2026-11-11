/**
 * @feature WS-05 Archive
 * Owns: the one archive call the actions menu and the Git panel use, its confirmation for running
 * agents, and the recovery actions Conductor offers when it fails.
 * Behaviour: success-side-effects.md row 5 and services-map.md 3.10 (the archive call); renderApp
 * @11400002-@11403626 (the "Archive workspace?" dialog and its confirm labels), main
 * @3752958-@3754303 (the git-operation warning, the corrupt and ordinary failures with their
 * Delete actions, and "Failed to delete workspace: ...").
 * Our design choice: both screens share this hook, so the dialog, the warnings and their actions
 * cannot drift apart. A successful archive needs no navigation here: the workspace route already
 * goes Home while the row is archiving.
 * Must handle: running chats (ask, then archive with `stopRunningAgents`); an unfinished git
 * operation (warn, then archive with `discardGitOperationState`); a missing folder (offer
 * "Delete permanently"); any other failure (offer "Delete anyway"); a delete that fails (its
 * persistent toast).
 * Test first: an archive refused for a running chat opens "Archive workspace?" and its confirm
 * archives with `stopRunningAgents: true`.
 */
import type { WorkspaceId } from "@conducted/shared";
import { appError, messageOf } from "@conducted/shared";
import { useState } from "react";
import type { Actions } from "../../core/api.ts";
import { useActions } from "../../core/hooks.ts";
import { AlertDialog, AlertDialogContent } from "../../ui/AlertDialog.tsx";
import { toast } from "../../ui/Toast.tsx";

export const ARCHIVE_DIALOG_TITLE = "Archive workspace?";
export const ARCHIVE_DIALOG_DESCRIPTION =
	"Agents are still running in this workspace. Archiving will stop them and end any in-progress work.";
export const ARCHIVE_CONFIRM_LABEL = "Stop agents and archive";
export const ARCHIVE_GIT_OPERATION_WARNING =
	"Because a Git operation (merge, rebase, cherry-pick, or revert) is in progress, archiving may lose some of your work.";
export const ARCHIVE_CORRUPT_QUESTION =
	"Archiving failed. This workspace might be corrupted. Delete permanently?";
export const DELETE_PERMANENTLY_LABEL = "Delete permanently";
export const DELETE_ANYWAY_LABEL = "Delete anyway";

type ArchiveOptions = {
	deleteBranch: boolean;
	discardGitOperationState?: boolean;
	stopRunningAgents?: boolean;
};

/**
 * Deletes a workspace. Its failure is a persistent toast with Conductor's words. Deleting the
 * workspace that is open makes its row disappear, and the workspace route then goes Home.
 */
export async function deleteWorkspace(actions: Actions, workspaceId: WorkspaceId): Promise<void> {
	let result: Awaited<ReturnType<Actions["workspaces"]["remove"]>>;
	try {
		result = await actions.workspaces.remove(workspaceId);
	} catch (caught) {
		result = { ok: false, error: appError("delete_failed", messageOf(caught), caught) };
	}
	if (!result.ok) {
		toast.error(`Failed to delete workspace: ${result.error.message}`, {
			duration: Number.POSITIVE_INFINITY,
		});
	}
}

export interface ArchiveWorkspaceControl {
	/** Archiving as the menu or the Git panel offers it, before any confirmation. */
	archive: () => void;
	/** True while "Archive workspace?" is open. */
	confirming: boolean;
	confirm: () => void;
	cancel: () => void;
}

/**
 * The archive call and its recovery. A refusal for running chats asks first; a git operation, a
 * missing folder and any other failure arrive with the action that Conductor offers.
 */
export function useArchiveWorkspace(workspaceId: WorkspaceId): ArchiveWorkspaceControl {
	const actions = useActions();
	const [confirming, setConfirming] = useState(false);

	const run = async (options: ArchiveOptions): Promise<void> => {
		let result: Awaited<ReturnType<Actions["workspaces"]["archive"]>>;
		try {
			result = await actions.workspaces.archive(workspaceId, options);
		} catch (caught) {
			result = { ok: false, error: appError("archive_failed", messageOf(caught), caught) };
		}
		if (result.ok) return;
		if (result.error.code === "workspace_has_running_sessions") {
			setConfirming(true);
			return;
		}
		if (result.error.code === "archive_git_busy") {
			toast.warning(ARCHIVE_GIT_OPERATION_WARNING, {
				duration: Number.POSITIVE_INFINITY,
				action: {
					label: "Archive",
					onClick: () => void run({ ...options, discardGitOperationState: true }),
				},
			});
			return;
		}
		const deleteLabel =
			result.error.code === "workspace_corrupted" ? DELETE_PERMANENTLY_LABEL : DELETE_ANYWAY_LABEL;
		toast.error(
			result.error.code === "workspace_corrupted" ? ARCHIVE_CORRUPT_QUESTION : result.error.message,
			{
				duration: Number.POSITIVE_INFINITY,
				action: { label: deleteLabel, onClick: () => void deleteWorkspace(actions, workspaceId) },
			},
		);
	};

	return {
		archive: () => void run({ deleteBranch: false }),
		confirming,
		confirm: () => {
			setConfirming(false);
			void run({ deleteBranch: false, stopRunningAgents: true });
		},
		cancel: () => setConfirming(false),
	};
}

export function ArchiveWorkspaceDialog({
	control,
}: {
	control: Pick<ArchiveWorkspaceControl, "confirming" | "confirm" | "cancel">;
}) {
	if (!control.confirming) return null;
	return (
		<AlertDialog open onOpenChange={(open) => (open ? undefined : control.cancel())}>
			<AlertDialogContent
				title={ARCHIVE_DIALOG_TITLE}
				description={ARCHIVE_DIALOG_DESCRIPTION}
				confirmLabel={ARCHIVE_CONFIRM_LABEL}
				tone="destructive"
				onConfirm={control.confirm}
			/>
		</AlertDialog>
	);
}
