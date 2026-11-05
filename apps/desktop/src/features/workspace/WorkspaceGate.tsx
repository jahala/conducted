/**
 * @feature NAV-10 Workspace gate
 * Owns: loading the workspace and deciding what the centre shows before any tab: a skeleton, a "not found" or
 * load error, the archived notice, or the tabs.
 * Behaviour: ui-map.md 7.4 ("Error loading workspace", "Workspace not found", "It may have been deleted..."),
 * 3.2 (archived workspace).
 * Our design choice: the gate wraps only the centre content. The header, tab strip and right panel stay in place
 * so the window does not jump.
 * Must handle: loading; error with "Try again" (also for an id that matches nothing: the hook returns an error
 * state, never throws); archived;
 * a workspace in "initializing" or "failed" state (shown by the header and Git panel, tabs stay usable).
 * Test first: an archived workspace shows "This workspace is archived"; a ready one renders its children.
 */
import type { WorkspaceId } from "@conducted/shared";
import { type ReactNode, useState } from "react";
import { useActions, useWorkspace } from "../../core/hooks.ts";
import { LoadableView } from "../../ui/LoadableView.tsx";
import { toastError } from "../../ui/Toast.tsx";
import { ArchivedNotice } from "./ArchivedNotice.tsx";

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
		const result = await actions.workspaces.unarchive(workspaceId, {
			branchName: null,
			clearChats: false,
		});
		setUnarchiving(false);
		if (!result.ok) toastError("Couldn't unarchive the workspace", result.error);
	};

	return (
		<LoadableView
			value={workspace}
			loadingLabel="Loading workspace"
			errorTitle="Couldn't open this workspace"
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
