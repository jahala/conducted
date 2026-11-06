/**
 * @feature REV-08 FileTab
 * Owns: a center tab showing one file. In diff mode it shows the file's diff, in edit mode a
 * CodeMirror editor, and for previewable types a rendered preview. Entry point embedded by the
 * workspace tab strip.
 * Behaviour: ui-map.md 3.2, "Tab content: File" (modes diff and edit, Cmd+E toggles edit mode,
 * previews for Markdown, SVG, images, PDF, CSV and video, "File changed on disk" banner);
 * services-map.md 3.4.2 (diff texts come from git and from disk).
 * Data: useWorkspace (archived state), useSetting for the diff preferences, useChangedFiles for
 * the previous and next file commands. File text comes from useFileContent.
 * Children: FileTabHeader, FileDiffPane, FileEditorPane, FilePreviewPane, FileTabState.
 * Our design choice: a file with a previewable type can be switched to Preview; the URL's
 * `fileMode` still chooses diff or edit first. Saving is explicit with Cmd+S.
 * Must handle: loading, error with retry, file deleted or missing, binary file, file too large to
 * edit, archived workspace ("Workspace archived. Unarchive to view files"), the file changing on
 * disk while the user has edits (the editor's banner), a mode or scope change while a request is
 * in flight (newest answer wins through the query key).
 * Test first: with mode "diff" and a FileDiff of one changed line the tab shows the diff pane, and
 * switching to "edit" shows the editor with the new text.
 */
import type { WorkspaceId } from "@conducted/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { useCommandHandler, useRunCommandHandlers } from "../../app/command-dispatcher.ts";
import type { DiffScope } from "../../core/api.ts";
import {
	useActions,
	useChangedFiles,
	useFileContent,
	useSetting,
	useWorkspace,
} from "../../core/hooks.ts";
import { toastError } from "../../ui/Toast.tsx";
import type { DiffPreferences } from "../diff/diff-types.ts";
import { FileDiffPane } from "./FileDiffPane.tsx";
import { FileEditorPane } from "./FileEditorPane.tsx";
import { FilePreviewPane } from "./FilePreviewPane.tsx";
import { FileTabHeader, type FileTabMode } from "./FileTabHeader.tsx";
import { FileTabState } from "./FileTabState.tsx";
import { classifyPreview } from "./preview/preview-kind.ts";

export interface FileTabProps {
	workspaceId: WorkspaceId;
	path: string;
	mode: "diff" | "edit";
	scope: DiffScope;
	/** Called when the file gains or loses unsaved edits. */
	onDirtyChange?: (dirty: boolean) => void;
	/** Opens another file in the centre, so previous and next file can move the tab. */
	onOpenFile?: (path: string, mode: "diff" | "edit") => void;
}

export function FileTab({
	workspaceId,
	path,
	mode,
	scope,
	onDirtyChange,
	onOpenFile,
}: FileTabProps) {
	const actions = useActions();
	const workspace = useWorkspace(workspaceId);
	const content = useFileContent(workspaceId, path);
	const changedFiles = useChangedFiles(workspaceId, scope);
	const runCommand = useRunCommandHandlers();

	const splitView = useSetting<boolean>("using_split_view");
	const wrapLines = useSetting<boolean>("wrap_lines");
	const hideWhitespace = useSetting<boolean>("hide_whitespace_changes");
	const ligatures = useSetting<boolean>("file_ligatures_enabled");

	const [tabMode, setTabMode] = useState<FileTabMode>(mode);
	const [entireFile, setEntireFile] = useState(false);
	const [dirty, setDirty] = useState(false);
	const [width, setWidth] = useState<number | null>(null);
	const rootRef = useRef<HTMLDivElement>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: a new file starts in its URL mode.
	useEffect(() => {
		setTabMode(mode);
		setDirty(false);
	}, [mode, path]);

	useEffect(() => {
		const root = rootRef.current;
		if (root === null) return;
		const observer = new ResizeObserver((entries) => {
			const entry = entries[0];
			if (entry !== undefined) setWidth(entry.contentRect.width);
		});
		observer.observe(root);
		return () => observer.disconnect();
	}, []);

	const handleDirtyChange = useCallback(
		(next: boolean) => {
			setDirty(next);
			onDirtyChange?.(next);
		},
		[onDirtyChange],
	);

	const archived = workspace.state === "ready" && workspace.data.state === "archived";
	const contentKind = content.state === "ready" ? content.data.kind : null;
	const previewKind = contentKind === null ? null : classifyPreview(path, contentKind === "binary");
	const previewAvailable =
		contentKind !== null &&
		contentKind !== "missing" &&
		contentKind !== "too_large" &&
		previewKind !== "binary";
	const editDisabledReason =
		contentKind === "missing"
			? "This file was deleted, so there is nothing to edit."
			: contentKind === "binary"
				? "Binary files can't be edited."
				: contentKind === "too_large"
					? "This file is too large to edit."
					: content.state === "loading"
						? "The file is still loading."
						: null;

	const preferences: DiffPreferences = {
		layout: splitView ? "split" : "unified",
		entireFile,
		hideWhitespaceChanges: hideWhitespace,
		wrapLines,
		ligatures,
	};

	const savePreference = (key: string, value: boolean): void => {
		void actions.settings.set(key, value).then((result) => {
			if (!result.ok) toastError("Couldn't save the setting", result.error);
		});
	};

	const changePreferences = (next: DiffPreferences): void => {
		setEntireFile(next.entireFile);
		if (next.layout !== preferences.layout) {
			savePreference("using_split_view", next.layout === "split");
		}
		if (next.wrapLines !== preferences.wrapLines) savePreference("wrap_lines", next.wrapLines);
		if (next.hideWhitespaceChanges !== preferences.hideWhitespaceChanges) {
			savePreference("hide_whitespace_changes", next.hideWhitespaceChanges);
		}
		if (next.ligatures !== preferences.ligatures) {
			savePreference("file_ligatures_enabled", next.ligatures);
		}
	};

	const changeMode = (next: FileTabMode): void => {
		if (next === "edit" && editDisabledReason !== null) return;
		setTabMode(next);
	};

	useCommandHandler("workspace.toggleFileEdit", "area", () => {
		if (tabMode === "edit") {
			setTabMode("diff");
			return true;
		}
		if (editDisabledReason !== null) return false;
		setTabMode("edit");
		return true;
	});

	const moveBetweenFiles = (direction: 1 | -1): boolean => {
		if (onOpenFile === undefined || changedFiles.state !== "ready") return false;
		const index = changedFiles.data.findIndex((file) => file.path === path);
		if (index === -1 || changedFiles.data.length === 0) return false;
		const next =
			changedFiles.data[(index + direction + changedFiles.data.length) % changedFiles.data.length];
		if (next === undefined) return false;
		onOpenFile(next.path, tabMode === "edit" ? "edit" : "diff");
		return true;
	};

	useCommandHandler("review.previousFile", "area", () => moveBetweenFiles(-1));
	useCommandHandler("review.nextFile", "area", () => moveBetweenFiles(1));
	useCommandHandler("review.toggleViewed", "area", () => {
		if (changedFiles.state !== "ready") return false;
		const file = changedFiles.data.find((entry) => entry.path === path);
		if (file === undefined) return false;
		void actions.git.setViewed(workspaceId, path, !file.viewed).then((result) => {
			if (!result.ok) toastError("Couldn't change the viewed mark", result.error);
		});
		return true;
	});

	if (archived) {
		return (
			<FileTabState
				kind="archived"
				detail={null}
				onAction={() => {
					void actions.workspaces
						.unarchive(workspaceId, { branchName: null, clearChats: false })
						.then((result) => {
							if (!result.ok) toastError("Couldn't unarchive the workspace", result.error);
						});
				}}
			/>
		);
	}

	const showMode: FileTabMode =
		tabMode === "edit" && editDisabledReason !== null ? "diff" : tabMode;

	return (
		<div ref={rootRef} data-file-viewer className="flex h-full flex-col overflow-hidden">
			<FileTabHeader
				path={path}
				oldPath={null}
				mode={showMode}
				onModeChange={changeMode}
				editDisabledReason={editDisabledReason}
				previewAvailable={previewAvailable}
				preferences={preferences}
				onPreferencesChange={changePreferences}
				dirty={dirty}
				saving={false}
				saveError={null}
				onSave={() => {
					runCommand("review.saveFile");
				}}
				width={width}
			/>
			<div className="min-h-0 flex-1">
				{showMode === "diff" ? (
					<FileDiffPane
						workspaceId={workspaceId}
						path={path}
						scope={scope}
						preferences={preferences}
					/>
				) : showMode === "edit" ? (
					<FileEditorPane workspaceId={workspaceId} path={path} onDirtyChange={handleDirtyChange} />
				) : contentKind === null || contentKind === "missing" || contentKind === "too_large" ? (
					<FileTabState
						kind={
							contentKind === "missing"
								? "missing"
								: contentKind === "too_large"
									? "too_large"
									: "loading"
						}
						detail={null}
						onAction={() => {}}
					/>
				) : (
					<FilePreviewPane workspaceId={workspaceId} path={path} />
				)}
			</div>
		</div>
	);
}
