/**
 * @feature WS-07 Linked workspaces and extra folders
 * Owns: the chips above a local workspace's composer: each linked workspace, each workspace that
 * links this one ("Linked from"), then each linked folder, in Conductor's order.
 * Behaviour: Conductor's chip row above the composer (renderApp `pca`, `EYi` and `gca`, @9263982
 * to @9268700). A linked workspace's chip names its project over its branch, opens the workspace,
 * and unlinks with the X "Unlink workspace <name>"; its tooltip is "Files from this directory are
 * accessible to Claude Code in this workspace." A workspace that links this one shows "Linked from"
 * and that workspace's name, opens it, has no X, and its tooltip is "Agents in <name> can access
 * this workspace." A folder shows its name over its path, with "Files from this directory are
 * accessible to the agent in this workspace." and the X "Unlink directory <name>".
 * Our design choice: a linked workspace is stored as its folder path (LinkDirectoriesDialog), so a
 * linked path that is a workspace's folder is that workspace's chip, and any other is a folder's.
 * Must handle: nothing linked either way (nothing drawn); an unlink that fails (a toast with the
 * reason); a workspace that links this one twice over (one chip).
 * Test first: a linked folder shows its name and path above the composer, and its X unlinks it.
 */
import { trimTrailingSlashes, type WorkspaceId } from "@conducted/shared";
import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useActions, useRepos, useWorkspace, useWorkspaces } from "../../core/hooks.ts";
import type { Workspace } from "../../core/model.ts";
import { CloseIcon, FolderIcon } from "../../ui/icons.tsx";
import { toastError } from "../../ui/Toast.tsx";
import { Tooltip } from "../../ui/Tooltip.tsx";
import { useBranchPrefix } from "../workspace/use-branch-prefix.ts";
import { workspaceName } from "../workspace/workspace-name.ts";

/** The last segment of a folder path, the chip's name. */
function folderName(path: string): string {
	const trimmed = trimTrailingSlashes(path);
	return trimmed.slice(trimmed.lastIndexOf("/") + 1) || path;
}

const CHIP = "flex items-center gap-1.5 rounded-md border border-border bg-raised py-1 pl-2";
const OPEN =
	"flex min-w-0 items-center gap-1.5 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus";
const UNLINK =
	"flex size-4 shrink-0 items-center justify-center rounded-sm text-fg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus";

/** One chip: an icon, a name over an optional second line, and an optional X. */
function Chip({
	tooltip,
	openLabel,
	onOpen,
	name,
	detail,
	unlinkLabel,
	onUnlink,
}: {
	tooltip: string;
	openLabel?: string;
	onOpen?: () => void;
	name: ReactNode;
	detail?: string;
	unlinkLabel?: string;
	onUnlink?: () => void;
}) {
	return (
		<div className={`${CHIP} ${onUnlink === undefined ? "pr-2" : "pr-1"} hover:bg-raised/50`}>
			<Tooltip content={tooltip}>
				<button type="button" aria-label={openLabel} onClick={onOpen} className={OPEN}>
					<FolderIcon className="size-3 shrink-0 text-fg-muted" />
					<span className="flex min-w-0 flex-col items-start">
						<span className="truncate text-xs text-fg">{name}</span>
						{detail === undefined ? null : (
							<span className="truncate text-3xs text-fg-muted">{detail}</span>
						)}
					</span>
				</button>
			</Tooltip>
			{onUnlink === undefined ? null : (
				<button type="button" aria-label={unlinkLabel} onClick={onUnlink} className={UNLINK}>
					<CloseIcon className="size-3" />
				</button>
			)}
		</div>
	);
}

export function LinkedDirectoryChips({ workspaceId }: { workspaceId: WorkspaceId }) {
	const actions = useActions();
	const navigate = useNavigate();
	const branchPrefix = useBranchPrefix();
	const workspace = useWorkspace(workspaceId);
	const workspaces = useWorkspaces();
	const repos = useRepos();
	if (workspace.state !== "ready" || workspaces.state !== "ready") return null;
	const self = workspace.data;
	const byPath = new Map(workspaces.data.map((entry) => [entry.path, entry]));
	const linked = self.linkedPaths;
	const linkedWorkspaces = linked.flatMap((path) => {
		const found = byPath.get(path);
		return found === undefined || found.id === self.id ? [] : [found];
	});
	const directories = linked.filter((path) => !byPath.has(path));
	const linkedBy = workspaces.data.filter(
		(entry) => entry.id !== self.id && entry.linkedPaths.includes(self.path),
	);
	if (linkedWorkspaces.length === 0 && linkedBy.length === 0 && directories.length === 0) {
		return null;
	}

	const repoName = (entry: Workspace): string =>
		(repos.state === "ready" ? repos.data.find((repo) => repo.id === entry.repoId)?.name : null) ??
		entry.directoryName;
	const open = (entry: Workspace) =>
		void navigate({
			to: "/repository/$repositoryId/workspace/$workspaceId",
			params: { repositoryId: entry.repoId, workspaceId: entry.id },
		});
	const unlink = async (path: string, failure: string): Promise<void> => {
		const saved = await actions.workspaces.setLinkedPaths(
			workspaceId,
			linked.filter((entry) => entry !== path),
		);
		if (!saved.ok) toastError(failure, saved.error);
	};

	return (
		<div className="flex flex-wrap gap-2">
			{linkedWorkspaces.map((entry) => {
				const name = repoName(entry);
				return (
					<Chip
						key={`linked-${entry.id}`}
						tooltip="Files from this directory are accessible to Claude Code in this workspace."
						openLabel={`Open workspace ${name}`}
						onOpen={() => open(entry)}
						name={name}
						detail={entry.branch}
						unlinkLabel={`Unlink workspace ${name}`}
						onUnlink={() => void unlink(entry.path, "Couldn't unlink the workspace")}
					/>
				);
			})}
			{linkedBy.map((entry) => {
				const name = workspaceName(entry, branchPrefix);
				return (
					<Chip
						key={`linked-by-${entry.id}`}
						tooltip={`Agents in ${name} can access this workspace.`}
						openLabel={`Open workspace ${name}`}
						onOpen={() => open(entry)}
						name={
							<>
								<span className="text-fg-muted">Linked from </span>
								{name}
							</>
						}
					/>
				);
			})}
			{directories.map((path) => {
				const name = folderName(path);
				return (
					<Chip
						key={path}
						tooltip="Files from this directory are accessible to the agent in this workspace."
						name={name}
						detail={path}
						unlinkLabel={`Unlink directory ${name}`}
						onUnlink={() => void unlink(path, "Couldn't unlink the directory")}
					/>
				);
			})}
		</div>
	);
}
