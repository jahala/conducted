/**
 * @feature REV-01 Changed folder row
 * Owns: one folder line in the folder view of the Changes list, with its name, a chevron, and the
 * total added and removed lines below it.
 * Behaviour: ui-map.md 3.6 ("Show folder hierarchy").
 * Must handle: a chain of single-child folders shown as one row ("src/features/diff"), expand and
 * collapse by click and by arrow keys, and the folder total updating as files are marked viewed.
 * Test first: a folder with two files shows the sum of their line counts.
 */
import { ChevronDownIcon, ChevronRightIcon, FolderPlusIcon } from "../../../ui/icons.tsx";

export interface ChangedFolderRowProps {
	name: string;
	depth: number;
	collapsed: boolean;
	linesAdded: number;
	linesRemoved: number;
	onToggle: () => void;
}

/** Indent is the design's 20px step; the row itself is 28px tall. */
export const changesRowIndent = 20;

export function ChangedFolderRow({
	name,
	depth,
	collapsed,
	linesAdded,
	linesRemoved,
	onToggle,
}: ChangedFolderRowProps) {
	return (
		<button
			type="button"
			aria-expanded={!collapsed}
			onClick={onToggle}
			className="flex h-7 w-full items-center gap-1.5 rounded-sm pr-2 text-left text-sm text-fg hover:bg-hover"
			style={{ paddingLeft: 8 + depth * changesRowIndent }}
		>
			<span className="text-fg-muted">
				{collapsed ? <ChevronRightIcon /> : <ChevronDownIcon />}
			</span>
			<FolderPlusIcon className="size-4 shrink-0 text-fg-muted" />
			<span className="truncate" title={name}>
				{name}
			</span>
			{linesAdded > 0 ? (
				<span className="ml-auto shrink-0 font-mono text-xs text-git-added">+{linesAdded}</span>
			) : null}
			{linesRemoved > 0 ? (
				<span className="shrink-0 font-mono text-xs text-git-removed">-{linesRemoved}</span>
			) : null}
		</button>
	);
}
