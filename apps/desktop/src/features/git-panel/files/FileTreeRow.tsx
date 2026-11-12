/**
 * @feature REV-06 File tree row
 * Owns: one row of the file tree. Indent, chevron for folders, a file icon by type, name, and a
 * change marker when the file differs from the target branch.
 * Behaviour: ui-map.md 3.6 ("file tree with Material file icons, virtualised"). Row height is 28px
 * with 20px indent per level (ui-dimensions.md 4). The file's icon comes from APP-05's rule
 * (`ui/file-icon.tsx`), given the bare name as Conductor's tree gives it: a tinted brand glyph for
 * a kind in Conductor's table, else the Material Icon Theme's icon; a folder keeps a plain folder glyph.
 * Measured from Conductor 0.92.1 (renderApp @2530991): one click on a row opens a file (in its
 * whole-file view) or toggles a folder; the row of the file open in the centre is filled; names are
 * 12px monospace.
 * Must handle: a long name (middle truncation keeps the extension visible), keyboard focus, a
 * click or Enter opening the file, a right-click opening the row menu, a folder toggling
 * from its chevron (once, not again through the row), and a changed file showing the marker (the
 * parent also marks a folder that holds one).
 * Test first: a changed file row renders the change marker, an unchanged one does not.
 */
import type { ReactNode } from "react";
import { FileTypeIcon } from "../../../ui/file-icon.tsx";
import { ChevronDownIcon, ChevronRightIcon } from "../../../ui/icons.tsx";
import { FileRowMenu } from "./FileRowMenu.tsx";

export interface FileTreeRowProps {
	name: string;
	path: string;
	depth: number;
	isDirectory: boolean;
	expanded: boolean;
	selected: boolean;
	changed: boolean;
	onToggle: () => void;
	onOpen: () => void;
	onView?: () => void;
	onAttachInChat?: () => void;
	onCopyPath?: (kind: "absolute" | "relative") => void;
	onDiscard?: () => void;
	hasActiveChat?: boolean;
	archived?: boolean;
}

function TypeSvg({ children }: { children: ReactNode }) {
	return (
		<svg
			viewBox="0 0 16 16"
			width={16}
			height={16}
			fill="none"
			stroke="currentColor"
			strokeWidth={1.5}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			{children}
		</svg>
	);
}

function FolderTypeIcon() {
	return (
		<TypeSvg>
			<path d="M2 4.5h4l1.5 1.5H14v6.5H2z" />
		</TypeSvg>
	);
}

/** Middle truncation, so a long name keeps its extension visible. */
function displayName(name: string): string {
	if (name.length <= 34) return name;
	const dot = name.lastIndexOf(".");
	const extension = dot > 0 ? name.slice(dot) : "";
	const stem = extension.length > 0 ? name.slice(0, dot) : name;
	const keep = Math.max(6, 32 - extension.length);
	return `${stem.slice(0, keep)}…${extension}`;
}

export function FileTreeRow({
	name,
	path,
	depth,
	isDirectory,
	expanded,
	selected,
	changed,
	onToggle,
	onOpen,
	onView,
	onAttachInChat,
	onCopyPath,
	onDiscard,
	hasActiveChat = false,
	archived = false,
}: FileTreeRowProps) {
	const hasMenu =
		onView !== undefined ||
		onAttachInChat !== undefined ||
		onCopyPath !== undefined ||
		onDiscard !== undefined;

	const row = (
		<div
			role="treeitem"
			aria-selected={selected}
			aria-expanded={isDirectory ? expanded : undefined}
			tabIndex={-1}
			title={path}
			data-path={path}
			className={`flex h-7 items-center gap-1.5 rounded-sm pr-2 text-sm ${
				selected ? "bg-active text-fg" : "text-fg hover:bg-hover"
			}`}
			style={{ paddingLeft: 4 + depth * 20 }}
			onClick={() => {
				if (isDirectory) onToggle();
				else onOpen();
			}}
			onKeyDown={(event) => {
				if (event.key !== "Enter" && event.key !== " ") return;
				event.preventDefault();
				if (isDirectory) onToggle();
				else onOpen();
			}}
		>
			{isDirectory ? (
				<button
					type="button"
					aria-label={expanded ? `Collapse ${name}` : `Expand ${name}`}
					className="flex size-4 shrink-0 items-center justify-center rounded-sm text-fg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
					onClick={(event) => {
						event.stopPropagation();
						onToggle();
					}}
				>
					{expanded ? (
						<ChevronDownIcon className="size-4" />
					) : (
						<ChevronRightIcon className="size-4" />
					)}
				</button>
			) : (
				<span className="size-4 shrink-0" />
			)}
			<span className="shrink-0 text-fg-muted" data-file-icon={isDirectory ? "folder" : undefined}>
				{isDirectory ? <FolderTypeIcon /> : <FileTypeIcon path={name} className="size-3.5" />}
			</span>
			<span className="min-w-0 flex-1 truncate font-mono text-xs">{displayName(name)}</span>
			{changed ? (
				<span
					role="img"
					aria-label="Changed"
					title="Changed from the target branch"
					className="size-1.5 shrink-0 rounded-full bg-accent"
				/>
			) : null}
		</div>
	);

	if (!hasMenu) return row;
	return (
		<FileRowMenu
			path={path}
			isDirectory={isDirectory}
			changed={changed}
			hasActiveChat={hasActiveChat}
			archived={archived}
			onView={onView}
			onAttachInChat={onAttachInChat}
			onCopyPath={onCopyPath}
			onDiscard={onDiscard}
		>
			{row}
		</FileRowMenu>
	);
}
