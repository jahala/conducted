/**
 * @feature REV-06 File tree row
 * Owns: one row of the file tree. Indent, chevron for folders, a file icon by type, name, and a
 * change marker when the file differs from the target branch.
 * Behaviour: ui-map.md 3.6 ("file tree with Material file icons, virtualised"). Row height is 28px
 * with 20px indent per level (ui-dimensions.md 4).
 * Our design choice: hand-drawn file-type icons instead of a third-party set, following APP-05's
 * approach and keeping every asset ours (D002).
 * Must handle: a long name (middle truncation keeps the extension visible), keyboard focus, a
 * double-click or Enter opening the file, a right-click opening the row menu, a folder toggling
 * from its chevron, and a changed file showing the marker (the parent also marks a folder that
 * holds one).
 * Test first: a changed file row renders the change marker, an unchanged one does not.
 */
import type { ReactNode } from "react";
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

type FileKind =
	| "code"
	| "data"
	| "document"
	| "image"
	| "style"
	| "web"
	| "shell"
	| "lock"
	| "file";

const EXTENSIONS: Readonly<Record<string, FileKind>> = {
	ts: "code",
	tsx: "code",
	js: "code",
	jsx: "code",
	mjs: "code",
	cjs: "code",
	py: "code",
	rs: "code",
	go: "code",
	java: "code",
	rb: "code",
	php: "code",
	c: "code",
	h: "code",
	cpp: "code",
	cs: "code",
	swift: "code",
	kt: "code",
	json: "data",
	jsonc: "data",
	yaml: "data",
	yml: "data",
	toml: "data",
	csv: "data",
	md: "document",
	markdown: "document",
	mdx: "document",
	txt: "document",
	pdf: "document",
	png: "image",
	jpg: "image",
	jpeg: "image",
	gif: "image",
	webp: "image",
	svg: "image",
	ico: "image",
	css: "style",
	scss: "style",
	less: "style",
	html: "web",
	htm: "web",
	sh: "shell",
	bash: "shell",
	zsh: "shell",
	fish: "shell",
	lock: "lock",
};

const kindOf = (name: string): FileKind => {
	const lower = name.toLowerCase();
	if (lower === "dockerfile" || lower === "makefile") return "shell";
	const dot = lower.lastIndexOf(".");
	if (dot <= 0 || dot === lower.length - 1) return "file";
	return EXTENSIONS[lower.slice(dot + 1)] ?? "file";
};

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

function FileTypeIcon({ kind }: { kind: FileKind }) {
	switch (kind) {
		case "code":
			return (
				<TypeSvg>
					<path d="M5.5 5L3 8l2.5 3M10.5 5L13 8l-2.5 3M9 3.5L7 12.5" />
				</TypeSvg>
			);
		case "data":
			return (
				<TypeSvg>
					<path d="M3 4.5h10M3 8h10M3 11.5h10M5.5 2.5v11M10.5 2.5v11" />
				</TypeSvg>
			);
		case "document":
			return (
				<TypeSvg>
					<path d="M4 2.5h5l3 3v8H4zM9 2.5v3h3M6 8h4M6 10.5h4" />
				</TypeSvg>
			);
		case "image":
			return (
				<TypeSvg>
					<path d="M2.5 3.5h11v9h-11zM5.5 7a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM2.5 10l3-3 2.5 2.5L10.5 7l3 3" />
				</TypeSvg>
			);
		case "style":
			return (
				<TypeSvg>
					<path d="M3 3.5h10M4.5 3.5v9M8 3.5v5M11.5 3.5v9" />
				</TypeSvg>
			);
		case "web":
			return (
				<TypeSvg>
					<path d="M8 13.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11zM2.5 8h11M8 2.5c2 2 2 9 0 11M8 2.5c-2 2-2 9 0 11" />
				</TypeSvg>
			);
		case "shell":
			return (
				<TypeSvg>
					<path d="M2.5 3.5h11v9h-11zM5 6.5l2 1.5-2 1.5M8.5 10h2.5" />
				</TypeSvg>
			);
		case "lock":
			return (
				<TypeSvg>
					<path d="M4.5 7V5.5a3.5 3.5 0 0 1 7 0V7M3.5 7h9v6h-9z" />
				</TypeSvg>
			);
		default:
			return (
				<TypeSvg>
					<path d="M4 2.5h5l3 3v8H4zM9 2.5v3h3" />
				</TypeSvg>
			);
	}
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
	const kind = kindOf(name);
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
			onDoubleClick={() => {
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
			<span
				className="shrink-0 text-fg-muted"
				data-file-icon
				data-kind={isDirectory ? "folder" : kind}
			>
				{isDirectory ? <FolderTypeIcon /> : <FileTypeIcon kind={kind} />}
			</span>
			<span className="min-w-0 flex-1 truncate">{displayName(name)}</span>
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
