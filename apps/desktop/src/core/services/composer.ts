/**
 * @feature COMP-01 Composer data: drafts that survive restarts and attachments
 * Owns: the unsent text and attachments of each chat, saved as one JSON file per chat, and the
 * staging of attachments until a message is sent.
 * Behaviour: services-map.md 5A.6 (attachment kinds, local pipeline, paste rule, sweep of old
 * staging folders), 2.7.2 (drafts have a size limit), ui-map.md 3.5 (composer).
 * Must handle: saving is debounced and the newest text wins (an older write that finishes late
 * is dropped); a crash between keystrokes loses at most the last debounce interval; an empty
 * draft removes its file; text pasted over 90 lines or 5000 characters becomes a text
 * attachment (setting `auto_convert_long_text`); a dropped file is copied to the staging folder
 * first, the original is never moved; sending copies staged files into the workspace's
 * `.context/attachments/<id>/` and flips them from draft to sent in one transaction; a failed
 * copy blocks the send with the file name in the message; draft files of deleted chats are
 * removed by the data-lifetime job.
 * Our design choice: drafts are files (see core/app-paths.ts) because migration 0001 has no
 * drafts table. Attachment rows use the existing `attachments` table.
 * Test first: classifyAttachment("shot.PNG") is "image" and convertsToAttachment(6000 chars) is true.
 */
import {
	appError,
	err,
	notImplemented,
	ok,
	type Result,
	type SessionId,
	type SnippetId,
	type TurnId,
	type WorkspaceId,
} from "@conducted/shared";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { Platform } from "../../platform/platform.ts";
import type { Draft, SnippetInput } from "../api.ts";
import { draftAttachmentsDir, draftFile, draftsDir } from "../app-paths.ts";
import type { Repositories } from "../db/repositories.ts";
import type { Attachment, Snippet } from "../model.ts";

export const PASTE_ATTACHMENT_MIN_LINES = 90;
export const PASTE_ATTACHMENT_MIN_CHARS = 5_000;
export const DRAFT_SAVE_DEBOUNCE_MS = 400;
/** The whole draft store holds at most 5 MiB, like Conductor's composer-drafts store. */
export const DRAFT_STORE_LIMIT_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 4.5 * 1024 * 1024;
export const MAX_IMAGE_DIMENSION = 7_800;

const IMAGE_EXTENSIONS = new Set([
	"png",
	"jpg",
	"jpeg",
	"gif",
	"webp",
	"tif",
	"tiff",
	"avif",
	"bmp",
]);
const TEXT_EXTENSIONS = new Set([
	"txt",
	"md",
	"markdown",
	"json",
	"jsonc",
	"yaml",
	"yml",
	"toml",
	"ini",
	"env",
	"csv",
	"tsv",
	"log",
	"ts",
	"tsx",
	"js",
	"jsx",
	"mjs",
	"cjs",
	"css",
	"scss",
	"html",
	"xml",
	"svg",
	"sql",
	"graphql",
	"py",
	"rb",
	"go",
	"rs",
	"java",
	"kt",
	"swift",
	"c",
	"h",
	"cpp",
	"hpp",
	"cs",
	"php",
	"sh",
	"zsh",
	"bash",
	"lua",
	"dockerfile",
	"makefile",
]);

export type AttachmentClass = Attachment["kind"];

/** Decides how an attachment is shown and sent, from its file name. */
export function classifyAttachment(fileName: string): AttachmentClass {
	const extension = fileName.includes(".") ? (fileName.split(".").pop() ?? "").toLowerCase() : "";
	if (IMAGE_EXTENSIONS.has(extension)) return "image";
	if (TEXT_EXTENSIONS.has(extension)) return "text";
	return "file";
}

/** True when pasted text is long enough to become an attachment instead of staying in the editor. */
export const convertsToAttachment = (text: string): boolean =>
	text.length > PASTE_ATTACHMENT_MIN_CHARS || text.split("\n").length > PASTE_ATTACHMENT_MIN_LINES;

/** Keeps a file name inside the staging folder. A name without an extension gets `.txt`. */
export function attachmentFileName(name: string): string {
	const cleaned = name.replace(/[/\\]/g, "-").replace(/\.\./g, "-").trim();
	const base = cleaned.length === 0 ? "terminal-selection" : cleaned;
	return base.includes(".") ? base : `${base}.txt`;
}

const emptyDraft = (): Draft => ({ text: "", attachmentPaths: [] });

const isBlank = (draft: Draft): boolean =>
	draft.text.length === 0 && draft.attachmentPaths.length === 0;

const copyDraft = (draft: Draft): Draft => ({
	text: draft.text,
	attachmentPaths: [...draft.attachmentPaths],
});

const parseDraftFile = (text: string): Result<Draft> => {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (cause) {
		return err(appError("draft_invalid", "The saved draft could not be read.", cause));
	}
	if (typeof parsed !== "object" || parsed === null) {
		return err(appError("draft_invalid", "The saved draft could not be read."));
	}
	const candidate = parsed as { text?: unknown; attachmentPaths?: unknown };
	const paths = candidate.attachmentPaths;
	if (
		typeof candidate.text !== "string" ||
		!Array.isArray(paths) ||
		!paths.every((path): path is string => typeof path === "string")
	) {
		return err(appError("draft_invalid", "The saved draft could not be read."));
	}
	return ok({ text: candidate.text, attachmentPaths: paths });
};

const byteLength = (text: string): number => new TextEncoder().encode(text).length;

export interface ComposerState {
	/** Drafts loaded so far. A missing entry means "not loaded yet", not "empty". */
	drafts: Readonly<Record<string, Draft>>;
}

export interface ComposerServiceDeps {
	platform: Pick<Platform, "fs" | "dialogs" | "clipboard">;
	repos: Pick<Repositories, "attachments">;
	setDebounce: (callback: () => void, ms: number) => () => void;
}

export class ComposerService {
	readonly store: StoreApi<ComposerState>;
	readonly #deps: ComposerServiceDeps;
	/** Cancels the pending debounced write of each chat. */
	readonly #pending = new Map<string, { cancel: () => void; generation: number }>();
	/** The newest write of each chat. An older write that finishes late cannot change it. */
	readonly #generation = new Map<string, number>();
	/** Writes of one chat run one after the other, so a clear cannot be overtaken by an old save. */
	readonly #writes = new Map<string, Promise<void>>();

	constructor(deps: ComposerServiceDeps) {
		this.#deps = deps;
		this.store = createStore<ComposerState>(() => ({ drafts: {} }));
	}

	/** The draft currently in the store, or an empty one before it is loaded. */
	draftOf(sessionId: SessionId): Draft {
		return this.store.getState().drafts[sessionId] ?? emptyDraft();
	}

	/** Reads a chat's draft file into the store. Called when the chat is first shown. */
	async loadDraft(sessionId: SessionId): Promise<Result<Draft>> {
		const loaded = this.store.getState().drafts[sessionId];
		if (loaded !== undefined) return ok(loaded);
		const revision = this.#generation.get(sessionId) ?? 0;
		const file = draftFile(this.#deps.platform.fs.paths, sessionId);
		const read = await this.#deps.platform.fs.readText(file);
		const changedMeanwhile = (this.#generation.get(sessionId) ?? 0) !== revision;
		if (changedMeanwhile) return ok(this.draftOf(sessionId));
		const saved = this.store.getState().drafts[sessionId];
		if (saved !== undefined) return ok(saved);
		if (!read.ok) {
			if (read.error.code !== "fs_not_found") return err(read.error);
			const draft = emptyDraft();
			this.#setDraft(sessionId, draft);
			return ok(draft);
		}
		const parsed = parseDraftFile(read.value);
		if (!parsed.ok) return parsed;
		this.#setDraft(sessionId, parsed.value);
		return ok(parsed.value);
	}

	/** Backs `Actions.sessions.saveDraft`: updates the store at once, writes the file after the debounce. */
	saveDraft(sessionId: SessionId, draft: Draft): void {
		const next = copyDraft(draft);
		this.#bump(sessionId);
		this.#setDraft(sessionId, next);
		const cancelled = this.#pending.get(sessionId);
		cancelled?.cancel();
		this.#pending.delete(sessionId);
		const generation = this.#generation.get(sessionId) ?? 0;
		if (isBlank(next)) {
			void this.#enqueue(sessionId, async () => {
				if (this.#generation.get(sessionId) !== generation) return;
				await this.#removeFile(sessionId);
			});
			return;
		}
		const cancel = this.#deps.setDebounce(() => {
			const pending = this.#pending.get(sessionId);
			if (pending?.generation !== generation) return;
			this.#pending.delete(sessionId);
			void this.#enqueue(sessionId, () => this.#writeDraft(sessionId, next, generation));
		}, DRAFT_SAVE_DEBOUNCE_MS);
		this.#pending.set(sessionId, { cancel, generation });
	}

	/** Copies a picked or dropped file into the staging folder and adds an attachment row. */
	addAttachment(_sessionId: SessionId, _sourcePath: string): Promise<Result<Attachment>> {
		return notImplemented("COMP-07");
	}

	/**
	 * Backs `Actions.attachments.add`: stages every file and returns where the copies are. A file
	 * that fails to copy fails the call with its name in the message; the files before it stay.
	 */
	addAttachments(_sessionId: SessionId, _sourcePaths: string[]): Promise<Result<string[]>> {
		return notImplemented("COMP-07");
	}

	/** Backs `Actions.files.attachToChat`: adds workspace files to the active chat's draft. */
	attachFilesToActiveChat(_workspaceId: WorkspaceId, _paths: string[]): Promise<Result<void>> {
		return notImplemented("REV-06");
	}

	/** Stores clipboard image bytes as a staged attachment. */
	addImageBytes(
		_sessionId: SessionId,
		_bytes: Uint8Array,
		_fileName: string,
	): Promise<Result<Attachment>> {
		return notImplemented("COMP-07");
	}

	removeAttachment(_sessionId: SessionId, _attachmentPath: string): Promise<Result<void>> {
		return notImplemented("COMP-07");
	}

	/**
	 * Copies staged attachments into the workspace, marks them as sent, and returns the final
	 * paths to put in the message. Runs before a message is sent.
	 */
	materializeForSend(_sessionId: SessionId, _workspacePath: string): Promise<Result<string[]>> {
		return notImplemented("COMP-07");
	}

	/** Clears the draft after a successful send. */
	async clearDraft(sessionId: SessionId): Promise<Result<void>> {
		this.#bump(sessionId);
		const pending = this.#pending.get(sessionId);
		pending?.cancel();
		this.#pending.delete(sessionId);
		const drafts = { ...this.store.getState().drafts };
		delete drafts[sessionId];
		this.store.setState({ drafts });
		return this.#enqueue(sessionId, () => this.#removeFile(sessionId));
	}

	#bump(sessionId: SessionId): void {
		this.#generation.set(sessionId, (this.#generation.get(sessionId) ?? 0) + 1);
	}

	#setDraft(sessionId: SessionId, draft: Draft): void {
		this.store.setState((state) => ({ drafts: { ...state.drafts, [sessionId]: draft } }));
	}

	#enqueue(sessionId: SessionId, work: () => Promise<void>): Promise<Result<void>> {
		const previous = this.#writes.get(sessionId) ?? Promise.resolve();
		const run = previous.then(work, work);
		const tracked = run.then(
			() => undefined,
			() => undefined,
		);
		this.#writes.set(sessionId, tracked);
		return run.then(
			() => ok(undefined),
			(cause: unknown) =>
				err(appError("draft_write_failed", "The draft could not be saved.", cause)),
		);
	}

	async #removeFile(sessionId: SessionId): Promise<void> {
		const file = draftFile(this.#deps.platform.fs.paths, sessionId);
		const exists = await this.#deps.platform.fs.exists(file);
		if (!exists) return;
		await this.#deps.platform.fs.trash(file);
	}

	async #writeDraft(sessionId: SessionId, draft: Draft, generation: number): Promise<void> {
		if (this.#generation.get(sessionId) !== generation) return;
		const text = JSON.stringify(draft);
		const bytes = byteLength(text);
		if (bytes > DRAFT_STORE_LIMIT_BYTES) return;
		const folder = draftsDir(this.#deps.platform.fs.paths);
		const made = await this.#deps.platform.fs.mkdirp(folder);
		if (!made.ok) return;
		await this.#makeRoom(sessionId, bytes);
		if (this.#generation.get(sessionId) !== generation) return;
		await this.#deps.platform.fs.writeTextAtomic(
			draftFile(this.#deps.platform.fs.paths, sessionId),
			text,
		);
	}

	/** Removes the oldest other drafts until the store can hold this one. */
	async #makeRoom(sessionId: SessionId, incomingBytes: number): Promise<void> {
		const listing = await this.#deps.platform.fs.readDir(draftsDir(this.#deps.platform.fs.paths));
		if (!listing.ok) return;
		const own = draftFile(this.#deps.platform.fs.paths, sessionId);
		const others = listing.value
			.filter((entry) => !entry.isDirectory && entry.path !== own)
			.sort((left, right) => left.modifiedAt - right.modifiedAt);
		let total = others.reduce((sum, entry) => sum + entry.size, 0);
		for (const entry of others) {
			if (total + incomingBytes <= DRAFT_STORE_LIMIT_BYTES) return;
			const removed = await this.#deps.platform.fs.trash(entry.path);
			if (removed.ok) total -= entry.size;
		}
	}

	/** Backs `Actions.attachments.addChatTranscript`. */
	addChatTranscript(_sessionId: SessionId, _fromSessionId: SessionId): Promise<Result<string>> {
		return notImplemented("CHAT-26");
	}

	/** Backs `Actions.attachments.addPlan`. */
	addPlan(
		_sessionId: SessionId,
		_plan: { sessionId: SessionId; turnId: TurnId },
	): Promise<Result<string>> {
		return notImplemented("CHAT-26");
	}

	/** Backs `Actions.attachments.addTerminalOutput`. */
	addTerminalOutput(_sessionId: SessionId): Promise<Result<string>> {
		return notImplemented("COMP-04");
	}

	/** Backs `Actions.attachments.addText`, for example a terminal selection. */
	async addText(sessionId: SessionId, fileName: string, text: string): Promise<Result<string>> {
		const name = attachmentFileName(fileName);
		const fs = this.#deps.platform.fs;
		const folder = draftAttachmentsDir(fs.paths, sessionId);
		const made = await fs.mkdirp(folder);
		if (!made.ok) return made;

		let path = `${folder}/${name}`;
		let suffix = 1;
		while (await fs.exists(path)) {
			const dot = name.lastIndexOf(".");
			const stem = dot === -1 ? name : name.slice(0, dot);
			const extension = dot === -1 ? "" : name.slice(dot);
			path = `${folder}/${stem}-${suffix}${extension}`;
			suffix += 1;
		}

		const written = await fs.writeTextAtomic(path, text);
		if (!written.ok) return written;
		const added = await this.#deps.repos.attachments.addDraft({
			sessionId,
			kind: "text",
			originalName: name,
			path,
			commentId: null,
		});
		if (!added.ok) return added;

		const draft = this.store.getState().drafts[sessionId];
		if (draft !== undefined) {
			this.store.setState((state) => ({
				drafts: {
					...state.drafts,
					[sessionId]: {
						...draft,
						attachmentPaths: [...draft.attachmentPaths, path],
					},
				},
			}));
		}
		return ok(path);
	}

	/** Backs `Actions.snippets.create`. A keyword another snippet uses is refused. */
	createSnippet(_input: SnippetInput): Promise<Result<Snippet>> {
		return notImplemented("COMP-09");
	}

	/** Backs `Actions.snippets.update`. */
	updateSnippet(_id: SnippetId, _input: SnippetInput): Promise<Result<void>> {
		return notImplemented("COMP-09");
	}

	/** Backs `Actions.snippets.remove`. */
	removeSnippet(_id: SnippetId): Promise<Result<void>> {
		return notImplemented("COMP-09");
	}
}
