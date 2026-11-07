/**
 * @feature NAV-10 Unarchive from inside an archived workspace
 * Owns: the state of one unarchive control (busy, the branch-name question, a refused branch name),
 * so the chat's archived bar and the archived notice on a file, terminal or browser tab behave alike.
 * Behaviour: ui-map.md 3.3 ("This workspace is archived." with "Unarchive"), 3.2 (archived workspace);
 * services-map.md 1.4 (unarchive asks for a branch name).
 * Must handle: a second click while the first unarchive runs (ignored by the caller's busy button); the
 * service asking for a branch name (branchNameRequired turns on); a refused branch name (its message is
 * kept for the field); a refusal without a branch name (the toast from runUnarchive is all the user sees).
 * Test first: unarchives from an archived tab's notice.
 */
import type { WorkspaceId } from "@conducted/shared";
import { useState } from "react";
import { useActions } from "../../core/hooks.ts";
import { runUnarchive } from "./workspace-actions.ts";

export interface UnarchiveControl {
	unarchive: (branchName: string | null) => Promise<void>;
	busy: boolean;
	branchNameRequired: boolean;
	branchError: string | null;
}

export function useUnarchive(workspaceId: WorkspaceId): UnarchiveControl {
	const actions = useActions();
	const [busy, setBusy] = useState(false);
	const [branchNameRequired, setBranchNameRequired] = useState(false);
	const [branchError, setBranchError] = useState<string | null>(null);

	const unarchive = async (branchName: string | null): Promise<void> => {
		setBusy(true);
		try {
			const result = await runUnarchive(actions, workspaceId, { branchName, clearChats: false });
			if (!result.ok) {
				setBranchError(branchName === null ? null : result.error.message);
				return;
			}
			setBranchNameRequired(result.value.needsBranchName);
			if (!result.value.needsBranchName) setBranchError(null);
		} finally {
			setBusy(false);
		}
	};

	return { unarchive, busy, branchNameRequired, branchError };
}
