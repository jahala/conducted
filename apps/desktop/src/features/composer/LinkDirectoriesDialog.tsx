/**
 * @feature WS-07 Linked workspaces and extra folders
 * Owns: the dialog that links other workspaces and folders to a workspace, so its agents may read
 * and edit them.
 * Behaviour: ui-map.md 3.10 and Conductor's picker (renderApp @5683700 to @5688200): a command
 * dialog searching "Search workspaces..."; a "Directories" group whose first item, "Browse...",
 * opens the system folder picker ("Select directory to link") and whose other items are the linked
 * folders, each picked again to unlink; then the workspaces of the other repositories, one group per
 * repository, each marked "Link" or "Unlink"; and "No workspaces found" when a search matches none.
 * A search matches a workspace's folder name, its branch or its repository's name. Every pick
 * links or unlinks at once; there is no Save.
 * Our design choice: a linked workspace is stored as its folder path, as a folder from the system
 * picker is, so the Directories group lists the linked paths that are no workspace's folder.
 * Must handle: the folder picker cancelled (nothing changes) or failing (a toast); a save that fails
 * (a toast with the reason); two picks in quick succession (each applies to the list the one
 * before it wrote); a workspace with no other repository's workspaces to link.
 * Test first: Browse... links the folder the system picker returns.
 */

import { createKeyedQueue, type WorkspaceId } from "@conducted/shared";
import { Command } from "cmdk";
import { useEffect, useRef, useState } from "react";
import { useServices } from "../../core/context.tsx";
import { useActions, useRepos, useWorkspace, useWorkspaces } from "../../core/hooks.ts";
import type { Workspace } from "../../core/model.ts";
import { isArchivedWorkspace } from "../../core/status/archived.ts";
import { CheckIcon, CircleIcon, FolderIcon, SearchIcon } from "../../ui/icons.tsx";
import { toastError } from "../../ui/Toast.tsx";

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

const itemClass =
	"group flex h-9 cursor-default items-center gap-2 rounded-md px-2 text-sm text-fg outline-none data-[selected=true]:bg-active";

const groupClass =
	"[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-fg-muted";

/** The hint at a row's end, shown on the highlighted row as Conductor's is. */
function RowHint({ children }: { children: string }) {
	return (
		<span className="ml-auto shrink-0 text-xs text-fg-subtle opacity-0 group-data-[selected=true]:opacity-100">
			{children}
		</span>
	);
}

export function LinkDirectoriesDialog({
	open,
	onOpenChange,
	workspaceId,
}: LinkDirectoriesDialogProps) {
	const actions = useActions();
	const workspaceStore = useServices().services.workspace.store;
	const workspace = useWorkspace(workspaceId);
	const workspaces = useWorkspaces();
	const repos = useRepos();
	const [query, setQuery] = useState("");
	const [selected, setSelected] = useState("");
	// Picks run one after another, each on the list the one before it wrote.
	const saves = useRef(createKeyedQueue()).current;

	useEffect(() => {
		if (!open) setQuery("");
	}, [open]);

	const current = workspace.state === "ready" ? workspace.data : null;
	const all = workspaces.state === "ready" ? workspaces.data : [];
	const linked = current?.linkedPaths ?? [];
	const workspacePaths = new Set(all.map((entry) => entry.path));
	const directories = linked.filter((path) => !workspacePaths.has(path));
	const repoName = (repoId: string): string =>
		(repos.state === "ready" ? repos.data.find((repo) => repo.id === repoId)?.name : undefined) ??
		"Unknown Repository";

	const needle = query.trim().toLowerCase();
	const candidates =
		current === null
			? []
			: all.filter((entry) => entry.repoId !== current.repoId && !isArchivedWorkspace(entry));
	const matches =
		needle === ""
			? candidates
			: candidates.filter(
					(entry) =>
						entry.directoryName.toLowerCase().includes(needle) ||
						entry.branch.toLowerCase().includes(needle) ||
						repoName(entry.repoId).toLowerCase().includes(needle),
				);
	const groups = new Map<string, Workspace[]>();
	for (const entry of matches) {
		groups.set(entry.repoId, [...(groups.get(entry.repoId) ?? []), entry]);
	}

	/** Adds `path` when it is not linked and removes it when it is, on the latest saved list. */
	const toggle = (path: string): Promise<void> =>
		saves.run("links", async () => {
			const latest = workspaceStore.getState().workspacesById[workspaceId]?.linkedPaths ?? [];
			const next = latest.includes(path)
				? latest.filter((entry) => entry !== path)
				: [...latest, path];
			const saved = await actions.workspaces.setLinkedPaths(workspaceId, next);
			if (!saved.ok) toastError("Couldn't save the linked directories", saved.error);
		});

	const browse = async (): Promise<void> => {
		const picked = await actions.app.pickFolder("Select directory to link");
		if (!picked.ok) {
			toastError("Couldn't open the folder picker", picked.error);
			return;
		}
		if (picked.value === null) return;
		const latest = workspaceStore.getState().workspacesById[workspaceId]?.linkedPaths ?? [];
		if (!latest.includes(picked.value)) await toggle(picked.value);
	};

	return (
		<Command.Dialog
			open={open}
			onOpenChange={onOpenChange}
			label="Link workspaces and directories"
			shouldFilter={false}
			value={selected}
			onValueChange={setSelected}
			overlayClassName="fixed inset-0 z-40 bg-overlay"
			contentClassName="fixed left-1/2 top-[max(2rem,calc(50%-250px))] z-50 flex max-h-[500px] w-xl max-w-[calc(100%-2rem)] -translate-x-1/2 flex-col overflow-hidden rounded-md border border-border bg-raised text-fg shadow-palette"
		>
			<h2 className="sr-only">Search</h2>
			<div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-4">
				<SearchIcon className="size-4 shrink-0 text-fg-muted" />
				<Command.Input
					value={query}
					onValueChange={setQuery}
					placeholder="Search workspaces..."
					className="h-11 w-full bg-transparent text-base text-fg outline-none placeholder:text-fg-muted"
				/>
			</div>
			<Command.List className="min-h-0 overflow-y-auto p-1">
				<Command.Group heading="Directories" className={groupClass}>
					<Command.Item value="browse-folder" onSelect={() => void browse()} className={itemClass}>
						<FolderIcon className="size-4 shrink-0 text-fg-muted" />
						<span className="text-sm">Browse...</span>
					</Command.Item>
					{directories.map((path) => (
						<Command.Item
							key={path}
							value={`dir-${path}`}
							onSelect={() => void toggle(path)}
							className={itemClass}
						>
							<CheckIcon className="size-4 shrink-0" />
							<span className="shrink-0 text-sm">{folderName(path)}</span>
							<span className="min-w-0 truncate text-xs text-fg-muted">{path}</span>
							<RowHint>Unlink</RowHint>
						</Command.Item>
					))}
				</Command.Group>
				{matches.length === 0 && needle !== "" ? (
					<p className="mx-auto max-w-xs py-6 text-center text-sm text-fg-muted">
						No workspaces found
					</p>
				) : null}
				{[...groups.entries()].map(([repoId, entries]) => (
					<Command.Group key={repoId} heading={repoName(repoId)} className={groupClass}>
						{entries.map((entry) => {
							const isLinked = linked.includes(entry.path);
							return (
								<Command.Item
									key={entry.id}
									value={`workspace-${entry.id}`}
									onSelect={() => void toggle(entry.path)}
									className={itemClass}
								>
									{isLinked ? (
										<CheckIcon className="size-4 shrink-0" />
									) : (
										<CircleIcon className="size-4 shrink-0 text-fg-muted" />
									)}
									<span className="min-w-0 truncate text-xs text-fg-muted">
										{folderName(entry.directoryName)}
									</span>
									<RowHint>{isLinked ? "Unlink" : "Link"}</RowHint>
								</Command.Item>
							);
						})}
					</Command.Group>
				))}
			</Command.List>
		</Command.Dialog>
	);
}
