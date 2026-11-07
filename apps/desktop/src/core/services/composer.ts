/**
 * @feature COMP-01 Composer data: drafts that survive restarts and attachments
 * @feature COMP-09 Prompt snippets
 * @feature CHAT-26 Start a chat with earlier chats and plans
 * Owns: the unsent text and attachments of each chat, saved as one JSON file per chat, the
 * staging of attachments until a message is sent, the saved snippets the composer inserts, and
 * attaching an earlier chat's transcript or an agent's plan.
 * The snippet list lives in this service's store and is read through `loadSnippets`, so the picker,
 * the editor trigger and the palette share one copy.
 * Behaviour: services-map.md 5A.6 (attachment kinds, local pipeline, paste rule, sweep of old
 * staging folders), 2.7.2 (drafts have a size limit), ui-map.md 3.5 (composer).
 * Must handle: saving is debounced and the newest text wins (an older write that finishes late
 * is dropped); a clear or save still writing finishes before a draft is read back; an empty
 * draft removes its file; text pasted over 90 lines or 5000 characters is classed as an
 * attachment by `convertsToAttachment` (the paste handler is in the COMP-07 attachments hook); a
 * failed write, a failed room-making pass or an oversized draft is kept in `store.errors` so a
 * screen can tell the user it did not save; the drafts folder is capped at 5 MiB by trashing the
 * oldest other drafts; another chat with no messages is refused with "No messages in this chat",
 * and a transcript or plan that cannot be read or written says "Failed to attach chat transcript"
 * or "Failed to attach plan". `savedDraftIds` lists which chats have a draft file with one folder
 * read, for the sidebar's draft markers (NAV-16).
 * Dropped or picked files, and the bytes of a pasted image (`addBytes`, COMP-07), are copied into
 * the chat's staging folder and get an attachment row; a
 * file named like one of the app's own context files is attached under another name. A
 * send copies each staged file into the workspace's `.context/attachments/<id>/<name>`, moves the
 * staging copy to the Trash and flips its row from draft to sent. `flush` writes every draft
 * still waiting for its debounce and waits for every write; the container's `stop` calls it, so
 * the last edit before quitting is kept. Draft files of deleted chats, and drafts older than 30
 * days, go to the Trash in the data-lifetime job (core/db/lifetime.ts, `remove-draft-files`).
 * Our design choice: drafts are files (see core/app-paths.ts) because migration 0001 has no
 * drafts table. Attachment rows use the existing `attachments` table.
 * One home for a draft attachment is its `attachments` row with `is_draft = 1`. The draft file's
 * `attachmentPaths` is a copy that must stay because the unsent text and its paths are saved
 * together: `#appendToDraft`, `saveDraft`, `removeAttachment` and `clearDraft` keep it in step with
 * the rows, and `composer.comp-07.test.ts` compares the two. `attachFilesToActiveChat` adds a
 * workspace file that is not staged, so that path has no row by design. A queued message keeps
 * its own list (`queued_messages.attachment_paths`) because the draft is cleared once the message
 * is queued; `materializeForSend` copies the list the message itself carries, not the draft's.
 * Test first: classifyAttachment("shot.PNG") is "image" and convertsToAttachment(6000 chars) is true.
 */
import {
	type AppError,
	appError,
	createKeyedQueue,
	err,
	ok,
	type Result,
	type SessionId,
	type SnippetId,
	type WorkspaceId,
} from "@conducted/shared";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { AttachmentFiles, MaterializedFile, Platform } from "../../platform/platform.ts";
import type { Draft, SnippetInput } from "../api.ts";
import {
	draftAttachmentsDir,
	draftAttachmentsRoot,
	draftFile,
	draftsDir,
	isInsideFolder,
} from "../app-paths.ts";
import { createSingleFlight } from "../async/single-flight.ts";
import type { Repositories } from "../db/repositories.ts";
import { trashIfPresent } from "../fs-helpers.ts";
import type { Attachment, Snippet } from "../model.ts";
import { createSnippetCache } from "./snippets-cache.ts";

export const PASTE_ATTACHMENT_MIN_LINES = 90;
export const PASTE_ATTACHMENT_MIN_CHARS = 5_000;
export const DRAFT_SAVE_DEBOUNCE_MS = 400;
/** The whole draft store holds at most 5 MiB, like Conductor's composer-drafts store. */
export const DRAFT_STORE_LIMIT_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 4.5 * 1024 * 1024;
export const MAX_IMAGE_DIMENSION = 7_800;
/** The composer refuses images over 5 MB before the Rust copy runs. */
export const MAX_IMAGE_ATTACHMENT_BYTES = 5 * 1024 * 1024;

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

/** The stored kind of a file. A PDF is its own kind; the rest follow the name rule above. */
export function attachmentKindOf(fileName: string): AttachmentClass {
	return fileName.toLowerCase().endsWith(".pdf") ? "pdf" : classifyAttachment(fileName);
}

/**
 * File names the app keeps for its own context files (services-map.md 5A.6.2 item 6, 5B.8.3): the PR,
 * review and fix-errors instructions, GitHub and Linear issue files, and terminal output.
 */
const RESERVED_CONTEXT_NAMES: readonly RegExp[] = [
	/^PR instructions\.md$/i,
	/^Review request\.md$/i,
	/^Fix errors instructions\.md$/i,
	/^\[GITHUB\]-\d+\.md$/i,
	/^\[LINEAR\]-\w{1,7}-\d+\.md$/i,
	/^terminal-output(-.*)?\.txt$/i,
];

/**
 * The name a user's picked, dropped or pasted file is attached under. A reserved context name cannot be
 * used, so the app would never take the user's file for its own.
 * Our design choice: such a file is renamed to `attached-<name>` instead of refused, so it still attaches.
 */
function userAttachmentName(name: string): string {
	return RESERVED_CONTEXT_NAMES.some((pattern) => pattern.test(name)) ? `attached-${name}` : name;
}

/** Keeps a file name inside the staging folder. A name without an extension gets `.txt`. */
export function attachmentFileName(name: string): string {
	const cleaned = name.replace(/[/\\]/g, "-").replace(/\.\./g, "-").trim();
	const base = cleaned.length === 0 ? "terminal-selection" : cleaned;
	return base.includes(".") ? base : `${base}.txt`;
}

/**
 * The file name an attached chat transcript is saved under (CHAT-26). Conductor names a chat with
 * no title "chat" here.
 */
export function chatTranscriptFileName(title: string | null): string {
	const trimmed = title?.trim() ?? "";
	return attachmentFileName(`Transcript of ${trimmed.length === 0 ? "chat" : trimmed}.md`);
}

/** The file name an attached plan is saved under: its title, as Markdown (CHAT-26). */
export function planFileName(title: string): string {
	return attachmentFileName(title.toLowerCase().endsWith(".md") ? title : `${title}.md`);
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
	/** The last failed write of each chat, so a screen can tell the user the draft did not save. */
	errors: Readonly<Record<string, AppError>>;
	/** The saved snippets read so far. Null until the first read answers. */
	snippets: Snippet[] | null;
	/** The last failed read of the snippet list. */
	snippetError: AppError | null;
}

export interface ComposerServiceDeps {
	platform: Pick<Platform, "fs" | "dialogs" | "clipboard"> & Partial<Pick<Platform, "attachments">>;
	repos: Pick<Repositories, "attachments" | "snippets">;
	setDebounce: (callback: () => void, ms: number) => () => void;
	/** The chat tab open in a workspace, for "Attach in chat" (REV-06). */
	activeSessionOf?: (workspaceId: WorkspaceId) => Result<SessionId | null>;
	/** The workspace terminal's screen text, or null when the workspace has no terminal. */
	terminalOutputOf?: (
		sessionId: SessionId,
	) => Promise<Result<{ text: string; source: string } | null>>;
	/** Another chat's title and concise transcript, for attaching it (CHAT-26). */
	transcriptOf?: (sessionId: SessionId) => Promise<Result<{ title: string | null; text: string }>>;
	/** The text of one plan an agent proposed, by its `PlanEntry.planId`, for attaching it (CHAT-26). */
	planOf?: (
		sessionId: SessionId,
		planId: string,
	) => Promise<Result<{ title: string; text: string }>>;
}

export class ComposerService {
	readonly store: StoreApi<ComposerState>;
	readonly #deps: ComposerServiceDeps;
	/** Cancels the pending debounced write of each chat. */
	readonly #pending = new Map<SessionId, { cancel: () => void; generation: number }>();
	/** The newest write of each chat. An older write that finishes late cannot change it. */
	readonly #generation = new Map<string, number>();
	/** Writes of one chat run one after the other, so a clear cannot be overtaken by an old save. */
	readonly #writes = createKeyedQueue<SessionId>();
	/** Every write not finished yet, so `flush` can wait for all of them. */
	readonly #inFlight = new Set<Promise<Result<void>>>();
	/** How many copies are running for each chat. A send waits until the count is zero. */
	readonly #busy = new Map<string, number>();
	/** The draft files found at the first listing of the drafts folder (NAV-16), once it worked. */
	#savedDraftIds: ReadonlySet<string> | null = null;
	/** Rows that ask for the listing at the same time share one. */
	readonly #listing = createSingleFlight<"drafts">();
	/** Reads the snippet list, keeping only the newest answer. */
	readonly #snippets: ReturnType<typeof createSnippetCache<ComposerState>>;

	constructor(deps: ComposerServiceDeps) {
		this.#deps = deps;
		this.store = createStore<ComposerState>(() => ({
			drafts: {},
			errors: {},
			snippets: null,
			snippetError: null,
		}));
		this.#snippets = createSnippetCache({
			store: this.store,
			list: () => this.#deps.repos.snippets.list(),
		});
	}

	/** The draft currently in the store, or an empty one before it is loaded. */
	draftOf(sessionId: SessionId): Draft {
		return this.store.getState().drafts[sessionId] ?? emptyDraft();
	}

	/** Reads a chat's draft file into the store. Called when the chat is first shown. */
	async loadDraft(sessionId: SessionId): Promise<Result<Draft>> {
		const loaded = this.store.getState().drafts[sessionId];
		if (loaded !== undefined) return ok(loaded);
		// A clear or save still writing must finish first, or the read could bring back a draft that
		// was just cleared.
		if (this.#writes.isBusy(sessionId)) await this.#writes.run(sessionId, async () => undefined);
		const stored = this.store.getState().drafts[sessionId];
		if (stored !== undefined) return ok(stored);
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

	/**
	 * The ids of the chats with a draft file on disk, from one listing of the drafts folder (NAV-16).
	 * The sidebar's draft markers load only these, so a sidebar of 300 workspaces costs one listing
	 * and one read per saved draft. Drafts written later are in the store already. No folder means
	 * no drafts. A failed listing is returned, and the next call lists again.
	 */
	savedDraftIds(): Promise<Result<ReadonlySet<string>>> {
		const known = this.#savedDraftIds;
		if (known !== null) return Promise.resolve(ok(known));
		return this.#listing.run("drafts", async (): Promise<Result<ReadonlySet<string>>> => {
			const listing = await this.#deps.platform.fs.readDir(draftsDir(this.#deps.platform.fs.paths));
			if (!listing.ok && listing.error.code !== "fs_not_found") return err(listing.error);
			const ids = new Set<string>();
			for (const entry of listing.ok ? listing.value : []) {
				if (entry.isDirectory) continue;
				const name = entry.path.slice(entry.path.lastIndexOf("/") + 1);
				if (name.endsWith(".json")) ids.add(name.slice(0, -".json".length));
			}
			this.#savedDraftIds = ids;
			return ok(ids);
		});
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
			void this.#enqueue(sessionId, async () =>
				this.#generation.get(sessionId) === generation
					? this.#removeFile(sessionId)
					: ok(undefined),
			);
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

	/**
	 * Writes every draft still waiting for its debounce now, and waits until every write has
	 * finished. The container calls it when the app stops, so the last edit before quitting is kept.
	 */
	async flush(): Promise<void> {
		for (const [sessionId, pending] of [...this.#pending]) {
			pending.cancel();
			this.#pending.delete(sessionId);
			const draft = this.store.getState().drafts[sessionId];
			if (draft === undefined) continue;
			void this.#enqueue(sessionId, () => this.#writeDraft(sessionId, draft, pending.generation));
		}
		await Promise.all([...this.#inFlight]);
	}

	/** Copies a picked or dropped file into the staging folder and adds an attachment row. */
	async addAttachment(sessionId: SessionId, sourcePath: string): Promise<Result<Attachment>> {
		this.#beginBusy(sessionId);
		try {
			return await this.#addAttachment(sessionId, sourcePath);
		} finally {
			this.#endBusy(sessionId);
		}
	}

	async #addAttachment(sessionId: SessionId, sourcePath: string): Promise<Result<Attachment>> {
		const loaded = await this.loadDraft(sessionId);
		if (!loaded.ok) return loaded;
		const fs = this.#deps.platform.fs;
		const stat = await fs.stat(sourcePath);
		if (!stat.ok) {
			return err(appError("attachment_unavailable", "Attachments not available", stat.error));
		}
		if (stat.value.isDirectory) {
			return err(appError("attachment_is_directory", "Folders can't be uploaded"));
		}
		const originalName = userAttachmentName(sourcePath.split("/").pop() ?? sourcePath);
		return this.#stage(
			sessionId,
			originalName,
			stat.value.size,
			(files, destination, resizeImage) =>
				files.materialize(sourcePath, destination, { resizeImage }),
		);
	}

	/**
	 * Stages bytes the web view holds, such as a pasted image or screenshot, under `fileName` and
	 * adds an attachment row (COMP-07). The rules for a dropped file apply.
	 */
	async addBytes(
		sessionId: SessionId,
		fileName: string,
		bytes: Uint8Array,
	): Promise<Result<Attachment>> {
		this.#beginBusy(sessionId);
		try {
			const loaded = await this.loadDraft(sessionId);
			if (!loaded.ok) return loaded;
			if (fileName.trim().length === 0) {
				return err(appError("attachment_unavailable", "Attachments not available"));
			}
			return await this.#stage(
				sessionId,
				userAttachmentName(fileName),
				bytes.length,
				(files, destination, resizeImage) => files.writeBytes(bytes, destination, { resizeImage }),
			);
		} finally {
			this.#endBusy(sessionId);
		}
	}

	/**
	 * Writes one file into the chat's staging folder with `write`, adds its attachment row and puts
	 * it on the draft. An image over 5 MB is refused before anything is written.
	 */
	async #stage(
		sessionId: SessionId,
		originalName: string,
		sizeBytes: number,
		write: (
			files: AttachmentFiles,
			destination: string,
			resizeImage: boolean,
		) => Promise<Result<MaterializedFile>>,
	): Promise<Result<Attachment>> {
		const fs = this.#deps.platform.fs;
		const kind = attachmentKindOf(originalName);
		if (kind === "image" && sizeBytes > MAX_IMAGE_ATTACHMENT_BYTES) {
			return err(appError("attachment_too_large", "Image too large"));
		}
		const files = this.#deps.platform.attachments;
		if (files === undefined) {
			return err(appError("attachment_unavailable", "Attachments not available"));
		}
		const folder = draftAttachmentsDir(fs.paths, sessionId);
		const made = await fs.mkdirp(folder);
		if (!made.ok) return made;
		const destination = await this.#freePath(folder, attachmentFileName(originalName));
		const materialized = await write(files, destination, kind === "image");
		if (!materialized.ok) return err(this.#copyError(materialized.error));
		const added = await this.#deps.repos.attachments.addDraft({
			sessionId,
			kind,
			originalName,
			path: materialized.value.path,
			commentId: null,
		});
		if (!added.ok) {
			await trashIfPresent(fs, materialized.value.path);
			return added;
		}
		this.#appendToDraft(sessionId, added.value.path);
		return ok(added.value);
	}

	/**
	 * Backs `Actions.attachments.add`: stages every file and returns where the copies are. A file
	 * that fails to copy fails the call with its name in the message; the files before it stay.
	 */
	async addAttachments(sessionId: SessionId, sourcePaths: string[]): Promise<Result<string[]>> {
		this.#beginBusy(sessionId);
		try {
			const paths: string[] = [];
			let failure: AppError | null = null;
			for (const sourcePath of sourcePaths) {
				const added = await this.#addAttachment(sessionId, sourcePath);
				if (added.ok) paths.push(added.value.path);
				else if (failure === null) failure = added.error;
			}
			return failure === null ? ok(paths) : err(failure);
		} finally {
			this.#endBusy(sessionId);
		}
	}

	/** Backs `Actions.files.attachToChat`: adds workspace files to the active chat's draft. */
	async attachFilesToActiveChat(workspaceId: WorkspaceId, paths: string[]): Promise<Result<void>> {
		const activeSessionOf = this.#deps.activeSessionOf;
		if (activeSessionOf === undefined) {
			return err(appError("no_active_chat", "Open a chat first."));
		}
		const active = activeSessionOf(workspaceId);
		if (!active.ok) return active;
		const sessionId = active.value;
		if (sessionId === null) {
			return err(appError("no_active_chat", "Open a chat first."));
		}
		for (const path of paths) {
			if (!(await this.#deps.platform.fs.exists(path))) {
				return err(appError("attachment_missing", `"${path}" is no longer in the workspace.`));
			}
		}
		const loaded = await this.loadDraft(sessionId);
		if (!loaded.ok) return loaded;
		const draft = this.draftOf(sessionId);
		const attachmentPaths = [...draft.attachmentPaths];
		for (const path of paths) {
			if (!attachmentPaths.includes(path)) attachmentPaths.push(path);
		}
		this.saveDraft(sessionId, { text: draft.text, attachmentPaths });
		return ok(undefined);
	}

	/** Removes one draft attachment, moves its staged file to the Trash and updates the draft. */
	async removeAttachment(sessionId: SessionId, attachmentPath: string): Promise<Result<void>> {
		const loaded = await this.loadDraft(sessionId);
		if (!loaded.ok) return loaded;
		const listed = await this.#deps.repos.attachments.listDraftsBySession(sessionId);
		if (!listed.ok) return listed;
		const row = listed.value.find((entry) => entry.path === attachmentPath);
		if (row !== undefined) {
			const removed = await this.#deps.repos.attachments.removeDraft(sessionId, row.id);
			if (!removed.ok) return removed;
		}
		const fs = this.#deps.platform.fs;
		if (isInsideFolder(draftAttachmentsRoot(fs.paths), attachmentPath)) {
			const trashed = await trashIfPresent(fs, attachmentPath);
			if (!trashed.ok) return trashed;
		}
		const draft = this.store.getState().drafts[sessionId];
		if (draft !== undefined) {
			this.store.setState((state) => ({
				drafts: {
					...state.drafts,
					[sessionId]: {
						...draft,
						attachmentPaths: draft.attachmentPaths.filter((path) => path !== attachmentPath),
					},
				},
			}));
		}
		return ok(undefined);
	}

	/**
	 * Copies the staged files a message carries into the workspace, marks their rows as sent with
	 * `messageId`, and returns the final paths to put in the message. The caller passes the paths
	 * the message itself holds: a new message takes the draft's list, and a queued row keeps its
	 * own after the draft is cleared. Runs before a message is sent.
	 */
	async materializeForSend(
		sessionId: SessionId,
		workspacePath: string,
		messageId: string,
		attachmentPaths: readonly string[],
	): Promise<Result<string[]>> {
		if ((this.#busy.get(sessionId) ?? 0) > 0) {
			return err(appError("attachment_processing", "Wait for attachments to finish processing."));
		}
		if (attachmentPaths.length === 0) return ok([]);
		const listed = await this.#deps.repos.attachments.listDraftsBySession(sessionId);
		if (!listed.ok) return listed;
		const files = this.#deps.platform.attachments;
		if (files === undefined) {
			return err(appError("attachment_unavailable", "Attachments not available"));
		}
		const fs = this.#deps.platform.fs;
		const finalPaths: string[] = [];
		const sent: Attachment["id"][] = [];
		for (const path of attachmentPaths) {
			const row = listed.value.find((entry) => entry.path === path);
			if (row === undefined) {
				if (!(await fs.exists(path))) {
					return err(appError("attachment_unavailable", "Attachments not available"));
				}
				finalPaths.push(path);
				continue;
			}
			const source = await fs.stat(path);
			if (!source.ok) {
				return err(appError("attachment_unavailable", "Attachments not available", source.error));
			}
			const folder = `${workspacePath}/.context/attachments/${row.id}`;
			const made = await fs.mkdirp(folder);
			if (!made.ok) return made;
			const destination = `${folder}/${attachmentFileName(row.originalName)}`;
			let finalPath = destination;
			if (!(await fs.exists(destination))) {
				const materialized = await files.materialize(path, destination, {
					resizeImage: row.kind === "image",
				});
				if (!materialized.ok) return err(this.#copyError(materialized.error));
				finalPath = materialized.value.path;
			}
			if (isInsideFolder(draftAttachmentsRoot(fs.paths), path)) {
				const trashed = await trashIfPresent(fs, path);
				if (!trashed.ok) return trashed;
			}
			const saved = await this.#deps.repos.attachments.setPath(row.id, finalPath);
			if (!saved.ok) return saved;
			sent.push(row.id);
			finalPaths.push(finalPath);
		}
		if (sent.length > 0) {
			const attached = await this.#deps.repos.attachments.attachDrafts(sessionId, messageId, sent);
			if (!attached.ok) return attached;
		}
		return ok(finalPaths);
	}

	/** Clears the draft after a successful send. The staged files move when the message is sent. */
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

	#beginBusy(sessionId: SessionId): void {
		this.#busy.set(sessionId, (this.#busy.get(sessionId) ?? 0) + 1);
	}

	#endBusy(sessionId: SessionId): void {
		const next = (this.#busy.get(sessionId) ?? 0) - 1;
		if (next <= 0) this.#busy.delete(sessionId);
		else this.#busy.set(sessionId, next);
	}

	/** Keeps an added path in the loaded draft, so a send and a screen see the same list. */
	#appendToDraft(sessionId: SessionId, path: string): void {
		const draft = this.store.getState().drafts[sessionId];
		if (draft === undefined) return;
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

	/** A path in `folder` that no other file uses yet. */
	async #freePath(folder: string, name: string): Promise<string> {
		const fs = this.#deps.platform.fs;
		let path = `${folder}/${name}`;
		let suffix = 1;
		while (await fs.exists(path)) {
			const dot = name.lastIndexOf(".");
			const stem = dot === -1 ? name : name.slice(0, dot);
			const extension = dot === -1 ? "" : name.slice(dot);
			path = `${folder}/${stem}-${suffix}${extension}`;
			suffix += 1;
		}
		return path;
	}

	/** Turns a Rust copy failure into the message the user sees. */
	#copyError(error: AppError): AppError {
		if (error.code === "attachment_is_directory") {
			return appError(error.code, "Folders can't be uploaded", error);
		}
		if (error.code === "attachment_too_large") {
			return appError(error.code, "Image too large", error);
		}
		if (error.code === "attachment_missing") {
			return appError("attachment_unavailable", "Attachments not available", error);
		}
		return error;
	}

	#bump(sessionId: SessionId): void {
		this.#generation.set(sessionId, (this.#generation.get(sessionId) ?? 0) + 1);
	}

	#setDraft(sessionId: SessionId, draft: Draft): void {
		this.store.setState((state) => ({ drafts: { ...state.drafts, [sessionId]: draft } }));
	}

	#enqueue(sessionId: SessionId, work: () => Promise<Result<void>>): Promise<Result<void>> {
		const recorded = this.#writes.run(sessionId, work).then(
			(result) => {
				this.#recordWrite(sessionId, result);
				return result;
			},
			(cause: unknown) => {
				const failure = err(appError("draft_write_failed", "The draft could not be saved.", cause));
				this.#recordWrite(sessionId, failure);
				return failure;
			},
		);
		this.#inFlight.add(recorded);
		const forget = (): void => {
			this.#inFlight.delete(recorded);
		};
		void recorded.then(forget, forget);
		return recorded;
	}

	/** Keeps the newest write error per chat so a screen can surface a failed save. */
	#recordWrite(sessionId: SessionId, result: Result<void>): void {
		const previous = this.store.getState().errors[sessionId];
		const errors = { ...this.store.getState().errors };
		if (result.ok) {
			if (previous === undefined) return;
			delete errors[sessionId];
			this.store.setState({ errors });
			return;
		}
		errors[sessionId] = result.error;
		this.store.setState({ errors });
	}

	async #removeFile(sessionId: SessionId): Promise<Result<void>> {
		const file = draftFile(this.#deps.platform.fs.paths, sessionId);
		const exists = await this.#deps.platform.fs.exists(file);
		if (!exists) return ok(undefined);
		return this.#deps.platform.fs.trash(file);
	}

	async #writeDraft(sessionId: SessionId, draft: Draft, generation: number): Promise<Result<void>> {
		if (this.#generation.get(sessionId) !== generation) return ok(undefined);
		const text = JSON.stringify(draft);
		const bytes = byteLength(text);
		if (bytes > DRAFT_STORE_LIMIT_BYTES) {
			return err(
				appError(
					"draft_too_large",
					"This draft is too large to save. Shorten it or attach a file instead.",
				),
			);
		}
		const folder = draftsDir(this.#deps.platform.fs.paths);
		const made = await this.#deps.platform.fs.mkdirp(folder);
		if (!made.ok) return made;
		const room = await this.#makeRoom(sessionId, bytes);
		if (!room.ok) return room;
		if (this.#generation.get(sessionId) !== generation) return ok(undefined);
		return this.#deps.platform.fs.writeTextAtomic(
			draftFile(this.#deps.platform.fs.paths, sessionId),
			text,
		);
	}

	/** Removes the oldest other drafts until the store can hold this one. */
	async #makeRoom(sessionId: SessionId, incomingBytes: number): Promise<Result<void>> {
		const listing = await this.#deps.platform.fs.readDir(draftsDir(this.#deps.platform.fs.paths));
		if (!listing.ok) return listing;
		const own = draftFile(this.#deps.platform.fs.paths, sessionId);
		const others = listing.value
			.filter((entry) => !entry.isDirectory && entry.path !== own)
			.sort((left, right) => left.modifiedAt - right.modifiedAt);
		let total = others.reduce((sum, entry) => sum + entry.size, 0);
		for (const entry of others) {
			if (total + incomingBytes <= DRAFT_STORE_LIMIT_BYTES) return ok(undefined);
			const removed = await this.#deps.platform.fs.trash(entry.path);
			if (!removed.ok) return removed;
			total -= entry.size;
		}
		return ok(undefined);
	}

	/** Backs `Actions.attachments.addChatTranscript`. */
	async addChatTranscript(sessionId: SessionId, fromSessionId: SessionId): Promise<Result<string>> {
		const read = this.#deps.transcriptOf;
		if (read === undefined) {
			return err(appError("chat_transcript_failed", "Failed to attach chat transcript"));
		}
		const transcript = await read(fromSessionId);
		if (!transcript.ok) {
			return err(
				appError("chat_transcript_failed", "Failed to attach chat transcript", transcript.error),
			);
		}
		if (transcript.value.text.trim().length === 0) {
			return err(appError("chat_transcript_empty", "No messages in this chat"));
		}
		const attached = await this.addText(
			sessionId,
			chatTranscriptFileName(transcript.value.title),
			transcript.value.text,
		);
		if (!attached.ok) {
			return err(
				appError("chat_transcript_failed", "Failed to attach chat transcript", attached.error),
			);
		}
		return attached;
	}

	/** Backs `Actions.attachments.addPlan`. */
	async addPlan(
		sessionId: SessionId,
		plan: { sessionId: SessionId; planId: string },
	): Promise<Result<string>> {
		const read = this.#deps.planOf;
		if (read === undefined) {
			return err(appError("chat_plan_failed", "Failed to attach plan"));
		}
		const found = await read(plan.sessionId, plan.planId);
		if (!found.ok) {
			return err(appError("chat_plan_failed", "Failed to attach plan", found.error));
		}
		const attached = await this.addText(
			sessionId,
			planFileName(found.value.title),
			found.value.text,
		);
		if (!attached.ok) {
			return err(appError("chat_plan_failed", "Failed to attach plan", attached.error));
		}
		return attached;
	}

	/** Backs `Actions.attachments.addTerminalOutput`. */
	async addTerminalOutput(sessionId: SessionId): Promise<Result<string>> {
		const outputOf = this.#deps.terminalOutputOf;
		if (outputOf === undefined) {
			return err(
				appError("terminal_output_unavailable", "No terminal output available for this workspace"),
			);
		}
		const output = await outputOf(sessionId);
		if (!output.ok) return output;
		if (output.value === null || output.value.text.trim().length === 0) {
			return err(
				appError("terminal_output_unavailable", "No terminal output available for this workspace"),
			);
		}
		const attached = await this.addText(sessionId, "terminal-output", output.value.text);
		if (!attached.ok) {
			return err(
				appError("terminal_output_failed", "Failed to attach terminal output", attached.error),
			);
		}
		return attached;
	}

	/** Backs `Actions.attachments.addText`, for example a terminal selection. */
	async addText(sessionId: SessionId, fileName: string, text: string): Promise<Result<string>> {
		const loaded = await this.loadDraft(sessionId);
		if (!loaded.ok) return loaded;
		const name = attachmentFileName(fileName);
		const fs = this.#deps.platform.fs;
		const folder = draftAttachmentsDir(fs.paths, sessionId);
		const made = await fs.mkdirp(folder);
		if (!made.ok) return made;

		const path = await this.#freePath(folder, name);
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

		this.#appendToDraft(sessionId, path);
		return ok(path);
	}

	/** Reads the user's snippets into the store, keeping only the newest answer. */
	async loadSnippets(): Promise<void> {
		await this.#snippets.load();
	}

	/** Backs `Actions.snippets.create`. A keyword another snippet uses is refused. */
	async createSnippet(input: SnippetInput): Promise<Result<Snippet>> {
		const created = await this.#deps.repos.snippets.create(normalizedSnippet(input));
		if (created.ok) await this.#snippets.load();
		return created;
	}

	/** Backs `Actions.snippets.update`. */
	async updateSnippet(id: SnippetId, input: SnippetInput): Promise<Result<void>> {
		const updated = await this.#deps.repos.snippets.update(id, normalizedSnippet(input));
		if (updated.ok) await this.#snippets.load();
		return updated;
	}

	/** Backs `Actions.snippets.remove`. */
	async removeSnippet(id: SnippetId): Promise<Result<void>> {
		const removed = await this.#deps.repos.snippets.delete(id);
		if (removed.ok) await this.#snippets.load();
		return removed;
	}
}

/** Trims the name and keyword the way the repository expects; a blank keyword means none. */
function normalizedSnippet(input: SnippetInput): SnippetInput {
	const keyword = input.keyword?.trim() ?? "";
	return {
		name: input.name.trim(),
		keyword: keyword === "" ? null : keyword,
		prompt: input.prompt,
	};
}
