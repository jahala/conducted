/**
 * @feature WS-07 Linked workspaces and extra folders
 * Owns: the dialog that links other workspaces and folders to a workspace, so its agents may read
 * and edit them.
 * Behaviour: ui-map.md 3.10 ("Link workspaces and directories", "Select working directories",
 * "Link a directory or workspace"), 3.5 (the '@' action and the slash command open this dialog).
 * Our design choice: the dialog edits one list and saves it in one call, like the other dialogs in
 * the app. A linked workspace is stored as its folder path; a folder chosen from the system picker
 * is stored the same way. The folder's own name is the row's second column.
 * Must handle: the folder picker is cancelled; the workspace has no other workspaces to link; a
 * linked folder is removed again; a save that fails keeps the dialog open and shows the reason.
 * Test first: choosing a folder and saving stores its path on the workspace.
 */

import type { WorkspaceId } from "@conducted/shared";
import { useEffect, useRef, useState } from "react";
import { useActions, useWorkspace, useWorkspaces } from "../../core/hooks.ts";
import { isArchivedWorkspace } from "../../core/status/archived.ts";
import { normaliseLinkedPaths } from "../../core/workspace-helpers.ts";
import { Button } from "../../ui/Button.tsx";
import { Checkbox } from "../../ui/Checkbox.tsx";
import { Dialog, DialogContent, DialogFooter } from "../../ui/Dialog.tsx";
import { CloseIcon, FolderPlusIcon } from "../../ui/icons.tsx";

export interface LinkDirectoriesDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	workspaceId: WorkspaceId;
}

/** The last segment of a folder path, for a row's label. */
function folderName(path: string): string {
	const trimmed = path.replace(/\/+$/, "");
	return trimmed.slice(trimmed.lastIndexOf("/") + 1) || path;
}

export function LinkDirectoriesDialog({
	open,
	onOpenChange,
	workspaceId,
}: LinkDirectoriesDialogProps) {
	const actions = useActions();
	const workspace = useWorkspace(workspaceId);
	const workspaces = useWorkspaces();
	const [paths, setPaths] = useState<string[]>([]);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const loaded = useRef(false);

	useEffect(() => {
		if (!open) {
			loaded.current = false;
			return;
		}
		if (loaded.current || workspace.state !== "ready") return;
		loaded.current = true;
		setPaths([...workspace.data.linkedPaths]);
		setError(null);
	}, [open, workspace]);

	const addPath = (path: string) => {
		const cleaned = normaliseLinkedPaths([path]);
		if (!cleaned.ok) {
			setError(cleaned.error.message);
			return;
		}
		const value = cleaned.value[0];
		if (value === undefined) return;
		setPaths((current) => (current.includes(value) ? current : [...current, value]));
	};

	const pickFolder = async () => {
		const picked = await actions.app.pickFolder("Select directory to link");
		if (!picked.ok) {
			setError(picked.error.message);
			return;
		}
		if (picked.value !== null) addPath(picked.value);
	};

	const toggleWorkspace = (path: string) => {
		setPaths((current) =>
			current.includes(path) ? current.filter((entry) => entry !== path) : [...current, path],
		);
	};

	const save = async () => {
		setBusy(true);
		setError(null);
		try {
			const saved = await actions.workspaces.setLinkedPaths(workspaceId, paths);
			if (!saved.ok) {
				setError(saved.error.message);
				return;
			}
			onOpenChange(false);
		} finally {
			setBusy(false);
		}
	};

	const otherWorkspaces =
		workspaces.state === "ready"
			? workspaces.data.filter((entry) => entry.id !== workspaceId && !isArchivedWorkspace(entry))
			: [];

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				title="Link workspaces and directories"
				description="Linked folders are extra places this workspace's agents may read and edit."
				onConfirm={() => void save()}
			>
				<div className="flex flex-col gap-3">
					<div className="flex items-center justify-between gap-3">
						<h3 className="text-sm font-medium text-fg">Link a directory or workspace</h3>
						<Button variant="outline" size="sm" onClick={() => void pickFolder()}>
							Select working directories
						</Button>
					</div>
					{paths.length === 0 ? (
						<p className="text-sm text-fg-muted">No folders are linked yet.</p>
					) : (
						<ul aria-label="Linked folders" className="flex flex-col gap-1">
							{paths.map((path) => (
								<li
									key={path}
									className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5"
								>
									<FolderPlusIcon className="size-3.5 text-fg-muted" />
									<span className="min-w-0 flex-1 truncate text-sm text-fg">
										{folderName(path)}
									</span>
									<span className="min-w-0 flex-[2] truncate text-xs text-fg-muted">{path}</span>
									<Button
										variant="ghost"
										size="xs"
										aria-label={`Unlink ${path}`}
										onClick={() => setPaths((current) => current.filter((entry) => entry !== path))}
									>
										<CloseIcon />
									</Button>
								</li>
							))}
						</ul>
					)}
				</div>
				<div className="flex flex-col gap-2">
					<h3 className="text-sm font-medium text-fg">Workspaces</h3>
					{otherWorkspaces.length === 0 ? (
						<p className="text-sm text-fg-muted">No other workspaces to link.</p>
					) : (
						<ul aria-label="Workspaces" className="flex flex-col gap-1">
							{otherWorkspaces.map((entry) => {
								const checked = paths.includes(entry.path);
								const name = entry.displayName ?? entry.directoryName;
								return (
									<li key={entry.id} className="flex items-center gap-2 rounded-md px-2 py-1.5">
										<Checkbox
											id={`link-workspace-${entry.id}`}
											checked={checked}
											onCheckedChange={() => toggleWorkspace(entry.path)}
										/>
										<label
											htmlFor={`link-workspace-${entry.id}`}
											className="min-w-0 flex-1 truncate text-sm text-fg"
										>
											{name}
										</label>
										<span className="min-w-0 flex-[2] truncate text-xs text-fg-muted">
											{entry.directoryName}
										</span>
									</li>
								);
							})}
						</ul>
					)}
				</div>
				{error === null ? null : <p className="text-sm text-danger">{error}</p>}
				<DialogFooter>
					<Button variant="ghost" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button variant="default" loading={busy} onClick={() => void save()}>
						Save
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
