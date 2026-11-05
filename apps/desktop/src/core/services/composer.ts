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
import { draftAttachmentsDir } from "../app-paths.ts";
import type { Repositories } from "../db/repositories.ts";
import type { Attachment, Snippet } from "../model.ts";

export const PASTE_ATTACHMENT_MIN_LINES = 90;
export const PASTE_ATTACHMENT_MIN_CHARS = 5_000;
export const DRAFT_SAVE_DEBOUNCE_MS = 400;
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

	constructor(deps: ComposerServiceDeps) {
		this.#deps = deps;
		this.store = createStore<ComposerState>(() => ({ drafts: {} }));
	}

	/** Reads a chat's draft file into the store. Called when the chat is first shown. */
	loadDraft(_sessionId: SessionId): Promise<Result<Draft>> {
		void this.#deps;
		return notImplemented("COMP-01");
	}

	/** Backs `Actions.sessions.saveDraft`: updates the store at once, writes the file after the debounce. */
	saveDraft(_sessionId: SessionId, _draft: Draft): void {
		notImplemented("COMP-01");
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
	clearDraft(_sessionId: SessionId): Promise<Result<void>> {
		return notImplemented("COMP-01");
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
