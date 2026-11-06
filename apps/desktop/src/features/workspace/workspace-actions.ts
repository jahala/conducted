/**
 * @feature NAV-10 Workspace actions
 * Owns: `runUnarchive`, the one call every screen uses to restore an archived workspace, with or
 * without its chats, and the messages the user sees about the outcome.
 * Behaviour: ui-map.md 3.2 and 3.1 (Unarchive in the archived notice and in the actions menu), 4
 * (an archived card offers "Unarchive workspace" and "Clear & unarchive"); services-map.md 1.4
 * (unarchive asks for a branch name and reports "uncommitted changes could not be recovered").
 * Our design choice: the archived notice, the Home card and the actions menu all call this, so a
 * refusal, a lost-changes warning and the branch-name question behave the same everywhere. The
 * caller opens its own branch prompt when the outcome has `needsBranchName`, and keeps the
 * `clearChats` choice for the second call.
 * Must handle: the service refusing (an error toast, and the error is returned for a branch field);
 * a call that throws (the same toast, returned as an error); a restore that lost uncommitted changes
 * (a warning toast, because the workspace is ready by then); a branch name supplied after the
 * service asked for one.
 * Test first: a restore with uncommittedChangesLost shows the "couldn't be recovered" warning.
 */
import { appError, err, messageOf, type Result, type WorkspaceId } from "@conducted/shared";
import type { Actions, UnarchiveOutcome } from "../../core/api.ts";
import { toast, toastError } from "../../ui/Toast.tsx";

export const UNARCHIVE_FAILED_TITLE = "Couldn't unarchive the workspace";
export const UNCOMMITTED_CHANGES_LOST = "Uncommitted changes couldn't be recovered.";

export interface UnarchiveOptions {
	/** A new branch name, given after the service asked for one. Null keeps the branch. */
	branchName: string | null;
	/** "Clear & unarchive": the workspace's chats are removed once it is back. */
	clearChats: boolean;
}

/**
 * Restores an archived workspace and tells the user what they need to know. A failure shows an
 * error toast and comes back as the error. A restore that lost uncommitted changes shows a
 * warning. When the outcome has `needsBranchName`, nothing changed and the caller asks for a name.
 */
export async function runUnarchive(
	actions: Actions,
	workspaceId: WorkspaceId,
	options: UnarchiveOptions,
): Promise<Result<UnarchiveOutcome>> {
	let result: Result<UnarchiveOutcome>;
	try {
		result = await actions.workspaces.unarchive(workspaceId, options);
	} catch (caught) {
		const message = messageOf(caught);
		result = err(appError("unarchive_failed", message, caught));
	}
	if (!result.ok) {
		toastError(UNARCHIVE_FAILED_TITLE, result.error);
		return result;
	}
	if (result.value.uncommittedChangesLost) toast.warning(UNCOMMITTED_CHANGES_LOST);
	return result;
}
