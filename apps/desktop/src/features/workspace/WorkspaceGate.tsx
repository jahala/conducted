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
 * tabs stay usable).
 * Test first: an archived workspace shows "This workspace is archived"; a ready one renders its children.
 */
import type { WorkspaceId } from "@conducted/shared";
import { type ReactNode, useState } from "react";
import { useActions, useWorkspace } from "../../core/hooks.ts";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { LoadableView } from "../../ui/LoadableView.tsx";
import { toastError } from "../../ui/Toast.tsx";
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

	const unarchive = async () => {
		setUnarchiving(true);
		const result = await unarchiveWorkspace(actions, workspaceId);
		setUnarchiving(false);
		if (!result.ok) toastError("Couldn't unarchive the workspace", result.error);
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
					<ArchivedNotice onUnarchive={unarchive} busy={unarchiving} />
				) : (
					children
				)
			}
		</LoadableView>
	);
}
