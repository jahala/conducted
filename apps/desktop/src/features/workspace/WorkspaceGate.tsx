/**
 * @feature NAV-10 Workspace gate
 * Owns: loading the workspace and deciding what the centre shows before any tab: a skeleton, a "not found" or
 * load error, or the tabs.
 * Behaviour: ui-map.md 7.4 ("Error loading workspace", "Workspace not found", "It may have been deleted..."),
 * 3.2 (archived workspace).
 * Our design choice: the gate wraps the centre, including the tab strip. The header and right panel stay in
 * place so the window does not jump. A workspace id nobody knows gets its own not-found card.
 * Must handle: loading; a load error; a workspace id with no row ("Workspace not found" with the deleted
 * hint); a workspace in "initializing" or "failed" state (shown by the header and Git panel, tabs stay
 * usable); archived (the tabs stay, as in Conductor: a chat stays readable with the archived bar for a
 * composer, and a file, terminal or browser tab shows the archived notice, see TabContent).
 * Test first: an archived workspace renders its tabs; a ready one renders its children.
 */
import type { WorkspaceId } from "@conducted/shared";
import type { ReactNode } from "react";
import { useWorkspace } from "../../core/hooks.ts";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { LoadableView } from "../../ui/LoadableView.tsx";

export function WorkspaceGate({
	workspaceId,
	children,
}: {
	workspaceId: WorkspaceId;
	children: ReactNode;
}) {
	const workspace = useWorkspace(workspaceId);

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
			{() => children}
		</LoadableView>
	);
}
