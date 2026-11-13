/**
 * @feature GIT-15 Sparse checkout and the external diff tool
 * @feature WS-07 Linked workspaces and extra folders
 * Owns: the working directories picker: which folders of the repository a workspace checks out
 * (git sparse checkout in cone mode), and the "Select working directories" button that opens it,
 * which the git panel's tab strip shows while All files is open (renderApp @4008200).
 * Behaviour: Conductor's picker (renderApp @5688200 to @5695500): a command dialog searching
 * "Search directories or type a nested path like apps/web..."; "Loading directories..." while git
 * lists them; a "Working directories" group of the top-level folders, the chosen nested ones and,
 * for a typed nested path, the folders inside its parent; "No directories found" for a search that
 * matches none and "No directories in this repository" for none at all; a folder inside a chosen
 * one is locked, with the reason as its tooltip; and "Select all", "Deselect all", Cancel and Save
 * ("Saving...") at the bottom. With sparse checkout off every top-level folder starts chosen. A
 * folder that holds an uncommitted change (any file below it in the workspace's uncommitted
 * changes, renderApp `U_n`) is marked with a warning sign, and while it is chosen it is locked with
 * "This directory has uncommitted changes. Commit or stash them before removing it."; Deselect all
 * keeps such folders unless it empties the choice, which checks out every folder (`D3o`).
 * Our design choice: a search matches any part of a folder's path, where Conductor ranks fuzzy
 * matches.
 * Must handle: git failing to list the folders or to save (a toast with the reason; the dialog stays
 * open on a failed save); a second Save while one runs (the button is off); an answer for an older
 * nested path arriving after a newer one (only the newest is shown).
 * Test first: deselecting a folder and saving sets the sparse checkout to the folders left.
 */
import type { WorkspaceId } from "@conducted/shared";
import { Command } from "cmdk";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DiffScope } from "../../../core/api.ts";
import { useActions, useChangedFiles } from "../../../core/hooks.ts";
import type { SparseCheckoutSettings } from "../../../core/model.ts";
import { Button } from "../../../ui/Button.tsx";
import {
	CheckIcon,
	CircleIcon,
	FolderIcon,
	SearchIcon,
	TriangleAlertIcon,
} from "../../../ui/icons.tsx";
import { toastError } from "../../../ui/Toast.tsx";
import { Tooltip } from "../../../ui/Tooltip.tsx";

export interface WorkingDirectoriesDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	workspaceId: WorkspaceId;
}

/** A typed path as Conductor reads it: trimmed, single slashes, no leading `./` or `/`. */
export function normalisedPath(query: string): string {
	return query
		.trim()
		.replace(/\/{2,}/g, "/")
		.replace(/^(\.?\/)+/, "");
}

/** The folder a typed nested path lists, or undefined when it names no parent. */
export function parentOf(path: string): string | undefined {
	const slash = path.lastIndexOf("/");
	return slash <= 0 ? undefined : path.slice(0, slash);
}

/** The chosen folder that holds `path`, nearest first, or undefined. */
export function chosenAncestor(path: string, chosen: ReadonlySet<string>): string | undefined {
	let slash = path.lastIndexOf("/");
	while (slash > 0) {
		const ancestor = path.slice(0, slash);
		if (chosen.has(ancestor)) return ancestor;
		slash = path.lastIndexOf("/", slash - 1);
	}
	return undefined;
}

/** Drops the chosen folders inside `path`, which choosing `path` covers. */
function dropDescendants(chosen: Set<string>, path: string): void {
	for (const entry of [...chosen]) if (entry.startsWith(`${path}/`)) chosen.delete(entry);
}

/** Every folder that holds one of `paths`, at every depth, in the order first met. */
export function changedFolders(paths: readonly string[]): Set<string> {
	const folders = new Set<string>();
	for (const path of paths) {
		let folder = "";
		for (const part of path.split("/").slice(0, -1)) {
			folder = folder === "" ? part : `${folder}/${part}`;
			folders.add(folder);
		}
	}
	return folders;
}

const UNCOMMITTED: DiffScope = { kind: "uncommitted" };
const UNCOMMITTED_LOCK =
	"This directory has uncommitted changes. Commit or stash them before removing it.";

/** A sparse-checkout line that names a folder, not a pattern. */
const isFolder = (line: string): boolean =>
	!line.startsWith("/") && !line.startsWith("!") && !line.includes("*");

/** The folders chosen when the picker opens: the sparse checkout's, else every top-level one. */
function initialChoice(settings: SparseCheckoutSettings): Set<string> {
	const folders = settings.directories.filter(isFolder);
	return new Set(folders.length > 0 ? folders : settings.topLevelDirectories);
}

const itemClass =
	"group flex h-9 cursor-default items-center gap-2 rounded-md px-2 text-sm text-fg outline-none data-[selected=true]:bg-active data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-60";

export function WorkingDirectoriesDialog({
	open,
	onOpenChange,
	workspaceId,
}: WorkingDirectoriesDialogProps) {
	const actions = useActions();
	const [settings, setSettings] = useState<SparseCheckoutSettings | null>(null);
	const [edited, setEdited] = useState<Set<string> | null>(null);
	const [query, setQuery] = useState("");
	const [selected, setSelected] = useState("");
	const [nested, setNested] = useState<{ parent: string; folders: string[] } | null>(null);
	const [saving, setSaving] = useState(false);
	const nestedRequest = useRef(0);
	const uncommitted = useChangedFiles(workspaceId, UNCOMMITTED);
	const changed = useMemo(
		() =>
			uncommitted.state === "ready"
				? changedFolders(uncommitted.data.map((file) => file.path))
				: new Set<string>(),
		[uncommitted],
	);

	useEffect(() => {
		if (!open) return;
		setSettings(null);
		setEdited(null);
		setQuery("");
		setNested(null);
		let current = true;
		void actions.git.sparseCheckoutSettings(workspaceId).then((result) => {
			if (!current) return;
			if (result.ok) setSettings(result.value);
			else toastError("Couldn't list the working directories", result.error);
		});
		return () => {
			current = false;
		};
	}, [open, actions, workspaceId]);

	const path = normalisedPath(query);
	const parent = parentOf(path);
	useEffect(() => {
		if (!open || parent === undefined) return;
		// Only the newest nested path's answer is shown.
		const request = ++nestedRequest.current;
		void actions.git.sparseCheckoutSubdirectories(workspaceId, parent).then((result) => {
			if (request !== nestedRequest.current) return;
			if (result.ok) setNested({ parent, folders: result.value });
			else toastError("Couldn't list the folders", result.error);
		});
	}, [open, actions, workspaceId, parent]);

	const chosen = useMemo(
		() => edited ?? (settings === null ? new Set<string>() : initialChoice(settings)),
		[edited, settings],
	);
	const topLevel = settings?.topLevelDirectories ?? [];
	const listed = useMemo(() => {
		const top = new Set(topLevel);
		const base = [...[...chosen].filter((entry) => !top.has(entry)).sort(), ...topLevel];
		const known = new Set(base);
		const inside =
			nested !== null && nested.parent === parent
				? nested.folders.filter((entry) => !known.has(entry))
				: [];
		const needle = path.toLowerCase();
		return [...base, ...inside].filter(
			(entry) => needle === "" || entry.toLowerCase().includes(needle),
		);
	}, [chosen, topLevel, nested, parent, path]);
	const loadingNested = parent !== undefined && nested?.parent !== parent;

	const toggle = (folder: string) => {
		const next = new Set(chosen);
		if (next.has(folder)) next.delete(folder);
		else {
			next.add(folder);
			dropDescendants(next, folder);
		}
		setEdited(next);
	};

	const allShownChosen = listed.every(
		(entry) => chosen.has(entry) || chosenAncestor(entry, chosen) !== undefined,
	);
	const selectAll = () => {
		const next = new Set(chosen);
		for (const entry of listed) {
			if (next.has(entry) || chosenAncestor(entry, next) !== undefined) continue;
			next.add(entry);
			dropDescendants(next, entry);
		}
		setEdited(next);
	};

	const afterDeselect = (() => {
		const next = new Set(chosen);
		for (const entry of listed) {
			next.delete(entry);
			const ancestor = chosenAncestor(entry, next);
			if (ancestor !== undefined) next.delete(ancestor);
		}
		// A choice left empty checks out everything, so only a smaller one keeps changed folders.
		if (next.size > 0) {
			for (const entry of chosen) if (changed.has(entry)) next.add(entry);
		}
		return next.size === chosen.size ? null : next;
	})();

	const save = async () => {
		setSaving(true);
		try {
			const saved = await actions.git.setSparseCheckoutDirectories(workspaceId, [...chosen]);
			if (!saved.ok) {
				toastError("Couldn't save the working directories", saved.error);
				return;
			}
			onOpenChange(false);
		} finally {
			setSaving(false);
		}
	};

	const body = (() => {
		if (settings === null || (listed.length === 0 && loadingNested)) {
			return <div className="py-6 text-center text-sm text-fg-muted">Loading directories...</div>;
		}
		if (listed.length === 0) {
			return (
				<p className="mx-auto max-w-xs py-6 text-center text-sm text-fg-muted">
					{query.trim() === "" ? "No directories in this repository" : "No directories found"}
				</p>
			);
		}
		return (
			<Command.Group
				heading="Working directories"
				className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-fg-muted"
			>
				{listed.map((entry) => {
					const through = chosenAncestor(entry, chosen);
					const isChosen = chosen.has(entry) || through !== undefined;
					const hasChanges = changed.has(entry);
					const locked =
						through !== undefined
							? `Included through "${through}". Deselect it to manage this directory separately.`
							: chosen.has(entry) && hasChanges
								? UNCOMMITTED_LOCK
								: undefined;
					const row = (
						<Command.Item
							key={entry}
							value={`dir-${entry}`}
							disabled={locked !== undefined}
							onSelect={() => toggle(entry)}
							className={itemClass}
						>
							{isChosen ? (
								<CheckIcon className="size-4 shrink-0" />
							) : (
								<CircleIcon className="size-4 shrink-0 text-fg-muted" />
							)}
							<span className="min-w-0 truncate text-sm">{entry}</span>
							{hasChanges ? (
								<TriangleAlertIcon
									aria-label="Uncommitted changes"
									className="ml-auto size-3.5 shrink-0 text-warning"
								/>
							) : null}
						</Command.Item>
					);
					return locked === undefined ? (
						row
					) : (
						<Tooltip key={entry} side="right" content={locked}>
							<div>{row}</div>
						</Tooltip>
					);
				})}
			</Command.Group>
		);
	})();

	return (
		<Command.Dialog
			open={open}
			onOpenChange={onOpenChange}
			label="Select working directories"
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
					placeholder="Search directories or type a nested path like apps/web..."
					className="h-11 w-full bg-transparent text-base text-fg outline-none placeholder:text-fg-muted"
				/>
			</div>
			<Command.List className="min-h-0 flex-1 overflow-y-auto p-1">{body}</Command.List>
			<div className="flex shrink-0 items-center justify-between border-t border-border px-4 py-3">
				<div className="flex gap-2">
					<Button
						variant="ghost"
						size="sm"
						disabled={allShownChosen || loadingNested}
						onClick={selectAll}
					>
						Select all
					</Button>
					<Button
						variant="ghost"
						size="sm"
						disabled={afterDeselect === null}
						onClick={() => {
							if (afterDeselect !== null) setEdited(afterDeselect);
						}}
					>
						Deselect all
					</Button>
				</div>
				<div className="flex gap-2">
					<Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button size="sm" disabled={saving || edited === null} onClick={() => void save()}>
						{saving ? "Saving..." : "Save"}
					</Button>
				</div>
			</div>
		</Command.Dialog>
	);
}

/**
 * The icon button that opens the picker, with Conductor's tooltip, in the git panel's tab strip
 * while All files is open (renderApp @4008345).
 */
export function WorkingDirectoriesButton({ workspaceId }: { workspaceId: WorkspaceId }) {
	const [open, setOpen] = useState(false);
	return (
		<>
			<Tooltip content="Select working directories">
				<Button
					variant="ghost"
					size="xs"
					aria-label="Select working directories"
					className="size-6 shrink-0 px-0 text-fg-muted"
					onClick={() => setOpen(true)}
				>
					<FolderIcon className="size-3" />
				</Button>
			</Tooltip>
			{open ? (
				<WorkingDirectoriesDialog open onOpenChange={setOpen} workspaceId={workspaceId} />
			) : null}
		</>
	);
}
