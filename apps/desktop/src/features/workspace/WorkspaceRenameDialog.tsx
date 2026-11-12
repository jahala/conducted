/**
 * @feature NAV-10 Rename workspace dialog
 * Owns: the one rename-workspace dialog, shared by the header's pencil button and the actions menu.
 * Behaviour: ui-map.md 3.1 and 5.2 ('Rename workspace').
 * Our design choice: The starting name is the same one the header shows, so both callers start from
 * the same text.
 * Must handle: the service refusing (the Result's message under the field, dialog stays open).
 * Test first: opening from either caller starts with the workspace's shown name.
 */
import type { WorkspaceId } from "@conducted/shared";
import { useActions, useWorkspace } from "../../core/hooks.ts";
import { RenameDialog } from "./RenameDialog.tsx";
import { useBranchPrefix } from "./use-branch-prefix.ts";
import { workspaceName } from "./workspace-name.ts";

export interface WorkspaceRenameDialogProps {
	workspaceId: WorkspaceId;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function WorkspaceRenameDialog({
	workspaceId,
	open,
	onOpenChange,
}: WorkspaceRenameDialogProps) {
	const workspace = useWorkspace(workspaceId);
	const actions = useActions();
	const branchPrefix = useBranchPrefix();
	const data = workspace.state === "ready" ? workspace.data : null;
	const initialName = data === null ? "" : workspaceName(data, branchPrefix);

	return (
		<RenameDialog
			open={open}
			onOpenChange={onOpenChange}
			title="Rename workspace"
			description={<span className="sr-only">Enter a new name for this workspace</span>}
			initialName={initialName}
			onSubmit={(name) => actions.workspaces.rename(workspaceId, name)}
		/>
	);
}
