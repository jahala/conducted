/**
 * @feature REV-01 Changed file list
 * Owns: the virtualised list of changed files, in flat or folder form. It renders rows and folder
 * rows from the model built by changed-file-tree.ts and tracks which row is selected.
 * Behaviour: ui-map.md 3.6, Changes paragraph (status, +/- lines, Viewed checkbox, conflict badge).
 * Must handle: thousands of files (windowed rendering), a selection that survives list updates
 * while the same path exists, keyboard selection with arrows, folders collapsing and expanding
 * (state kept per workspace), and focus returning to the list after a row menu closes.
 * Test first: with 5,000 files only the visible window of rows is in the DOM.
 */
import { useEffect, useRef, useState } from "react";
import { ChangedFileRow } from "./ChangedFileRow.tsx";
import { ChangedFolderRow } from "./ChangedFolderRow.tsx";
import type { ChangedTreeNode } from "./changed-file-tree.ts";

/** One row is 28px tall, as the design's changes row is. */
export const CHANGED_FILE_ROW_HEIGHT = 28;
/** Rows drawn above and below the viewport, so a fast scroll never shows a blank strip. */
const OVERSCAN_ROWS = 8;
/** jsdom has no layout, so a list mounted there draws this many pixels of rows. */
const FALLBACK_VIEWPORT_HEIGHT = 560;

export interface ChangedFileListProps {
	nodes: ChangedTreeNode[];
	selectedPath: string | null;
	onSelect: (path: string) => void;
	onOpen: (path: string) => void;
	onToggleViewed: (path: string, viewed: boolean) => void;
	onToggleFolder: (folderPath: string) => void;
	collapsedFolders: ReadonlySet<string>;
	onDiscard?: (path: string) => void;
	onCopyPath?: (path: string, kind: "absolute" | "relative") => void;
}

const filePaths = (nodes: readonly ChangedTreeNode[]): string[] =>
	nodes.flatMap((node) => (node.kind === "file" ? [node.file.path] : []));

export function ChangedFileList({
	nodes,
	selectedPath,
	onSelect,
	onOpen,
	onToggleViewed,
	onToggleFolder,
	collapsedFolders,
	onDiscard,
	onCopyPath,
}: ChangedFileListProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const [scrollTop, setScrollTop] = useState(0);
	const [viewportHeight, setViewportHeight] = useState(FALLBACK_VIEWPORT_HEIGHT);

	useEffect(() => {
		const element = containerRef.current;
		if (element === null) return;
		const measure = () => {
			setViewportHeight(element.clientHeight > 0 ? element.clientHeight : FALLBACK_VIEWPORT_HEIGHT);
		};
		measure();
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, []);

	const firstIndex = Math.max(0, Math.floor(scrollTop / CHANGED_FILE_ROW_HEIGHT) - OVERSCAN_ROWS);
	const lastIndex = Math.min(
		nodes.length,
		Math.ceil((scrollTop + viewportHeight) / CHANGED_FILE_ROW_HEIGHT) + OVERSCAN_ROWS,
	);
	const visible = nodes.slice(firstIndex, lastIndex);

	const openFromRow = (path: string) => {
		onSelect(path);
		onOpen(path);
	};

	const moveSelection = (delta: number) => {
		const paths = filePaths(nodes);
		if (paths.length === 0) return;
		const current = selectedPath === null ? -1 : paths.indexOf(selectedPath);
		const next =
			current < 0
				? delta > 0
					? 0
					: paths.length - 1
				: Math.min(paths.length - 1, Math.max(0, current + delta));
		const path = paths[next];
		if (path !== undefined) onSelect(path);
	};

	return (
		// biome-ignore lint/a11y/useSemanticElements: the list is virtualised; its rows are placed by script.
		<div
			ref={containerRef}
			role="grid"
			aria-label="Changed files"
			tabIndex={0}
			className="relative h-full overflow-y-auto outline-none"
			onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
			onKeyDown={(event) => {
				if (event.key === "ArrowDown") {
					event.preventDefault();
					moveSelection(1);
				} else if (event.key === "ArrowUp") {
					event.preventDefault();
					moveSelection(-1);
				} else if (event.key === "Enter" && selectedPath !== null) {
					event.preventDefault();
					onOpen(selectedPath);
				}
			}}
		>
			<div style={{ height: nodes.length * CHANGED_FILE_ROW_HEIGHT, position: "relative" }}>
				{visible.map((node, offset) => {
					const index = firstIndex + offset;
					const style = {
						position: "absolute" as const,
						top: index * CHANGED_FILE_ROW_HEIGHT,
						left: 0,
						right: 0,
						height: CHANGED_FILE_ROW_HEIGHT,
					};
					if (node.kind === "folder") {
						return (
							<div key={`folder:${node.path}`} style={style}>
								<ChangedFolderRow
									name={node.path}
									depth={node.depth}
									collapsed={collapsedFolders.has(node.path)}
									linesAdded={node.linesAdded}
									linesRemoved={node.linesRemoved}
									onToggle={() => onToggleFolder(node.path)}
								/>
							</div>
						);
					}
					const path = node.file.path;
					return (
						<div key={`file:${path}`} style={style}>
							<ChangedFileRow
								file={node.file}
								depth={node.depth}
								selected={path === selectedPath}
								onOpen={() => openFromRow(path)}
								onToggleViewed={(viewed) => onToggleViewed(path, viewed)}
								onDiscard={onDiscard === undefined ? undefined : () => onDiscard(path)}
								onCopyPath={onCopyPath === undefined ? undefined : (kind) => onCopyPath(path, kind)}
							/>
						</div>
					);
				})}
			</div>
		</div>
	);
}
