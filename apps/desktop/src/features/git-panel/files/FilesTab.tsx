/**
 * @feature REV-06 All files tab
 * Owns: the All files tab body. A filter box over a virtualised tree of every file in the
 * workspace, with a row menu.
 * Behaviour: ui-map.md 3.6, "All files" paragraph. Quick open (Cmd+P) and search in files
 * (Cmd+Shift+F) are separate dialogs owned by the palette feature (REV-07).
 * Data: useFileTree(workspaceId), useChangedFiles(workspaceId, branch),
 * useActions().git.discardFile and Actions.files.attachToChat.
 * Children: FileTreeRow, FileRowMenu, files/file-tree-model.ts.
 * Must handle: loading and error states, an empty repository, thousands of files (windowed
 * rendering, folders expanded one level at a time), the tree changing underneath the user (keep
 * expanded folders and selection), a filter with no match, gitignored files (hidden, as the file
 * search does), and an archived workspace (the worktree is gone: say so, do not list, and do not
 * poll the tree: the tree query only mounts for a workspace that is not archived).
 * Our design choice: the platform lists the whole tree in one call; this tab starts at depth 1 and
 * expands from the list it already holds.
 * Test first: with entries ["src/a.ts", "README.md"] and the filter "read", only README.md shows.
 */
import { appError, type WorkspaceId } from "@conducted/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import {
	useActions,
	useChangedFiles,
	useFileTree,
	useSessions,
	useWorkspace,
} from "../../../core/hooks.ts";
import { EmptyState } from "../../../ui/EmptyState.tsx";
import { Input } from "../../../ui/Input.tsx";
import { LoadableView } from "../../../ui/LoadableView.tsx";
import { Skeleton } from "../../../ui/Skeleton.tsx";
import { toastError } from "../../../ui/Toast.tsx";
import { FileTreeRow } from "./FileTreeRow.tsx";
import { buildFileTreeRows, type FileTreeRowModel } from "./file-tree-model.ts";

export interface FilesTabProps {
	workspaceId: WorkspaceId;
	/** Opens the file in a file tab in edit or view mode. */
	onOpenFile: (path: string) => void;
	/** The file open in the centre, if any: its row is selected and its folders opened. */
	openPath?: string | null;
}

/** One row is 28px tall, as the design's file tree row is. */
const FILE_TREE_ROW_HEIGHT = 28;
/** Rows drawn above and below the viewport, so a fast scroll never shows a blank strip. */
const OVERSCAN_ROWS = 8;
/** jsdom has no layout, so a list mounted there draws this many pixels of rows. */
const FALLBACK_VIEWPORT_HEIGHT = 560;
const NO_FOLDERS: ReadonlySet<string> = new Set();

function LoadingRows() {
	return (
		<div role="status" aria-label="Loading files" className="space-y-1 p-2">
			{["a", "b", "c", "d", "e"].map((key) => (
				<Skeleton key={key} className="h-7 w-full" />
			))}
		</div>
	);
}

interface FileTreeBodyProps {
	rows: readonly FileTreeRowModel[];
	selectedPath: string | null;
	onSelect: (path: string) => void;
	onToggle: (path: string) => void;
	onOpen: (path: string) => void;
	onView: (path: string) => void;
	onAttachInChat: (path: string) => void;
	onCopyPath: (path: string, kind: "absolute" | "relative") => void;
	onDiscard: (path: string) => void;
	hasActiveChat: boolean;
	changedFiles: ReadonlySet<string>;
	changedFolders: ReadonlySet<string>;
}

function FileTreeBody({
	rows,
	selectedPath,
	onSelect,
	onToggle,
	onOpen,
	onView,
	onAttachInChat,
	onCopyPath,
	onDiscard,
	hasActiveChat,
	changedFiles,
	changedFolders,
}: FileTreeBodyProps) {
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

	const firstIndex = Math.max(0, Math.floor(scrollTop / FILE_TREE_ROW_HEIGHT) - OVERSCAN_ROWS);
	const lastIndex = Math.min(
		rows.length,
		Math.ceil((scrollTop + viewportHeight) / FILE_TREE_ROW_HEIGHT) + OVERSCAN_ROWS,
	);
	const visible = rows.slice(firstIndex, lastIndex);

	const scrollRowIntoView = (path: string) => {
		const element = containerRef.current;
		if (element === null) return;
		const index = rows.findIndex((row) => row.path === path);
		if (index < 0) return;
		const top = index * FILE_TREE_ROW_HEIGHT;
		const bottom = top + FILE_TREE_ROW_HEIGHT;
		let next = element.scrollTop;
		if (top < next) next = top;
		else if (bottom > next + viewportHeight) next = bottom - viewportHeight;
		if (next === element.scrollTop) return;
		element.scrollTop = next;
		setScrollTop(next);
	};

	const moveSelection = (delta: number) => {
		if (rows.length === 0) return;
		const current = selectedPath === null ? -1 : rows.findIndex((row) => row.path === selectedPath);
		const next =
			current < 0
				? delta > 0
					? 0
					: rows.length - 1
				: Math.min(rows.length - 1, Math.max(0, current + delta));
		const row = rows[next];
		if (row === undefined) return;
		onSelect(row.path);
		scrollRowIntoView(row.path);
	};

	const selectedRow = rows.find((row) => row.path === selectedPath) ?? null;

	return (
		<div
			ref={containerRef}
			role="tree"
			aria-label="Workspace files"
			tabIndex={0}
			className="relative h-full overflow-y-auto outline-none focus-visible:ring-1 focus-visible:ring-focus"
			onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
			onKeyDown={(event) => {
				if (event.key === "ArrowDown") {
					event.preventDefault();
					moveSelection(1);
				} else if (event.key === "ArrowUp") {
					event.preventDefault();
					moveSelection(-1);
				} else if (event.key === "Enter" && selectedRow !== null) {
					event.preventDefault();
					if (selectedRow.isDirectory) onToggle(selectedRow.path);
					else onOpen(selectedRow.path);
				}
			}}
		>
			<div style={{ height: rows.length * FILE_TREE_ROW_HEIGHT, position: "relative" }}>
				{visible.map((row, offset) => {
					const index = firstIndex + offset;
					return (
						<div
							key={`${row.isDirectory ? "folder" : "file"}:${row.path}`}
							style={{
								position: "absolute",
								top: index * FILE_TREE_ROW_HEIGHT,
								left: 0,
								right: 0,
								height: FILE_TREE_ROW_HEIGHT,
							}}
						>
							<FileTreeRow
								name={row.name}
								path={row.path}
								depth={row.depth}
								isDirectory={row.isDirectory}
								expanded={row.expanded}
								selected={row.path === selectedPath}
								changed={
									changedFiles.has(row.path) || (row.isDirectory && changedFolders.has(row.path))
								}
								onToggle={() => onToggle(row.path)}
								onOpen={() => onOpen(row.path)}
								onView={() => onView(row.path)}
								onAttachInChat={() => onAttachInChat(row.path)}
								onCopyPath={(kind) => onCopyPath(row.path, kind)}
								onDiscard={() => onDiscard(row.path)}
								hasActiveChat={hasActiveChat}
							/>
						</div>
					);
				})}
			</div>
		</div>
	);
}

const joinRoot = (root: string, path: string): string => `${root.replace(/\/+$/, "")}/${path}`;

export function FilesTab({ workspaceId, onOpenFile, openPath = null }: FilesTabProps) {
	const workspace = useWorkspace(workspaceId);
	if (workspace.state === "ready" && workspace.data.state === "archived") {
		return (
			<EmptyState
				compact
				title="This workspace is archived"
				body="Restore the workspace to see its files."
			/>
		);
	}
	const workspacePath = workspace.state === "ready" ? workspace.data.path : null;
	const activeSessionId = workspace.state === "ready" ? workspace.data.activeSessionId : null;
	return (
		<LiveFilesTab
			workspaceId={workspaceId}
			workspacePath={workspacePath}
			activeSessionId={activeSessionId}
			onOpenFile={onOpenFile}
			openPath={openPath}
		/>
	);
}

/** The tab for a workspace whose folder exists. Only this part reads and polls the tree. */
function LiveFilesTab({
	workspaceId,
	workspacePath,
	activeSessionId,
	onOpenFile,
	openPath = null,
}: FilesTabProps & { workspacePath: string | null; activeSessionId: string | null }) {
	const tree = useFileTree(workspaceId);
	const sessions = useSessions(workspaceId);
	const changes = useChangedFiles(workspaceId, { kind: "branch" });
	const actions = useActions();

	const [filter, setFilter] = useState("");
	const [expanded, setExpanded] = useState<ReadonlySet<string>>(NO_FOLDERS);
	const [selectedPath, setSelectedPath] = useState<string | null>(openPath);

	// The file open in the centre is the selected row, with its folders opened, as in Conductor.
	useEffect(() => {
		if (openPath === null) return;
		setSelectedPath(openPath);
		setExpanded((current) => {
			const folders = openPath.split("/").slice(0, -1);
			const next = new Set(current);
			let prefix = "";
			for (const folder of folders) {
				prefix = prefix === "" ? folder : `${prefix}/${folder}`;
				next.add(prefix);
			}
			return next.size === current.size ? current : next;
		});
	}, [openPath]);

	const entries = tree.state === "ready" ? tree.data : [];
	const changedList = changes.state === "ready" ? changes.data : [];
	const changedFiles = useMemo(() => new Set(changedList.map((file) => file.path)), [changedList]);
	const changedFolders = useMemo(() => {
		const folders = new Set<string>();
		for (const file of changedList) {
			const parts = file.path.split("/");
			parts.pop();
			let current = "";
			for (const part of parts) {
				current = current.length === 0 ? part : `${current}/${part}`;
				folders.add(current);
			}
		}
		return folders;
	}, [changedList]);
	const rows = useMemo(
		() => buildFileTreeRows(entries, expanded, filter),
		[entries, expanded, filter],
	);

	const selected =
		selectedPath !== null && rows.some((row) => row.path === selectedPath) ? selectedPath : null;
	const hasActiveChat =
		activeSessionId !== null &&
		sessions.state === "ready" &&
		sessions.data.some((session) => session.id === activeSessionId && session.closedAt === null);

	const toggleFolder = (path: string) => {
		setExpanded((current) => {
			const next = new Set(current);
			if (next.has(path)) next.delete(path);
			else next.add(path);
			return next;
		});
	};

	const openFile = (path: string) => {
		setSelectedPath(path);
		onOpenFile(path);
	};

	const copyPath = (path: string, kind: "absolute" | "relative") => {
		const text =
			kind === "relative" ? path : workspacePath === null ? null : joinRoot(workspacePath, path);
		if (text === null) {
			toastError(
				"Couldn't copy the path",
				appError("workspace_unknown", "The workspace is not loaded yet."),
			);
			return;
		}
		void actions.app.copyText(text).then((result) => {
			if (!result.ok) toastError("Couldn't copy the path", result.error);
		});
	};

	const attachInChat = (path: string) => {
		if (workspacePath === null) {
			toastError(
				"Couldn't attach the file to the chat",
				appError("workspace_unknown", "The workspace is not loaded yet."),
			);
			return;
		}
		void actions.files.attachToChat(workspaceId, [joinRoot(workspacePath, path)]).then((result) => {
			if (!result.ok) toastError("Couldn't attach the file to the chat", result.error);
		});
	};

	const discard = (path: string) => {
		void actions.git.discardFile(workspaceId, path).then((result) => {
			if (!result.ok) toastError("Couldn't discard the changes", result.error);
		});
	};

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="shrink-0 px-2 py-2">
				<Input
					aria-label="Filter files"
					placeholder="Filter files"
					value={filter}
					onChange={(event) => setFilter(event.target.value)}
					className="w-full"
				/>
			</div>
			<LoadableView
				value={tree}
				loadingLabel="Loading files"
				loading={<LoadingRows />}
				errorTitle="Couldn't load the files"
				compact
			>
				{(data) => {
					if (data.length === 0) {
						return (
							<EmptyState
								compact
								title="No files"
								body="Files appear here as the workspace gets some."
							/>
						);
					}
					if (rows.length === 0) {
						return (
							<EmptyState
								compact
								title="No files match this filter"
								body="Clear the filter to see every file."
							/>
						);
					}
					return (
						<FileTreeBody
							rows={rows}
							selectedPath={selected}
							onSelect={setSelectedPath}
							onToggle={toggleFolder}
							onOpen={openFile}
							onView={openFile}
							onAttachInChat={attachInChat}
							onCopyPath={copyPath}
							onDiscard={discard}
							hasActiveChat={hasActiveChat}
							changedFiles={changedFiles}
							changedFolders={changedFolders}
						/>
					);
				}}
			</LoadableView>
		</div>
	);
}
