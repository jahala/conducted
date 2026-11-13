/**
 * @feature WS-07 Linked workspaces and extra folders
 * Owns: the linked folders above a local workspace's composer: one outlined chip per folder with its
 * name over its path, an X that unlinks it, and Conductor's tooltip.
 * Behaviour: Conductor's chip row above the composer (renderApp `pca` and `gca`, @9263982 to
 * @9268700): "Files from this directory are accessible to the agent in this workspace." and the
 * X named "Unlink directory <name>".
 * Our design choice: a linked workspace is stored as its folder path (LinkDirectoriesDialog), so a
 * path that is a workspace's folder gets no folder chip. Conductor's chips for linked workspaces are
 * not built.
 * Must handle: no linked folder (nothing drawn); an unlink that fails (a toast with the reason).
 * Test first: a linked folder shows its name and path above the composer, and its X unlinks it.
 */
import { trimTrailingSlashes, type WorkspaceId } from "@conducted/shared";
import { useActions, useWorkspace, useWorkspaces } from "../../core/hooks.ts";
import { CloseIcon, FolderIcon } from "../../ui/icons.tsx";
import { toastError } from "../../ui/Toast.tsx";
import { Tooltip } from "../../ui/Tooltip.tsx";

/** The last segment of a folder path, the chip's name. */
function folderName(path: string): string {
	const trimmed = trimTrailingSlashes(path);
	return trimmed.slice(trimmed.lastIndexOf("/") + 1) || path;
}

export function LinkedDirectoryChips({ workspaceId }: { workspaceId: WorkspaceId }) {
	const actions = useActions();
	const workspace = useWorkspace(workspaceId);
	const workspaces = useWorkspaces();
	if (workspace.state !== "ready" || workspaces.state !== "ready") return null;
	const workspacePaths = new Set(workspaces.data.map((entry) => entry.path));
	const linked = workspace.data.linkedPaths;
	const directories = linked.filter((path) => !workspacePaths.has(path));
	if (directories.length === 0) return null;

	const unlink = async (path: string): Promise<void> => {
		const saved = await actions.workspaces.setLinkedPaths(
			workspaceId,
			linked.filter((entry) => entry !== path),
		);
		if (!saved.ok) toastError("Couldn't unlink the directory", saved.error);
	};

	return (
		<div className="flex flex-wrap gap-2">
			{directories.map((path) => {
				const name = folderName(path);
				return (
					<div
						key={path}
						className="flex items-center gap-1.5 rounded-md border border-border bg-raised py-1 pr-1 pl-2 hover:bg-raised/50"
					>
						<Tooltip content="Files from this directory are accessible to the agent in this workspace.">
							<button type="button" className="flex min-w-0 items-center gap-1.5 text-left">
								<FolderIcon className="size-3 shrink-0 text-fg-muted" />
								<span className="flex min-w-0 flex-col items-start">
									<span className="truncate text-xs text-fg">{name}</span>
									<span className="truncate text-3xs text-fg-muted">{path}</span>
								</span>
							</button>
						</Tooltip>
						<button
							type="button"
							aria-label={`Unlink directory ${name}`}
							onClick={() => void unlink(path)}
							className="flex size-4 shrink-0 items-center justify-center rounded-sm text-fg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus"
						>
							<CloseIcon className="size-3" />
						</button>
					</div>
				);
			})}
		</div>
	);
}
