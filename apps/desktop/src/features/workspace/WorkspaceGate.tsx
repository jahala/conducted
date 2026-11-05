/**
 * @feature NAV-10 Workspace gate
 * Owns: loading the workspace and deciding what the centre shows before any tab: a skeleton, a "not found" or
 * load error, the archived notice, or the tabs.
 * Behaviour: ui-map.md 7.4 ("Error loading workspace", "Workspace not found", "It may have been deleted..."),
 * 3.2 (archived workspace).
 * Our design choice: the gate wraps the centre, including the tab strip. The header and right panel stay in
 * place so the window does not jump. A workspace id nobody knows gets its own not-found card.
 * Must handle: loading; a load error; a workspace id with no row ("Workspace not found" with the deleted
 * hint); archived; a workspace in "initializing" or "failed" state (shown by the header and Git panel,
 * tabs stay usable); unarchive that needs a branch name; a restore that lost uncommitted changes (a
 * warning, because the workspace is ready by then and this gate no longer shows the notice).
 * Test first: an archived workspace shows "Workspace archived"; a ready one renders its children.
 */
import type { WorkspaceId } from "@conducted/shared";
import { type ReactNode, useState } from "react";
import { useActions, useWorkspace } from "../../core/hooks.ts";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { LoadableView } from "../../ui/LoadableView.tsx";
import { toast, toastError } from "../../ui/Toast.tsx";
import { ArchivedNotice } from "./ArchivedNotice.tsx";
import { unarchiveWorkspace } from "./workspace-actions.ts";

export function WorkspaceGate({
	workspaceId,
	children,
}: {
	workspaceId: WorkspaceId;
	children: ReactNode;
}) {
	const workspace = useWorkspace(workspaceId);
	const actions = useActions();
	const [unarchiving, setUnarchiving] = useState(false);
	const [branchNameRequired, setBranchNameRequired] = useState(false);
	const [branchError, setBranchError] = useState<string | null>(null);

	const unarchive = async (branchName: string | null) => {
		setUnarchiving(true);
		try {
			const result = await unarchiveWorkspace(actions, workspaceId, branchName);
			if (!result.ok) {
				setBranchError(branchName === null ? null : result.error.message);
				toastError("Couldn't unarchive the workspace", result.error);
				return;
			}
			if (result.value.needsBranchName) {
				setBranchNameRequired(true);
				return;
			}
			setBranchNameRequired(false);
			setBranchError(null);
			if (result.value.uncommittedChangesLost) {
				toast.warning("Uncommitted changes couldn't be recovered.");
			}
		} catch (caught) {
			toastError(
				"Couldn't unarchive the workspace",
				caught instanceof Error ? caught : { message: String(caught) },
			);
		} finally {
			setUnarchiving(false);
		}
	};

	if (workspace.state === "error" && workspace.error.code === "workspace_unknown") {
		return (
			<EmptyState
				tone="failed"
				title="Workspace not found"
				body="It may have been deleted, or this Mac no longer has it."
			/>
		);
	}

	return (
		<LoadableView
			value={workspace}
			loadingLabel="Loading workspace"
			errorTitle="Error loading workspace"
		>
			{(data) =>
				data.state === "archived" ? (
					<ArchivedNotice
						onUnarchive={(branchName) => void unarchive(branchName)}
						busy={unarchiving}
						branchNameRequired={branchNameRequired}
						branchError={branchError}
					/>
				) : (
					children
				)
			}
		</LoadableView>
	);
}
