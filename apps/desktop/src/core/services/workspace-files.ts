/**
 * @feature REV-06 Workspace files: tree, quick open, search, read and write
 * @feature REV-08 File content for the viewer, the editor's unsaved drafts and the open-in-tab request
 * @feature REV-10 Artifacts tab: the workspace's `.context` files, more pages and uploads
 * @feature REV-11 Resolve conflicts inline: current, incoming or both
 * @feature SIDE-22 Slash command cache that works before a chat starts
 * Owns: listing a workspace's files, fuzzy file search, content search, reading and saving a file
 * for the viewer and editor, fuzzy search of a repository's main clone before a workspace exists, the modified time the viewer polls, the editor's unsaved drafts,
 * parsing a file's conflict markers and replacing them with the current side, the incoming side or both, and
 * the pages of the Artifacts list. The drafts live in this service's store, keyed by workspace and
 * path, so they outlive the tab: switching tabs, toggling Diff and Edit, or moving to the next file
 * keeps them. A draft is kept in memory until it is saved or discarded, its workspace is removed
 * (the container calls `dropDraftsExcept` when the workspace store changes), or the app quits. An
 * archived workspace keeps its drafts, because Restore brings the same folder back. The artifact
 * pages are also kept per workspace, until the tab reads the first page again. The absolute path
 * of an artifact, for "Attach to chat", comes from here too, so the root and `.context` folder
 * rule has one home.
 * Behaviour: services-map.md 5A.5 (transport pattern, UI queries, minimum search length 2, polling
 * the tree, the artifacts command), ui-map.md 3.6 (All files tab, quick open, search in files, the
 * Artifacts tab). The tab polls `tree` because JS file watchers do nothing under CEF
 * (services-map.md 5A.9).
 * Must handle: paths outside the workspace folder (and its linked folders) are refused before any
 * file is read or written; the tree respects `.gitignore` (done by the Rust search commands); a
 * query under two characters returns no rows; a bad regular expression returns the platform's
 * pattern error; saving writes atomically and refuses when the file changed on disk since it was
 * opened (returns a conflict Err with the new modified time); a draft the user kept after the
 * file was deleted is saved by writing the file again, and refused if the file came back; an edit
 * that brings the text back to the disk text drops the draft; a second save while one runs is
 * ignored; typing during a save keeps the newer text as a draft. Only the newest artifact read for a
 * workspace changes its pages, so an older page cannot land after a newer one. The omitted count
 * is the platform's total for the whole folder, taken as it is from the newest page. An upload
 * copies the picked files into the workspace's `.context` folder, then reads the first page
 * again; a picked file whose name is already in `.context` is refused and the other files are
 * still copied; the first failure is returned. A conflict resolution needs one choice per conflict
 * and the same number as the file holds; malformed markers or a count that does not match fail
 * before the file is written. The save is atomic, and after it leaves no markers the file is
 * staged with `git add`. A `git add` that fails after the write (an index lock, a linked folder
 * that is not a repository) returns `conflict_saved_not_staged`, so the screen does not call a
 * save that landed a failed save.
 * Our design choice: an upload never replaces an artifact. A name clash is refused with a message
 * that names the file, so the user renames it rather than losing the agent's file.
 * Our design choice: a preview URL carries the file's modified time as a query string. The asset
 * handler reads only the path, and the webview loads the file again when it changes.
 * Our design choice: before every file call the path is checked in TypeScript: it must be relative
 * and must not climb with `..`. This check is lexical. It does not follow symlinks, so a link inside
 * the workspace that points outside it passes here; resolving links is the Rust file commands' scope
 * check (PLAT-29, files.rs `check_path_in_scope`).
 * Our design choice: `grep` asks the platform for one match more than CONTENT_SEARCH_LIMIT, so the
 * caller can tell a list that was cut from one that holds exactly the limit.
 * Test first: readFile("../outside") returns an Err with code `path_outside_workspace`.
 * Test first: resolveConflicts with one "current" choice replaces that conflict's markers with the
 * current side and stages the file.
 */
import { appError, err, ok, type Result, type WorkspaceId } from "@conducted/shared";
import { createStore, type StoreApi } from "zustand/vanilla";
import type {
	FileSearch,
	FileStat,
	FileSystem,
	GrepMatch,
	Opener,
	Shell,
	TreeEntry,
} from "../../platform/platform.ts";
import type { ConflictChoice, DiffScope, FileEntry } from "../api.ts";
import { createLatestWins } from "../async/latest-wins.ts";
import { copyFileKeepingMode, FILE_COPY_FAILED } from "../fs-helpers.ts";
import { addPath } from "../git/commands.ts";
import type { GitRunner } from "../git/runner.ts";
import type { ArtifactEntry, FileContent } from "../model.ts";
import { workspaceRelativePath } from "./git.ts";

/** Search in files shows this many matches, and asks for a narrower query when there are more. */
export const CONTENT_SEARCH_LIMIT = 200;
/** The Artifacts tab reads this many entries at a time. */
const ARTIFACTS_PAGE_SIZE = 50;

export interface WorkspaceFilesServiceDeps {
	fs: FileSystem;
	search: FileSearch;
	/** Copies picked files into `.context` on upload. */
	shell: Pick<Shell, "run">;
	/** Stages a file whose conflicts are resolved, so the change list sees it as staged. */
	git: Pick<GitRunner, "runChecked">;
	/** Workspace folder plus linked folders that are allowed. */
	rootsOf: (workspaceId: WorkspaceId) => Promise<Result<string[]>>;
	/** Reveals a file in Finder and opens one in another app, for the file viewer. */
	opener: Pick<Opener, "revealInFinder" | "openWith">;
}

/** One request from the Git panel or a shortcut to show a file in the centre. */
export interface OpenFileRequest {
	workspaceId: WorkspaceId;
	path: string;
	mode: "diff" | "edit";
	scope: DiffScope;
}

type OpenFileListener = (request: OpenFileRequest) => void;

/** Unsaved edits of one file in the editor. */
export interface FileDraft {
	text: string;
	/** The modified time on disk the edits started from. A save refuses when the disk moved on. */
	baseModifiedAt: number;
	/** The user chose Keep mine after the file was deleted on disk; a save writes it again. */
	keptAfterDelete: boolean;
	saving: boolean;
	/** The last save's failure, shown in the tab header until the next edit or save. */
	saveError: string | null;
}

export interface FileDraftsState {
	drafts: Readonly<Record<string, FileDraft>>;
}

/** One workspace's pages of the Artifacts tab. */
interface ArtifactsPageState {
	entries: readonly ArtifactEntry[];
	hasMore: boolean;
	omitted: number;
	cursor: string | null;
	loading: boolean;
	/** Set only when reading the first page failed, so the tab shows the error instead of a list. */
	error: ReturnType<typeof appError> | null;
}

interface ArtifactsState {
	byWorkspace: Readonly<Record<string, ArtifactsPageState>>;
}

const EMPTY_ARTIFACTS_PAGE: ArtifactsPageState = {
	entries: [],
	hasMore: false,
	omitted: 0,
	cursor: null,
	loading: false,
	error: null,
};

/** The store key of a file's draft. */
export const fileDraftKey = (workspaceId: WorkspaceId, relativePath: string): string =>
	`${workspaceId}\u0000${relativePath}`;

/** The workspace a draft key belongs to. Ids never hold the separator, so the first one splits. */
const workspaceOfDraftKey = (key: string): WorkspaceId =>
	key.slice(0, key.indexOf("\u0000")) as WorkspaceId;

/**
 * The URL the webview loads a file's preview from (`fs.assetUrl`). The modified time changes the
 * URL when the file changes, so an image, PDF or video loads again.
 */
export const previewUrlOf = (
	fs: Pick<FileSystem, "assetUrl">,
	absolutePath: string,
	modifiedAt: number | null,
): string => {
	const url = fs.assetUrl(absolutePath);
	return modifiedAt === null ? url : `${url}?v=${modifiedAt}`;
};

interface ResolvedPath {
	root: string;
	/** Relative to the workspace root, with no leading slash. */
	relative: string;
	absolute: string;
}

const trimRoot = (root: string): string => (root === "/" ? "" : root.replace(/\/+$/, ""));

/** The workspace's `.context` folder, with no trailing slash. */
const contextFolderOf = (root: string): string => `${trimRoot(root)}/.context`;

/** A path as the UI shows it: relative to the root that was searched, or null when outside it. */
const relativeTo = (root: string, path: string): string | null => {
	const base = trimRoot(root);
	if (base === "") return path.startsWith("/") ? path.slice(1) : path;
	if (path === base) return "";
	const prefix = `${base}/`;
	return path.startsWith(prefix) ? path.slice(prefix.length) : null;
};

const toEntries = (root: string, entries: readonly TreeEntry[]): FileEntry[] => {
	const result: FileEntry[] = [];
	for (const entry of entries) {
		const relative = relativeTo(root, entry.path);
		if (relative === null || relative.length === 0) continue;
		result.push({ path: relative, isDirectory: entry.isDirectory });
	}
	return result.sort((left, right) => left.path.localeCompare(right.path));
};

const artifactEntryFrom = (context: string, entry: FileStat): ArtifactEntry | null => {
	const relative = relativeTo(context, entry.path);
	if (relative === null || relative.length === 0) return null;
	return {
		path: relative,
		isDirectory: entry.isDirectory,
		sizeBytes: entry.size,
		modifiedAt: entry.modifiedAt,
	};
};

/** A conflict resolution was written to disk, but `git add` failed afterwards. */
export const CONFLICT_SAVED_NOT_STAGED = "conflict_saved_not_staged";

/** One conflict region in a file, in the order it appears. */
export interface ConflictHunk {
	/** 0-based, top to bottom. */
	index: number;
	/** 1-based line of the `<<<<<<<` marker. */
	startLine: number;
	/** 1-based line of the `>>>>>>>` marker. */
	endLine: number;
	/** The lines between `<<<<<<<` and `=======` (or the diff3 base marker), joined by `\n`. */
	currentText: string;
	/** The lines between `=======` and `>>>>>>>`, joined by `\n`. */
	incomingText: string;
	/** The current side split into lines, so a blank side stays empty when it is applied. */
	currentLines: readonly string[];
	/** The incoming side split into lines, so a blank side stays empty when it is applied. */
	incomingLines: readonly string[];
}

type ConflictMarker = "start" | "base" | "separator" | "end";

/** The marker a line is, ignoring a Windows line ending. Any other line is null. */
const conflictMarkerOf = (line: string): ConflictMarker | null => {
	const body = line.endsWith("\r") ? line.slice(0, -1) : line;
	if (/^<{7}(?: .*)?$/.test(body)) return "start";
	if (/^\|{7}(?: .*)?$/.test(body)) return "base";
	if (/^={7}$/.test(body)) return "separator";
	if (/^>{7}(?: .*)?$/.test(body)) return "end";
	return null;
};

/** A malformed marker can leave a file half resolved, so it is refused before anything is written. */
const malformedConflict = (line: number): Result<never> =>
	err(
		appError(
			"conflict_markers_malformed",
			`The conflict markers in this file are malformed near line ${line}. Fix them by hand.`,
		),
	);

/**
 * Reads the conflict regions top to bottom. Malformed markers return an Err, so a caller never
 * writes a file it only partly understood.
 */
export function parseConflictMarkers(text: string): Result<ConflictHunk[]> {
	const lines = text.split("\n");
	const hunks: ConflictHunk[] = [];
	let at = 0;
	while (at < lines.length) {
		const marker = conflictMarkerOf(lines[at] ?? "");
		if (marker === "start") {
			const startLine = at + 1;
			const currentLines: string[] = [];
			at += 1;
			while (
				at < lines.length &&
				conflictMarkerOf(lines[at] ?? "") !== "separator" &&
				conflictMarkerOf(lines[at] ?? "") !== "base"
			) {
				const inside = conflictMarkerOf(lines[at] ?? "");
				if (inside === "start" || inside === "end") return malformedConflict(at + 1);
				currentLines.push(lines[at] ?? "");
				at += 1;
			}
			if (at >= lines.length) return malformedConflict(startLine);
			if (conflictMarkerOf(lines[at] ?? "") === "base") {
				at += 1;
				while (at < lines.length && conflictMarkerOf(lines[at] ?? "") !== "separator") {
					const inside = conflictMarkerOf(lines[at] ?? "");
					if (inside !== null) return malformedConflict(at + 1);
					at += 1;
				}
				if (at >= lines.length) return malformedConflict(startLine);
			}
			if (conflictMarkerOf(lines[at] ?? "") !== "separator") return malformedConflict(at + 1);
			at += 1;
			const incomingLines: string[] = [];
			while (at < lines.length && conflictMarkerOf(lines[at] ?? "") !== "end") {
				const inside = conflictMarkerOf(lines[at] ?? "");
				if (inside !== null) return malformedConflict(at + 1);
				incomingLines.push(lines[at] ?? "");
				at += 1;
			}
			if (at >= lines.length) return malformedConflict(startLine);
			hunks.push({
				index: hunks.length,
				startLine,
				endLine: at + 1,
				currentText: currentLines.join("\n"),
				incomingText: incomingLines.join("\n"),
				currentLines,
				incomingLines,
			});
			at += 1;
			continue;
		}
		if (marker === "end" || marker === "base") return malformedConflict(at + 1);
		at += 1;
	}
	return ok(hunks);
}

/** Replaces every conflict with its chosen side. An unknown choice or a count mismatch is refused. */
function applyConflictChoices(text: string, choices: readonly ConflictChoice[]): Result<string> {
	const parsed = parseConflictMarkers(text);
	if (!parsed.ok) return parsed;
	if (parsed.value.length === 0) {
		return err(
			appError("conflict_markers_missing", "That file has no conflict markers to resolve."),
		);
	}
	if (parsed.value.length !== choices.length) {
		return err(
			appError(
				"conflict_choice_count",
				`This file has ${parsed.value.length} conflicts, but ${choices.length} choices were given.`,
			),
		);
	}
	const lines = text.split("\n");
	const output: string[] = [];
	let cursor = 0;
	for (const hunk of parsed.value) {
		const choice = choices[hunk.index];
		if (choice !== "current" && choice !== "incoming" && choice !== "both") {
			return err(appError("conflict_choice_invalid", "A conflict choice was not recognised."));
		}
		const start = hunk.startLine - 1;
		const end = hunk.endLine - 1;
		output.push(...lines.slice(cursor, start));
		if (choice === "current" || choice === "both") output.push(...hunk.currentLines);
		if (choice === "incoming" || choice === "both") output.push(...hunk.incomingLines);
		cursor = end + 1;
	}
	output.push(...lines.slice(cursor));
	return ok(output.join("\n"));
}

export class WorkspaceFilesService {
	readonly #deps: WorkspaceFilesServiceDeps;
	readonly #openListeners = new Set<OpenFileListener>();
	readonly #artifactReads = createLatestWins<WorkspaceId>();
	/** The editor's unsaved drafts. See the header for their lifetime. */
	readonly drafts: StoreApi<FileDraftsState> = createStore<FileDraftsState>(() => ({ drafts: {} }));
	/** The Artifacts tab's pages. See the header for their lifetime. */
	readonly artifactsStore: StoreApi<ArtifactsState> = createStore<ArtifactsState>(() => ({
		byWorkspace: {},
	}));

	constructor(deps: WorkspaceFilesServiceDeps) {
		this.#deps = deps;
	}

	/** The workspace screen subscribes here so `Actions.files.open` reaches the URL. */
	onOpen(listener: OpenFileListener): () => void {
		this.#openListeners.add(listener);
		return () => {
			this.#openListeners.delete(listener);
		};
	}

	/** Backs `useFileTree`. The platform lists the whole tree; the tab shows depth 1 until expanded. */
	async tree(workspaceId: WorkspaceId): Promise<Result<FileEntry[]>> {
		const root = await this.#rootOf(workspaceId);
		if (!root.ok) return root;
		const listed = await this.#deps.search.listTree(root.value);
		if (!listed.ok) return listed;
		return ok(toEntries(root.value, listed.value));
	}

	async quickOpen(
		workspaceId: WorkspaceId,
		query: string,
		limit: number,
	): Promise<Result<FileEntry[]>> {
		const trimmed = query.trim();
		const count = Math.max(0, Math.floor(limit));
		if (trimmed.length < 2 || count === 0) return ok([]);
		const root = await this.#rootOf(workspaceId);
		if (!root.ok) return root;
		const found = await this.#deps.search.fuzzyMatch(root.value, trimmed, count);
		if (!found.ok) return found;
		return ok(toEntries(root.value, found.value));
	}

	/** Backs `useRepoFileSearch`: a repository's own files, before any workspace exists (SIDE-22). */
	async quickOpenRoot(
		rootPath: string,
		query: string,
		limit: number,
	): Promise<Result<FileEntry[]>> {
		const trimmed = query.trim();
		const count = Math.max(0, Math.floor(limit));
		if (trimmed.length < 2 || count === 0) return ok([]);
		const found = await this.#deps.search.fuzzyMatch(rootPath, trimmed, count);
		if (!found.ok) return found;
		return ok(toEntries(rootPath, found.value));
	}

	async grep(
		workspaceId: WorkspaceId,
		query: string,
		options: { caseSensitive: boolean; wholeWord: boolean; regex: boolean },
	): Promise<Result<GrepMatch[]>> {
		const trimmed = query.trim();
		if (trimmed.length < 2) return ok([]);
		const root = await this.#rootOf(workspaceId);
		if (!root.ok) return root;
		const found = await this.#deps.search.grep(root.value, trimmed, {
			caseSensitive: options.caseSensitive,
			wholeWord: options.wholeWord,
			regex: options.regex,
			limit: CONTENT_SEARCH_LIMIT + 1,
		});
		if (!found.ok) return found;
		const matches: GrepMatch[] = [];
		for (const match of found.value) {
			const relative = relativeTo(root.value, match.path);
			if (relative !== null) matches.push({ ...match, path: relative });
		}
		return ok(matches);
	}

	async readFile(
		workspaceId: WorkspaceId,
		relativePath: string,
	): Promise<Result<{ text: string; modifiedAt: number }>> {
		const resolved = await this.#resolve(workspaceId, relativePath);
		if (!resolved.ok) return resolved;
		const stat = await this.#deps.fs.stat(resolved.value.absolute);
		if (!stat.ok) return stat;
		const read = await this.#deps.fs.readText(resolved.value.absolute);
		if (!read.ok) return read;
		return ok({ text: read.value, modifiedAt: stat.value.modifiedAt });
	}

	/** Reads a file for the viewer, with a URL for the previews the webview can draw. */
	async readContent(workspaceId: WorkspaceId, relativePath: string): Promise<Result<FileContent>> {
		const resolved = await this.#resolve(workspaceId, relativePath);
		if (!resolved.ok) return resolved;
		const absolute = resolved.value.absolute;
		const stat = await this.#deps.fs.stat(absolute);
		if (!stat.ok) {
			if (stat.error.code === "fs_not_found") return ok({ kind: "missing" });
			return stat;
		}
		if (stat.value.isDirectory) {
			return err(appError("fs_is_a_directory", `"${relativePath}" is a folder.`));
		}
		const sizeBytes = stat.value.size;
		const modifiedAt = stat.value.modifiedAt;
		const read = await this.#deps.fs.readText(absolute);
		if (read.ok) {
			return ok({ kind: "text", text: read.value, modifiedAt, sizeBytes });
		}
		if (read.error.code === "fs_not_utf8") {
			return ok({
				kind: "binary",
				sizeBytes,
				modifiedAt,
				previewUrl: previewUrlOf(this.#deps.fs, absolute, modifiedAt),
			});
		}
		if (read.error.code === "fs_file_too_large") return ok({ kind: "too_large", sizeBytes });
		if (read.error.code === "fs_not_found") return ok({ kind: "missing" });
		return read;
	}

	/** The modified time the viewer polls. Null when the file is gone. */
	async modifiedAtOf(
		workspaceId: WorkspaceId,
		relativePath: string,
	): Promise<Result<number | null>> {
		const resolved = await this.#resolve(workspaceId, relativePath);
		if (!resolved.ok) return resolved;
		const stat = await this.#deps.fs.stat(resolved.value.absolute);
		if (!stat.ok) return stat.error.code === "fs_not_found" ? ok(null) : stat;
		return ok(stat.value.modifiedAt);
	}

	/**
	 * Records the user's edit. The first edit starts from the disk text and its modified time; an
	 * edit that gives back the disk text drops the draft, so the file reads as clean again.
	 */
	editDraft(
		workspaceId: WorkspaceId,
		relativePath: string,
		text: string,
		disk: { text: string; modifiedAt: number } | null,
	): void {
		const key = fileDraftKey(workspaceId, relativePath);
		const current = this.drafts.getState().drafts[key];
		const baseModifiedAt = current?.baseModifiedAt ?? disk?.modifiedAt;
		if (baseModifiedAt === undefined) return;
		const backToDisk =
			disk !== null &&
			text === disk.text &&
			baseModifiedAt === disk.modifiedAt &&
			current?.saving !== true;
		if (backToDisk) {
			this.#removeDraft(key);
			return;
		}
		this.#setDraft(key, {
			text,
			baseModifiedAt,
			keptAfterDelete: current?.keptAfterDelete ?? false,
			saving: current?.saving ?? false,
			saveError: null,
		});
	}

	/** Discard my edits: the editor shows the disk version again. */
	discardDraft(workspaceId: WorkspaceId, relativePath: string): void {
		this.#removeDraft(fileDraftKey(workspaceId, relativePath));
	}

	/** Drops the drafts of every workspace `keep` says no to, for example one that was removed. */
	dropDraftsExcept(keep: (workspaceId: WorkspaceId) => boolean): void {
		const drafts = this.drafts.getState().drafts;
		const kept: Record<string, FileDraft> = {};
		let dropped = false;
		for (const [key, draft] of Object.entries(drafts)) {
			if (keep(workspaceOfDraftKey(key))) kept[key] = draft;
			else dropped = true;
		}
		if (dropped) this.drafts.setState({ drafts: kept });
	}

	/**
	 * Keep mine: the next save overwrites the disk version on purpose. A null modified time means
	 * the file was deleted, and the next save writes it again.
	 */
	keepDraft(workspaceId: WorkspaceId, relativePath: string, diskModifiedAt: number | null): void {
		const key = fileDraftKey(workspaceId, relativePath);
		const current = this.drafts.getState().drafts[key];
		if (current === undefined) return;
		this.#setDraft(
			key,
			diskModifiedAt === null
				? { ...current, keptAfterDelete: true }
				: { ...current, baseModifiedAt: diskModifiedAt, keptAfterDelete: false },
		);
	}

	/**
	 * Saves the draft. `ok(null)` when there is nothing to save or a save is already running. On
	 * success the saved text and its modified time come back, so the caller can show them at once.
	 */
	async saveDraft(
		workspaceId: WorkspaceId,
		relativePath: string,
	): Promise<Result<{ text: string; modifiedAt: number } | null>> {
		const key = fileDraftKey(workspaceId, relativePath);
		const draft = this.drafts.getState().drafts[key];
		if (draft === undefined || draft.saving) return ok(null);
		this.#setDraft(key, { ...draft, saving: true, saveError: null });
		const saved = draft.keptAfterDelete
			? await this.#writeAgain(workspaceId, relativePath, draft.text)
			: await this.saveFile(workspaceId, relativePath, draft.text, draft.baseModifiedAt);
		const current = this.drafts.getState().drafts[key];
		if (!saved.ok) {
			if (current !== undefined) {
				const saveError = saved.error.code === "changed_on_disk" ? null : saved.error.message;
				this.#setDraft(key, { ...current, saving: false, saveError });
			}
			return saved;
		}
		if (current !== undefined) {
			if (current.text === draft.text) {
				this.#removeDraft(key);
			} else {
				this.#setDraft(key, {
					...current,
					baseModifiedAt: saved.value.modifiedAt,
					keptAfterDelete: false,
					saving: false,
				});
			}
		}
		return ok({ text: draft.text, modifiedAt: saved.value.modifiedAt });
	}

	/** Backs `Actions.files.open`: asks the workspace screen to show the file in a tab. */
	async open(
		workspaceId: WorkspaceId,
		relativePath: string,
		mode: "diff" | "edit",
		scope: DiffScope,
	): Promise<Result<void>> {
		const checked = workspaceRelativePath(relativePath);
		if (!checked.ok) return checked;
		if (this.#openListeners.size === 0) {
			return err(
				appError("file_open_unavailable", "No workspace screen is open to show this file."),
			);
		}
		const request: OpenFileRequest = {
			workspaceId,
			path: checked.value,
			mode,
			scope,
		};
		for (const listener of this.#openListeners) listener(request);
		return ok(undefined);
	}

	/** Backs `Actions.files.reveal`: shows the file selected in a Finder window. */
	async reveal(workspaceId: WorkspaceId, relativePath: string): Promise<Result<void>> {
		const resolved = await this.#resolve(workspaceId, relativePath);
		if (!resolved.ok) return resolved;
		try {
			await this.#deps.opener.revealInFinder(resolved.value.absolute);
			return ok(undefined);
		} catch (cause) {
			return err(appError("reveal_failed", "Finder could not show the file.", cause));
		}
	}

	/**
	 * Backs `Actions.files.openInApp`: opens the file in the named app. The "Open in" menu's rule
	 * chooses the app (features/open-in), since only the screen knows which apps it lists.
	 */
	async openInApp(
		workspaceId: WorkspaceId,
		relativePath: string,
		appName: string,
	): Promise<Result<void>> {
		const resolved = await this.#resolve(workspaceId, relativePath);
		if (!resolved.ok) return resolved;
		return this.#deps.opener.openWith(appName, resolved.value.absolute);
	}

	/** Backs `Actions.files.write`. Fails with code "changed_on_disk" when the file moved on. */
	async saveFile(
		workspaceId: WorkspaceId,
		relativePath: string,
		text: string,
		expectedModifiedAt: number,
	): Promise<Result<{ modifiedAt: number }>> {
		const resolved = await this.#resolve(workspaceId, relativePath);
		if (!resolved.ok) return resolved;
		const stat = await this.#deps.fs.stat(resolved.value.absolute);
		if (!stat.ok) {
			if (stat.error.code === "fs_not_found") {
				return err(
					appError("missing", `"${relativePath}" is no longer in the workspace.`, stat.error),
				);
			}
			return stat;
		}
		if (stat.value.modifiedAt !== expectedModifiedAt) {
			return err(
				appError("changed_on_disk", `"${relativePath}" changed on disk after it was opened.`, {
					modifiedAt: stat.value.modifiedAt,
				}),
			);
		}
		const written = await this.#deps.fs.writeTextAtomic(resolved.value.absolute, text);
		if (!written.ok) {
			return err(appError("other", written.error.message, written.error));
		}
		const after = await this.#deps.fs.stat(resolved.value.absolute);
		if (!after.ok) return after;
		return ok({ modifiedAt: after.value.modifiedAt });
	}

	/**
	 * Backs `Actions.files.resolveConflicts`. Malformed markers fail without changing the file.
	 * When the saved text has no markers left, the file is staged so it leaves the conflicted list.
	 */
	async resolveConflicts(
		workspaceId: WorkspaceId,
		relativePath: string,
		choices: readonly ConflictChoice[],
	): Promise<Result<void>> {
		const resolved = await this.#resolve(workspaceId, relativePath);
		if (!resolved.ok) return resolved;
		const read = await this.#deps.fs.readText(resolved.value.absolute);
		if (!read.ok) return read;
		const applied = applyConflictChoices(read.value, choices);
		if (!applied.ok) return applied;
		const remaining = parseConflictMarkers(applied.value);
		if (!remaining.ok) return remaining;
		if (remaining.value.length > 0) {
			return err(
				appError(
					"conflict_markers_malformed",
					"Resolving those conflicts would leave markers in the file, so nothing was written.",
				),
			);
		}
		const written = await this.#deps.fs.writeTextAtomic(resolved.value.absolute, applied.value);
		if (!written.ok) return err(appError("other", written.error.message, written.error));
		const staged = await this.#deps.git.runChecked(addPath(resolved.value.relative), {
			cwd: resolved.value.root,
		});
		if (staged.ok) return ok(undefined);
		// The file is already resolved on disk, so this is not a failed save.
		return err(
			appError(
				CONFLICT_SAVED_NOT_STAGED,
				`Saved "${relativePath}", but git could not stage it: ${staged.error.message}`,
				staged.error,
			),
		);
	}

	/** Reads the first page of the Artifacts tab, replacing the pages the tab held. */
	loadArtifacts(workspaceId: WorkspaceId): Promise<Result<void>> {
		this.#setArtifactsPage(workspaceId, (current) => ({
			...(current ?? EMPTY_ARTIFACTS_PAGE),
			loading: true,
			error: null,
		}));
		return this.#readArtifacts(workspaceId, null, true);
	}

	/** Backs `Actions.artifacts.loadMore`: appends the next page, or does nothing on the last one. */
	async loadMoreArtifacts(workspaceId: WorkspaceId): Promise<Result<void>> {
		const current = this.artifactsStore.getState().byWorkspace[workspaceId];
		if (current === undefined || current.loading || current.cursor === null) return ok(undefined);
		this.#setArtifactsPage(workspaceId, (state) => ({
			...(state ?? EMPTY_ARTIFACTS_PAGE),
			loading: true,
		}));
		return this.#readArtifacts(workspaceId, current.cursor, false);
	}

	/** The absolute path of an artifact, from its path relative to the `.context` folder. */
	async artifactPath(workspaceId: WorkspaceId, relativePath: string): Promise<Result<string>> {
		const checked = workspaceRelativePath(relativePath);
		if (!checked.ok) return checked;
		const root = await this.#rootOf(workspaceId);
		if (!root.ok) return root;
		return ok(`${contextFolderOf(root.value)}/${checked.value}`);
	}

	/** Backs `Actions.artifacts.upload`: copies the files into `.context`, then reads the first page. */
	async uploadArtifacts(workspaceId: WorkspaceId, paths: readonly string[]): Promise<Result<void>> {
		if (paths.length === 0) return ok(undefined);
		const root = await this.#rootOf(workspaceId);
		if (!root.ok) return root;
		const context = contextFolderOf(root.value);
		const made = await this.#deps.fs.mkdirp(context);
		if (!made.ok) return made;
		let failure: ReturnType<typeof appError> | null = null;
		for (const source of paths) {
			const name = source
				.split("/")
				.filter((part) => part !== "")
				.at(-1);
			if (name === undefined) {
				failure ??= appError("artifact_copy_failed", `"${source}" is not a file.`);
				continue;
			}
			const target = `${context}/${name}`;
			if (await this.#deps.fs.exists(target)) {
				failure ??= appError(
					"artifact_exists",
					`"${name}" is already in the .context folder. Rename the file and upload it again.`,
				);
				continue;
			}
			const copied = await copyFileKeepingMode(this.#deps.shell, source, target);
			if (!copied.ok) {
				failure ??=
					copied.error.code === FILE_COPY_FAILED
						? appError("artifact_copy_failed", `Could not copy "${name}": ${copied.error.message}`)
						: copied.error;
			}
		}
		const read = await this.loadArtifacts(workspaceId);
		if (failure !== null) return err(failure);
		return read;
	}

	/** Reads one page and lets only the newest answer for the workspace write the store. */
	async #readArtifacts(
		workspaceId: WorkspaceId,
		cursor: string | null,
		replace: boolean,
	): Promise<Result<void>> {
		const ticket = this.#artifactReads.begin(workspaceId);
		const root = await this.#rootOf(workspaceId);
		if (!this.#artifactReads.isLatest(ticket)) return ok(undefined);
		if (!root.ok) {
			this.#artifactReads.settle(ticket);
			this.#failArtifactsPage(workspaceId, replace, root.error);
			return root;
		}
		const page = await this.#deps.search.listArtifacts(root.value, {
			cursor,
			limit: ARTIFACTS_PAGE_SIZE,
		});
		if (!this.#artifactReads.isLatest(ticket)) return ok(undefined);
		this.#artifactReads.settle(ticket);
		if (!page.ok) {
			this.#failArtifactsPage(workspaceId, replace, page.error);
			return page;
		}
		const context = contextFolderOf(root.value);
		const entries = page.value.entries
			.map((entry) => artifactEntryFrom(context, entry))
			.filter((entry): entry is ArtifactEntry => entry !== null);
		this.#setArtifactsPage(workspaceId, (current) => {
			const base = current ?? EMPTY_ARTIFACTS_PAGE;
			return {
				entries: replace ? entries : [...base.entries, ...entries],
				hasMore: page.value.nextCursor !== null,
				// The platform counts the whole folder on every page, so the newest total stands.
				omitted: page.value.omitted,
				cursor: page.value.nextCursor,
				loading: false,
				error: null,
			};
		});
		return ok(undefined);
	}

	#failArtifactsPage(
		workspaceId: WorkspaceId,
		replace: boolean,
		error: ReturnType<typeof appError>,
	): void {
		this.#setArtifactsPage(workspaceId, (current) => {
			const base = current ?? EMPTY_ARTIFACTS_PAGE;
			return replace
				? { ...EMPTY_ARTIFACTS_PAGE, error }
				: { ...base, loading: false, error: null };
		});
	}

	#setArtifactsPage(
		workspaceId: WorkspaceId,
		update: (current: ArtifactsPageState | undefined) => ArtifactsPageState,
	): void {
		this.artifactsStore.setState((state) => ({
			byWorkspace: {
				...state.byWorkspace,
				[workspaceId]: update(state.byWorkspace[workspaceId]),
			},
		}));
	}

	/** Writes a file that was deleted on disk. Refused when it came back in the meantime. */
	async #writeAgain(
		workspaceId: WorkspaceId,
		relativePath: string,
		text: string,
	): Promise<Result<{ modifiedAt: number }>> {
		const resolved = await this.#resolve(workspaceId, relativePath);
		if (!resolved.ok) return resolved;
		const stat = await this.#deps.fs.stat(resolved.value.absolute);
		if (stat.ok) {
			return err(
				appError("changed_on_disk", `"${relativePath}" is back on disk with other content.`, {
					modifiedAt: stat.value.modifiedAt,
				}),
			);
		}
		if (stat.error.code !== "fs_not_found") return stat;
		const written = await this.#deps.fs.writeTextAtomic(resolved.value.absolute, text);
		if (!written.ok) return err(appError("other", written.error.message, written.error));
		const after = await this.#deps.fs.stat(resolved.value.absolute);
		if (!after.ok) return after;
		return ok({ modifiedAt: after.value.modifiedAt });
	}

	#setDraft(key: string, draft: FileDraft): void {
		this.drafts.setState((state) => ({ drafts: { ...state.drafts, [key]: draft } }));
	}

	#removeDraft(key: string): void {
		const { [key]: _removed, ...rest } = this.drafts.getState().drafts;
		this.drafts.setState({ drafts: rest });
	}

	async #rootOf(workspaceId: WorkspaceId): Promise<Result<string>> {
		const roots = await this.#deps.rootsOf(workspaceId);
		if (!roots.ok) return roots;
		const root = roots.value[0];
		if (root === undefined) {
			return err(appError("workspace_path_missing", "That workspace has no folder on this Mac."));
		}
		return ok(root);
	}

	/**
	 * Resolves a workspace-relative path against the first root that holds it. The checked path
	 * can never be absolute or climb with `..`, so the result stays inside one allowed root.
	 */
	async #resolve(workspaceId: WorkspaceId, relativePath: string): Promise<Result<ResolvedPath>> {
		const checked = workspaceRelativePath(relativePath);
		if (!checked.ok) return checked;
		const roots = await this.#deps.rootsOf(workspaceId);
		if (!roots.ok) return roots;
		if (roots.value.length === 0) {
			return err(appError("workspace_path_missing", "That workspace has no folder on this Mac."));
		}
		const candidates: ResolvedPath[] = roots.value.map((root) => ({
			root,
			relative: checked.value,
			absolute: `${trimRoot(root)}/${checked.value}`,
		}));
		for (const candidate of candidates) {
			if (await this.#deps.fs.exists(candidate.absolute)) return ok(candidate);
		}
		const first = candidates[0];
		if (first === undefined) {
			return err(appError("workspace_path_missing", "That workspace has no folder on this Mac."));
		}
		return ok(first);
	}
}
