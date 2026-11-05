/**
 * @feature REV-01 Changed file row
 * Owns: one file in the Changes list. File icon, name and folder, status letter, added and removed
 * line counts, a conflict badge, and the optional Viewed checkbox.
 * Behaviour: ui-map.md 3.6, Changes paragraph. Row menu: "Copy path", "Copy relative path",
 * "Discard changes".
 * Must handle: renamed files (show old path and new path), binary files (no line counts, a
 * "binary" tag), conflicted files, a deleted file (no preview), a long path (middle truncation
 * from TruncatedText), discard asking for confirmation because it cannot be undone, and the
 * optional Viewed checkbox (shown only when the parent passes onToggleViewed) not opening the
 * file.
 * Test first: clicking the Viewed checkbox calls onToggleViewed and does not call onOpen.
 */
import { useState } from "react";
import type { ChangedFile } from "../../../core/api.ts";
import { Badge } from "../../../ui/Badge.tsx";
import { Button } from "../../../ui/Button.tsx";
import { Checkbox } from "../../../ui/Checkbox.tsx";
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from "../../../ui/ContextMenu.tsx";
import { Dialog, DialogContent, DialogFooter } from "../../../ui/Dialog.tsx";
import { FileTextIcon } from "../../../ui/icons.tsx";
import { truncateMiddle } from "../../../ui/TruncatedText.tsx";
import { changesRowIndent } from "./ChangedFolderRow.tsx";

const statusLetter: Record<ChangedFile["status"], string> = {
	added: "A",
	modified: "M",
	deleted: "D",
	renamed: "R",
	copied: "C",
};

const statusClass: Record<ChangedFile["status"], string> = {
	added: "text-git-added",
	modified: "text-fg-muted",
	deleted: "text-git-removed",
	renamed: "text-info",
	copied: "text-info",
};

function splitPath(path: string): { folder: string; name: string } {
	const at = path.lastIndexOf("/");
	return at < 0
		? { folder: "", name: path }
		: { folder: path.slice(0, at), name: path.slice(at + 1) };
}

export interface ChangedFileRowProps {
	file: ChangedFile;
	/** Indent level in folder view, 0 in flat view. */
	depth: number;
	selected: boolean;
	onOpen: () => void;
	/** When absent the row shows no Viewed checkbox (REV-02 owns the store). */
	onToggleViewed?: (viewed: boolean) => void;
	/** When absent the row menu leaves the discard item out. */
	onDiscard?: () => void;
	onCopyPath?: (kind: "absolute" | "relative") => void;
}

export function ChangedFileRow({
	file,
	depth,
	selected,
	onOpen,
	onToggleViewed,
	onDiscard,
	onCopyPath,
}: ChangedFileRowProps) {
	const [confirmDiscard, setConfirmDiscard] = useState(false);
	const { folder, name } = splitPath(file.path);
	const hasMenu = onDiscard !== undefined || onCopyPath !== undefined;

	const label = (
		<>
			<FileTextIcon className="size-4 shrink-0 text-fg-muted" />
			<span className="min-w-0 flex-1 truncate" title={file.path}>
				{folder.length > 0 ? <span className="text-fg-muted">{folder}/</span> : null}
				<span className="text-fg">{truncateMiddle(name, 42)}</span>
			</span>
			{file.oldPath !== undefined ? (
				<span className="min-w-0 max-w-40 truncate text-xs text-fg-subtle" title={file.oldPath}>
					from {file.oldPath}
				</span>
			) : null}
			{file.conflicted ? <Badge tone="danger">Conflict</Badge> : null}
			{file.binary ? <Badge tone="neutral">binary</Badge> : null}
		</>
	);

	const openButton = (
		<button
			type="button"
			aria-label={`Open ${file.path}`}
			onClick={onOpen}
			className="flex min-w-0 flex-1 items-center gap-2 rounded-sm text-left focus-visible:outline-none"
		>
			{label}
		</button>
	);

	return (
		// biome-ignore lint/a11y/useSemanticElements: the row is placed by the virtualised grid, not a <table>.
		<div
			role="row"
			aria-selected={selected}
			tabIndex={-1}
			className={`flex h-7 items-center gap-2 rounded-sm pr-2 text-sm ${
				selected ? "bg-active" : "hover:bg-hover"
			}`}
			style={{ paddingLeft: 8 + depth * changesRowIndent }}
		>
			{onToggleViewed !== undefined ? (
				<Checkbox
					size="sm"
					checked={file.viewed}
					aria-label={`Viewed ${file.path}`}
					onCheckedChange={(viewed) => onToggleViewed(viewed)}
				/>
			) : null}
			{hasMenu ? (
				<ContextMenu
					items={
						<>
							{onCopyPath !== undefined ? (
								<>
									<ContextMenuItem onSelect={() => onCopyPath("absolute")}>
										Copy path
									</ContextMenuItem>
									<ContextMenuItem onSelect={() => onCopyPath("relative")}>
										Copy relative path
									</ContextMenuItem>
									<ContextMenuSeparator />
								</>
							) : null}
							{onDiscard !== undefined ? (
								<ContextMenuItem destructive onSelect={() => setConfirmDiscard(true)}>
									Discard changes
								</ContextMenuItem>
							) : null}
						</>
					}
				>
					{openButton}
				</ContextMenu>
			) : (
				openButton
			)}
			<span
				className={`w-3 shrink-0 text-center font-mono text-xs ${statusClass[file.status]}`}
				title={file.status}
			>
				<span className="sr-only">{file.status}</span>
				{statusLetter[file.status]}
			</span>
			{file.binary ? null : (
				<span className="flex shrink-0 items-center gap-1.5 font-mono text-xs">
					<span className="text-git-added">+{file.linesAdded}</span>
					<span className="text-git-removed">-{file.linesRemoved}</span>
				</span>
			)}

			<Dialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
				<DialogContent title="Discard changes?" size="md">
					<p className="text-sm text-fg-muted">
						This puts {file.path} back to the target branch. It cannot be undone.
					</p>
					<DialogFooter>
						<Button variant="outline" onClick={() => setConfirmDiscard(false)}>
							Cancel
						</Button>
						<Button
							variant="destructive"
							onClick={() => {
								setConfirmDiscard(false);
								onDiscard?.();
							}}
						>
							Discard
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
