/**
 * @feature REV-08 File editor pane
 * @feature REV-11 Resolve conflicts inline: current, incoming or both
 * Owns: the edit mode of the File tab: the editor, save, the find and replace bar, the banner
 * for a disk change, and the conflict rows for a file that still holds conflict markers. The
 * draft itself lives in the files service (useFileDraft), so it survives the pane unmounting: a
 * tab switch, Cmd+E back to Diff, or moving to another file and back.
 * Behaviour: ui-map.md 3.2 (edit uses CodeMirror, find and replace bar, "File changed on disk":
 * "Discard my edits" or "Keep mine"); inventory-messages-sidecar.md "Merge conflicts in the editor".
 * Data: useFileContent (its modified time is polled every 5 seconds, services-map.md 2.5.2, so an
 * agent's write is noticed early) and useFileDraft. The tab header shows the save state, Conductor's
 * "Retry update" control after a failed save, and the error as a toast from this pane.
 * Children: editor/EditorSurface, editor/FindReplaceBar, ExternalChangeBanner, ConflictResolver,
 * FileTabState.
 * Must handle: save failing (draft kept, error shown), disk change while clean (the new text
 * shows, the file stays clean), disk change while dirty (the "changed" banner), the file deleted
 * while dirty (the "deleted" banner), a kept change or deletion staying quiet while the user types,
 * very large files (read-only), the find bar's current match selected in the editor, Replace
 * with no current match (it replaces the first), a binary or too-large file (it cannot be
 * edited; "Open in another app" opens it in the default "Open in" app), and conflict markers in
 * the saved file while there are no unsaved edits (the conflict rows resolve them, then the editor
 * reloads the saved text).
 * Test first: with a dirty draft and a newer modified time on disk, the banner shows and the draft
 * is unchanged.
 */
import type { WorkspaceId } from "@conducted/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useCommandHandler } from "../../app/command-dispatcher.ts";
import { fileQueryKey, useFileContent, useFileDraft, useSetting } from "../../core/hooks.ts";
import { Button } from "../../ui/Button.tsx";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { toast, toastError } from "../../ui/Toast.tsx";
import { useThemeType } from "../../ui/use-theme-type.ts";
import { ConflictResolver } from "./ConflictResolver.tsx";
import { ExternalChangeBanner } from "./ExternalChangeBanner.tsx";
import { EditorSurface } from "./editor/EditorSurface.tsx";
import { FindReplaceBar } from "./editor/FindReplaceBar.tsx";
import { buildPattern, findMatches, replaceMatches } from "./editor/find-matches.ts";
import { FileTabState } from "./FileTabState.tsx";
import { useOpenElsewhere } from "./use-open-elsewhere.tsx";

export interface FileEditorPaneProps {
	workspaceId: WorkspaceId;
	path: string;
	/** Called when the file gains or loses unsaved edits. */
	onDirtyChange?: (dirty: boolean) => void;
}

/** Above this size the editor is read-only. Our design choice. */
export const MAX_EDIT_BYTES = 8 * 1024 * 1024;

export function FileEditorPane({ workspaceId, path, onDirtyChange }: FileEditorPaneProps) {
	const content = useFileContent(workspaceId, path);
	const { draft, edit, discard, keep, save: saveDraft } = useFileDraft(workspaceId, path);
	const queryClient = useQueryClient();
	const wrapLines = useSetting<boolean>("wrap_lines");
	const ligatures = useSetting<boolean>("file_ligatures_enabled");
	const monoFont = useSetting<string>("mono_font");
	const codeTheme = useSetting<string>("code_theme");
	const themeType = useThemeType();
	const elsewhere = useOpenElsewhere(workspaceId, path);

	const [findOpen, setFindOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [replacement, setReplacement] = useState("");
	const [caseSensitive, setCaseSensitive] = useState(false);
	const [wholeWord, setWholeWord] = useState(false);
	const [regex, setRegex] = useState(false);
	const [currentIndex, setCurrentIndex] = useState<number | null>(null);

	const dirty = draft !== undefined;
	useEffect(() => {
		onDirtyChange?.(dirty);
	}, [dirty, onDirtyChange]);

	const disk =
		content.state === "ready" && content.data.kind === "text"
			? { text: content.data.text, modifiedAt: content.data.modifiedAt }
			: null;
	const text = draft?.text ?? disk?.text ?? "";
	// Conflict rows act on the saved file, so they step aside while an unsaved edit is open.
	const conflictText =
		draft === undefined && content.state === "ready" && content.data.kind === "text"
			? content.data.text
			: "";

	const banner: "changed" | "deleted" | null =
		draft === undefined || content.state !== "ready"
			? null
			: content.data.kind === "text" && content.data.modifiedAt !== draft.baseModifiedAt
				? "changed"
				: content.data.kind === "missing" && !draft.keptAfterDelete
					? "deleted"
					: null;

	const save = async (): Promise<void> => {
		const result = await saveDraft();
		if (!result.ok) {
			// Conductor's words for a save refused because the file changed on disk.
			if (result.error.code === "changed_on_disk") {
				toast.error("File changed on disk. Keep or discard your edits to save.");
				return;
			}
			toastError("Couldn't save the file", result.error);
		}
	};

	useCommandHandler("review.saveFile", "area", () => {
		void save();
		return true;
	});
	useCommandHandler("review.findInFile", "area", () => {
		setFindOpen(true);
		return true;
	});

	const { pattern, error: regexError } = useMemo(
		() => buildPattern(query, caseSensitive, wholeWord, regex),
		[query, caseSensitive, wholeWord, regex],
	);
	const matches = useMemo(() => findMatches(text, pattern), [text, pattern]);
	const current = currentIndex === null ? undefined : matches[currentIndex];

	const changeText = (next: string): void => edit(next, disk);

	const move = (direction: 1 | -1): void => {
		if (matches.length === 0) {
			setCurrentIndex(null);
			return;
		}
		const next =
			currentIndex === null
				? direction === 1
					? 0
					: matches.length - 1
				: (currentIndex + direction + matches.length) % matches.length;
		setCurrentIndex(next);
	};

	const replaceCurrent = (): void => {
		const index = current === undefined ? 0 : (currentIndex ?? 0);
		const match = matches[index];
		if (match === undefined) return;
		changeText(replaceMatches(text, [match], replacement));
		setCurrentIndex(index);
	};

	const replaceAll = (): void => {
		if (matches.length === 0) return;
		changeText(replaceMatches(text, matches, replacement));
		setCurrentIndex(null);
	};

	const keepMine = (): void => {
		if (content.state !== "ready") return;
		keep(content.data.kind === "text" ? content.data.modifiedAt : null);
	};

	const readOnly =
		content.state === "ready" &&
		content.data.kind === "text" &&
		content.data.sizeBytes > MAX_EDIT_BYTES;
	// A stable object, so typing does not reconfigure the editor on every keystroke.
	const options = useMemo(
		() => ({ wrapLines, ligatures, readOnly, fontFamily: monoFont, themeType, codeTheme }),
		[wrapLines, ligatures, readOnly, monoFont, themeType, codeTheme],
	);

	const retry = (): void => {
		void queryClient.invalidateQueries({ queryKey: fileQueryKey(workspaceId, path) });
	};

	if (content.state === "loading")
		return <FileTabState kind="loading" detail={null} onAction={retry} />;
	if (content.state === "error") {
		// Conductor's editor error card (renderApp @9949310).
		return (
			<EmptyState
				tone="failed"
				title="Failed to open editor"
				body="An error occurred while opening the editor."
				action={
					<Button variant="secondary" onClick={retry}>
						Try again
					</Button>
				}
			/>
		);
	}
	if (content.data.kind === "too_large") {
		return (
			<FileTabState
				kind="too_large"
				detail={content.data.sizeBytes > MAX_EDIT_BYTES ? "This file is too large to edit." : null}
				onAction={elsewhere.openInApp}
			/>
		);
	}
	if (content.data.kind === "binary") {
		return <FileTabState kind="binary" detail={null} onAction={elsewhere.openInApp} />;
	}
	if (content.data.kind === "missing" && draft === undefined) {
		return <FileTabState kind="missing" detail={null} onAction={retry} />;
	}

	return (
		<div className="flex h-full flex-col overflow-hidden">
			{banner === null ? null : (
				<ExternalChangeBanner kind={banner} onDiscardMine={discard} onKeepMine={keepMine} />
			)}
			<ConflictResolver workspaceId={workspaceId} path={path} text={conflictText} />
			{findOpen ? (
				<FindReplaceBar
					query={query}
					replacement={replacement}
					matchCount={matches.length}
					currentIndex={current === undefined ? null : currentIndex}
					caseSensitive={caseSensitive}
					wholeWord={wholeWord}
					regex={regex}
					regexError={regexError}
					onQueryChange={(next) => {
						setQuery(next);
						setCurrentIndex(null);
					}}
					onReplacementChange={setReplacement}
					onToggle={(option) => {
						if (option === "caseSensitive") setCaseSensitive((value) => !value);
						if (option === "wholeWord") setWholeWord((value) => !value);
						if (option === "regex") setRegex((value) => !value);
						setCurrentIndex(null);
					}}
					onNext={() => move(1)}
					onPrevious={() => move(-1)}
					onReplace={replaceCurrent}
					onReplaceAll={replaceAll}
					onClose={() => setFindOpen(false)}
				/>
			) : null}
			<EditorSurface
				path={path}
				text={text}
				options={options}
				selection={current === undefined ? null : { from: current.start, to: current.end }}
				onChange={changeText}
				onSave={() => void save()}
			/>
		</div>
	);
}
