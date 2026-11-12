/**
 * @feature REV-01 Changed file row
 * Owns: one file in the Changes list. Name and folder, then at the right Conductor's cluster (renderApp,
 * the changes row): "U" when the file also has uncommitted changes, the added and removed line
 * counts, and the status as a coloured square (plus for added, dot for modified, minus for deleted,
 * arrow for renamed). A conflict badge and the optional Viewed checkbox.
 * Behaviour: ui-map.md 3.6, Changes paragraph. Row menu: "Copy path", "Copy relative path",
 * "Discard changes", from the file row menu the All files tab shares (files/FileRowMenu.tsx).
 * Must handle: renamed files (show old path and new path), binary files (no line counts, a
 * "binary" tag), conflicted files, a long path (middle truncation
 * from TruncatedText), discard asking for confirmation because it cannot be undone, and the
 * optional Viewed checkbox (shown only when the parent passes onToggleViewed) not opening the
 * file.
 * Test first: clicking the Viewed checkbox calls onToggleViewed and does not call onOpen.
 */
import type { ComponentType, SVGProps } from "react";
import type { ChangedFile } from "../../../core/api.ts";
import { Badge } from "../../../ui/Badge.tsx";
import { Checkbox } from "../../../ui/Checkbox.tsx";
import {
	SquareArrowRightIcon,
	SquareDotIcon,
	SquareMinusIcon,
	SquarePlusIcon,
} from "../../../ui/icons.tsx";
import { truncateMiddle } from "../../../ui/TruncatedText.tsx";
import { FileRowMenu } from "../files/FileRowMenu.tsx";
import { changesRowIndent } from "./ChangedFolderRow.tsx";

/** Conductor's file status marks (renderApp, the changes row's status icon): a coloured square. */
const statusMark: Record<
	ChangedFile["status"],
	{ Icon: ComponentType<SVGProps<SVGSVGElement>>; colour: string }
> = {
	added: { Icon: SquarePlusIcon, colour: "text-git-added" },
	modified: { Icon: SquareDotIcon, colour: "text-git-modified" },
	deleted: { Icon: SquareMinusIcon, colour: "text-git-removed" },
	renamed: { Icon: SquareArrowRightIcon, colour: "text-info" },
	copied: { Icon: SquareArrowRightIcon, colour: "text-info" },
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
	/** The file also has changes not committed yet; Conductor marks it "U". */
	uncommitted?: boolean;
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
	uncommitted = false,
	onOpen,
	onToggleViewed,
	onDiscard,
	onCopyPath,
}: ChangedFileRowProps) {
	const { folder, name } = splitPath(file.path);
	const mark = statusMark[file.status];
	const hasMenu = onDiscard !== undefined || onCopyPath !== undefined;

	const label = (
		<>
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
			className={`mx-2 flex h-7 items-center gap-1.5 rounded-md pr-3 text-sm ${
				selected ? "bg-active" : "hover:bg-hover"
			}`}
			style={{ paddingLeft: 12 + depth * changesRowIndent }}
		>
			{onToggleViewed !== undefined ? (
				<span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-fg-muted">
					<Checkbox
						size="sm"
						checked={file.viewed}
						aria-label={`Viewed ${file.path}`}
						onCheckedChange={(viewed) => onToggleViewed(viewed)}
					/>
					Viewed
				</span>
			) : null}
			{hasMenu ? (
				<FileRowMenu
					path={file.path}
					isDirectory={false}
					changed
					hasActiveChat={false}
					onCopyPath={onCopyPath}
					onDiscard={onDiscard}
				>
					{openButton}
				</FileRowMenu>
			) : (
				openButton
			)}
			{uncommitted ? (
				<span className="shrink-0 text-xs font-medium text-fg" title="Uncommitted">
					U
				</span>
			) : null}
			{file.binary || (file.linesAdded === 0 && file.linesRemoved === 0) ? null : (
				<span className="flex shrink-0 items-center gap-1 font-mono text-2xs">
					{file.linesAdded > 0 ? <span className="text-git-added">+{file.linesAdded}</span> : null}
					{file.linesRemoved > 0 ? (
						<span className="text-git-removed">-{file.linesRemoved}</span>
					) : null}
				</span>
			)}
			<span className={`flex shrink-0 ${mark.colour}`} title={file.status}>
				<span className="sr-only">{file.status}</span>
				<mark.Icon className="size-3" />
			</span>
		</div>
	);
}
