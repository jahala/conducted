/**
 * @feature REV-08 File editor pane
 * Owns: the edit mode of the File tab. It owns the draft text, save, the find and replace bar, and
 * the disk-change check.
 * Behaviour: ui-map.md 3.2 (edit uses CodeMirror, find and replace bar, "File changed on disk":
 * "Discard my edits" or "Keep mine").
 * Data: useFileContent and useActions().files.write. The content query polls the modified time
 * every 5 seconds (services-map.md 2.5.2), so an agent's write is noticed early.
 * Children: editor/EditorSurface, editor/FindReplaceBar, ExternalChangeBanner, FileTabState.
 * Must handle: save failing (draft kept, error shown), disk change while clean (silently reload),
 * disk change while dirty (banner), the file deleted while open, and very large files (read-only).
 * Test first: with a dirty draft and a newer modified time on disk, the banner shows and the draft
 * is unchanged.
 */
import type { WorkspaceId } from "@conducted/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useCommandHandler } from "../../app/command-dispatcher.ts";
import { useActions, useFileContent, useSetting } from "../../core/hooks.ts";
import { toastError } from "../../ui/Toast.tsx";
import { ExternalChangeBanner } from "./ExternalChangeBanner.tsx";
import { EditorSurface } from "./editor/EditorSurface.tsx";
import { FindReplaceBar } from "./editor/FindReplaceBar.tsx";
import { FileTabState } from "./FileTabState.tsx";

export interface FileEditorPaneProps {
	workspaceId: WorkspaceId;
	path: string;
	onDirtyChange: (dirty: boolean) => void;
}

/** Above this size the editor is read-only. Our design choice. */
export const MAX_EDIT_BYTES = 8 * 1024 * 1024;

interface Match {
	start: number;
	end: number;
}

function buildPattern(
	query: string,
	caseSensitive: boolean,
	wholeWord: boolean,
	regex: boolean,
): { pattern: RegExp | null; error: string | null } {
	if (query.length === 0) return { pattern: null, error: null };
	const source = regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const wrapped = wholeWord ? `\\b(?:${source})\\b` : source;
	try {
		return { pattern: new RegExp(wrapped, caseSensitive ? "g" : "gi"), error: null };
	} catch (cause) {
		return { pattern: null, error: cause instanceof Error ? cause.message : "Invalid pattern." };
	}
}

function findMatches(text: string, pattern: RegExp | null): Match[] {
	if (pattern === null) return [];
	const matches: Match[] = [];
	pattern.lastIndex = 0;
	let match = pattern.exec(text);
	while (match !== null) {
		if (match[0].length === 0) {
			pattern.lastIndex += 1;
		} else {
			matches.push({ start: match.index, end: match.index + match[0].length });
		}
		match = pattern.exec(text);
	}
	return matches;
}

/** Reads the document theme and follows changes to data-theme on the root. */
function useDocumentThemeType(): "light" | "dark" {
	const read = (): "light" | "dark" => {
		const explicit = document.documentElement.dataset.theme;
		if (explicit === "dark" || explicit === "light") return explicit;
		return window.matchMedia?.("(prefers-color-scheme: dark)").matches === true ? "dark" : "light";
	};
	const [themeType, setThemeType] = useState<"light" | "dark">(read);
	useEffect(() => {
		const current = (): "light" | "dark" => {
			const explicit = document.documentElement.dataset.theme;
			if (explicit === "dark" || explicit === "light") return explicit;
			return window.matchMedia?.("(prefers-color-scheme: dark)").matches === true
				? "dark"
				: "light";
		};
		const update = (): void => setThemeType(current());
		const media = window.matchMedia?.("(prefers-color-scheme: dark)");
		media?.addEventListener("change", update);
		const observer = new MutationObserver(update);
		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["data-theme"],
		});
		return () => {
			media?.removeEventListener("change", update);
			observer.disconnect();
		};
	}, []);
	return themeType;
}

export function FileEditorPane({ workspaceId, path, onDirtyChange }: FileEditorPaneProps) {
	const content = useFileContent(workspaceId, path);
	const actions = useActions();
	const queryClient = useQueryClient();
	const wrapLines = useSetting<boolean>("wrap_lines");
	const ligatures = useSetting<boolean>("file_ligatures_enabled");
	const monoFont = useSetting<string>("mono_font");
	const themeType = useDocumentThemeType();

	const [draft, setDraft] = useState<string | null>(null);
	const [baseModifiedAt, setBaseModifiedAt] = useState<number | null>(null);
	const [dirty, setDirty] = useState(false);
	const [saving, setSaving] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);
	const [banner, setBanner] = useState<"changed" | "deleted" | null>(null);
	const [findOpen, setFindOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [replacement, setReplacement] = useState("");
	const [caseSensitive, setCaseSensitive] = useState(false);
	const [wholeWord, setWholeWord] = useState(false);
	const [regex, setRegex] = useState(false);
	const [currentIndex, setCurrentIndex] = useState<number | null>(null);
	const diskModifiedAt = useRef<number | null>(null);

	const setDirtyState = (next: boolean): void => {
		setDirty(next);
		onDirtyChange(next);
	};

	useEffect(() => {
		if (content.state !== "ready") return;
		const data = content.data;
		if (data.kind === "text") {
			diskModifiedAt.current = data.modifiedAt;
			if (draft === null) {
				setDraft(data.text);
				setBaseModifiedAt(data.modifiedAt);
				return;
			}
			if (data.modifiedAt === baseModifiedAt) return;
			if (!dirty) {
				setDraft(data.text);
				setBaseModifiedAt(data.modifiedAt);
				setBanner(null);
				return;
			}
			setBanner("changed");
			return;
		}
		if (draft === null) return;
		if (data.kind === "missing") setBanner("deleted");
	}, [content, baseModifiedAt, dirty, draft]);

	useEffect(
		() => () => {
			onDirtyChange(false);
		},
		[onDirtyChange],
	);

	const changeDraft = (text: string): void => {
		setDraft(text);
		setDirtyState(true);
		setSaveError(null);
	};

	const save = async (): Promise<void> => {
		if (draft === null || baseModifiedAt === null || saving) return;
		setSaving(true);
		setSaveError(null);
		const result = await actions.files.write(workspaceId, path, draft, baseModifiedAt);
		setSaving(false);
		if (!result.ok) {
			if (result.error.code === "changed_on_disk") {
				setBanner("changed");
				return;
			}
			setSaveError(result.error.message);
			toastError("Couldn't save the file", result.error);
			return;
		}
		setBaseModifiedAt(result.value.modifiedAt);
		diskModifiedAt.current = result.value.modifiedAt;
		setBanner(null);
		setDirtyState(false);
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
	const matches = useMemo(() => findMatches(draft ?? "", pattern), [draft, pattern]);

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
		if (draft === null || currentIndex === null) return;
		const match = matches[currentIndex];
		if (match === undefined) return;
		changeDraft(`${draft.slice(0, match.start)}${replacement}${draft.slice(match.end)}`);
	};

	const replaceAll = (): void => {
		if (draft === null || pattern === null || matches.length === 0) return;
		pattern.lastIndex = 0;
		changeDraft(draft.replace(pattern, replacement));
		setCurrentIndex(null);
	};

	const keepMine = (): void => {
		const latest = diskModifiedAt.current;
		if (latest !== null) setBaseModifiedAt(latest);
		setBanner(null);
	};

	const discardMine = (): void => {
		if (content.state !== "ready") return;
		if (content.data.kind === "text") {
			setDraft(content.data.text);
			setBaseModifiedAt(content.data.modifiedAt);
			setDirtyState(false);
			setBanner(null);
		}
	};

	const retry = (): void => {
		void queryClient.invalidateQueries({ queryKey: ["files", "content", workspaceId, path] });
	};

	if (content.state === "loading")
		return <FileTabState kind="loading" detail={null} onAction={retry} />;
	if (content.state === "error") {
		return <FileTabState kind="error" detail={content.error.message} onAction={retry} />;
	}
	if (content.data.kind === "too_large") {
		return (
			<FileTabState
				kind="too_large"
				detail={content.data.sizeBytes > MAX_EDIT_BYTES ? "This file is too large to edit." : null}
				onAction={() => {}}
			/>
		);
	}
	if (content.data.kind === "binary") {
		return <FileTabState kind="binary" detail={null} onAction={() => {}} />;
	}
	if (content.data.kind === "missing" && draft === null) {
		return <FileTabState kind="missing" detail={null} onAction={retry} />;
	}

	const options = {
		wrapLines,
		ligatures,
		readOnly: content.data.kind === "text" && content.data.sizeBytes > MAX_EDIT_BYTES,
		fontFamily: monoFont,
		themeType,
	};

	return (
		<div className="flex h-full flex-col overflow-hidden">
			{banner === null ? null : (
				<ExternalChangeBanner kind={banner} onDiscardMine={discardMine} onKeepMine={keepMine} />
			)}
			{saveError === null ? null : (
				<p role="alert" className="border-b border-border px-3 py-1 text-xs text-danger">
					{saveError}
				</p>
			)}
			{findOpen ? (
				<FindReplaceBar
					query={query}
					replacement={replacement}
					matchCount={matches.length}
					currentIndex={currentIndex}
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
				text={draft ?? ""}
				options={options}
				onChange={changeDraft}
				onSave={() => void save()}
			/>
		</div>
	);
}
