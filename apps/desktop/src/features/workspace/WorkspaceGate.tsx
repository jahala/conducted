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
 * tabs stay usable); unarchive that needs a branch name; a refused branch name (shown under the
 * field). The toasts for a failure and for lost uncommitted changes come from `runUnarchive`.
 * Test first: an archived workspace shows "Workspace archived"; a ready one renders its children.
 */
import type { WorkspaceId } from "@conducted/shared";
import { type ReactNode, useState } from "react";
import { useActions, useWorkspace } from "../../core/hooks.ts";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { LoadableView } from "../../ui/LoadableView.tsx";
import { ArchivedNotice } from "./ArchivedNotice.tsx";
import { runUnarchive } from "./workspace-actions.ts";

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
			const result = await runUnarchive(actions, workspaceId, { branchName, clearChats: false });
			if (!result.ok) {
				setBranchError(branchName === null ? null : result.error.message);
				return;
			}
			setBranchNameRequired(result.value.needsBranchName);
			if (!result.value.needsBranchName) setBranchError(null);
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
