/**
 * @feature REV-03 Review: diff comments and AI review
 * Owns: the review comments on a workspace's diff (load, add, edit, resolve, remove, send to
 * chat), the reads and writes behind the agent's GetDiffComments and DiffComment tools, and
 * starting an AI review chat.
 * Behaviour: services-map.md 5A.7.1 and 5A.7.2 (comment store, agent tools), 5A.6.4 (a comment
 * sent to chat is written as a file), ui-map.md 3.6 (inline comments), 5.1 ("Start review").
 * Must handle: every change writes the database first and then re-reads the workspace rows; a
 * load runs once per workspace and only the newest read writes the store; writes for one
 * workspace run in order, so an insert finishes before a later write; an inactive (outdated or
 * resolved) comment cannot be sent to chat; sending to chat writes each comment as a small file
 * in the workspace; editing a comment that was sent rewrites its file; the AI review creates a
 * new chat with the review model and sends the review instruction, using the repository's review
 * prompt when it has one.
 * Not built here: GitHub sync and the hidden/ready/reviewed states are REV-04 and REV-12, so
 * sending to chat does not mark a comment reviewed. A comment's side, its suggested change and its
 * place in a reply thread are stored by the repositories but not yet taken by `add`, whose screen
 * API (core/api.ts) has no parameters for them.
 * Our design choice: sending to chat asks the active chat through AgentMessenger, because the
 * composer's attachment pipeline belongs to COMP-01.
 * Test first: create, edit, resolve and remove each write SQLite and re-read the workspace rows.
 */
import { join } from "node:path";
import { formatFileMention } from "@conducted/protocol";
import {
	appError,
	type CommentId,
	err,
	notImplemented,
	ok,
	type Result,
	type WorkspaceId,
} from "@conducted/shared";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { FileSystem } from "../../platform/platform.ts";
import { createLatestWins } from "../async/latest-wins.ts";
import { createKeyedQueue } from "../async/serial-queue.ts";
import type { Repositories } from "../db/repositories.ts";
import type { GitRunner } from "../git/runner.ts";
import type { DiffComment, Session } from "../model.ts";
import { aiReviewInstruction } from "./agent-instructions.ts";
import type { AgentMessenger } from "./sessions.ts";

export interface ReviewState {
	byWorkspace: Readonly<Record<string, readonly DiffComment[]>>;
	errors: Readonly<Record<string, { code: string; message: string }>>;
}

export interface ReviewServiceDeps {
	repos: Pick<Repositories, "diffComments">;
	git: GitRunner;
	agent: AgentMessenger;
	fs: Pick<FileSystem, "mkdirp" | "writeTextAtomic" | "exists">;
	/** Folder of the workspace, where `.context` and its comment files live. */
	workspacePathOf: (workspaceId: WorkspaceId) => Promise<Result<string>>;
	/** The repository's custom review prompt, or null when it has none. */
	customPromptOf: (workspaceId: WorkspaceId) => Promise<Result<string | null>>;
	/** Creates a chat with the review model and sends the text. */
	startReviewChat: (workspaceId: WorkspaceId, text: string) => Promise<Result<Session>>;
}

const COMMENT_FOLDER = join(".context", "attachments", "comments");

function commentFileName(id: CommentId): string {
	return `${encodeURIComponent(id)}.md`;
}

function locationText(comment: DiffComment): string {
	if (comment.filePath === null) return "on the pull request itself";
	if (comment.line === null) return "on a file";
	return comment.side === "deletions" ? "left on the base branch" : "left on the modified branch";
}

function originText(comment: DiffComment): string {
	const name = comment.author.name;
	if (comment.author.kind === "github") {
		return name === null ? "left on GitHub" : `left on GitHub by @${name}`;
	}
	if (comment.author.kind === "agent") {
		return name === null ? "left locally by an agent" : `left locally by ${name}`;
	}
	return "created locally in Conductor by the user";
}

function commentFileText(comment: DiffComment): string {
	const lines =
		comment.line === null
			? "no line"
			: comment.endLine === null || comment.endLine === comment.line
				? String(comment.line)
				: `${comment.line}-${comment.endLine}`;
	const identifier =
		comment.author.kind === "github"
			? `GitHub review comment ID: ${comment.id}`
			: `Conductor local comment ID: ${comment.id}`;
	const parts = [
		identifier,
		`File: ${comment.filePath ?? ""}`,
		`Lines: ${lines}`,
		`Location: ${locationText(comment)}`,
		`Origin: ${originText(comment)}`,
	];
	if (comment.threadId !== null) parts.push(`Thread: ${comment.threadId}`);
	if (comment.remoteUrl !== null) parts.push(`Remote URL: ${comment.remoteUrl}`);
	parts.push(`Outdated: ${comment.outdated ? "yes" : "no"}`);
	parts.push(`Resolved: ${comment.resolved ? "yes" : "no"}`);
	parts.push("", "## Comment", comment.body);
	return `${parts.join("\n")}\n`;
}

function inactiveComment(): Result<never> {
	return err(
		appError(
			"review_comment_inactive",
			"Resolved or outdated comments cannot be added to the chat.",
		),
	);
}

export class ReviewService {
	readonly store: StoreApi<ReviewState>;
	readonly #deps: ReviewServiceDeps;
	readonly #reads = createLatestWins<WorkspaceId>();
	readonly #writes = createKeyedQueue<WorkspaceId>();

	constructor(deps: ReviewServiceDeps) {
		this.#deps = deps;
		this.store = createStore<ReviewState>(() => ({ byWorkspace: {}, errors: {} }));
	}

	/** Loads the comments of a workspace into the store, once. */
	async load(workspaceId: WorkspaceId): Promise<Result<void>> {
		if (this.store.getState().byWorkspace[workspaceId] !== undefined) return ok(undefined);
		return this.#read(workspaceId);
	}

	/** Reads the workspace rows and lets only the newest answer write the store. */
	async #read(workspaceId: WorkspaceId): Promise<Result<void>> {
		const ticket = this.#reads.begin(workspaceId);
		const read = await this.#deps.repos.diffComments.listByWorkspace(workspaceId);
		if (!this.#reads.isLatest(ticket)) return ok(undefined);
		this.#reads.settle(ticket);
		if (!read.ok) {
			this.store.setState((state) => ({
				errors: {
					...state.errors,
					[workspaceId]: { code: read.error.code, message: read.error.message },
				},
			}));
			return read;
		}
		this.store.setState((state) => {
			const errors = { ...state.errors };
			delete errors[workspaceId];
			return {
				byWorkspace: { ...state.byWorkspace, [workspaceId]: read.value },
				errors,
			};
		});
		return ok(undefined);
	}

	/** A null file makes a comment on the pull request itself (REV-13). */
	async add(
		workspaceId: WorkspaceId,
		file: string | null,
		line: number | null,
		endLine: number | null,
		body: string,
	): Promise<Result<DiffComment>> {
		return this.#writes.run(workspaceId, async () => {
			const added = await this.#deps.repos.diffComments.add({
				workspaceId,
				filePath: file,
				line,
				endLine,
				body,
				author: { kind: "user", name: null, avatarUrl: null },
				side: "additions",
				threadId: null,
				replyToId: null,
				suggestion: null,
			});
			if (!added.ok) return added;
			const refreshed = await this.#read(workspaceId);
			return refreshed.ok ? ok(added.value) : refreshed;
		});
	}

	async edit(id: CommentId, body: string): Promise<Result<void>> {
		const found = await this.#deps.repos.diffComments.get(id);
		if (!found.ok) return found;
		if (found.value === null)
			return err(appError("db.not_found", "That comment no longer exists."));
		const comment = found.value;
		return this.#writes.run(comment.workspaceId, async () => {
			const written = await this.#deps.repos.diffComments.setBody(id, body, comment.suggestion);
			if (!written.ok) return written;
			const rewritten = await this.#rewriteCommentFile({ ...comment, body });
			if (!rewritten.ok) return rewritten;
			return this.#read(comment.workspaceId);
		});
	}

	async remove(id: CommentId): Promise<Result<void>> {
		const found = await this.#deps.repos.diffComments.get(id);
		if (!found.ok) return found;
		if (found.value === null) return ok(undefined);
		const workspaceId = found.value.workspaceId;
		return this.#writes.run(workspaceId, async () => {
			const removed = await this.#deps.repos.diffComments.delete(id);
			if (!removed.ok) return removed;
			return this.#read(workspaceId);
		});
	}

	async setResolved(id: CommentId, resolved: boolean): Promise<Result<void>> {
		const found = await this.#deps.repos.diffComments.get(id);
		if (!found.ok) return found;
		if (found.value === null)
			return err(appError("db.not_found", "That comment no longer exists."));
		const workspaceId = found.value.workspaceId;
		return this.#writes.run(workspaceId, async () => {
			const written = await this.#deps.repos.diffComments.setResolved(id, resolved);
			if (!written.ok) return written;
			return this.#read(workspaceId);
		});
	}

	/** Comments the `getDiffComments` agent tool may show: open, not outdated, not resolved. */
	async listForAgent(
		workspaceId: WorkspaceId,
		file: string | undefined,
	): Promise<Result<DiffComment[]>> {
		const listed = await this.#deps.repos.diffComments.listByWorkspace(workspaceId);
		if (!listed.ok) return listed;
		return ok(
			listed.value.filter(
				(comment) =>
					comment.filePath !== null &&
					(file === undefined || comment.filePath === file) &&
					!comment.resolved &&
					!comment.outdated &&
					comment.state !== "hidden" &&
					comment.state !== "superseded" &&
					comment.state !== "reviewed",
			),
		);
	}

	/**
	 * Backs the `addDiffComments` agent tool. Comments get author kind "agent" and the chat's model
	 * as the author's name (services-map 5A.7.2); null when the chat has no model, so the card says
	 * "Agent". Returns how many were added.
	 */
	async addFromAgent(
		workspaceId: WorkspaceId,
		comments: readonly { file: string; line: number; endLine?: number; body: string }[],
		model: string | null,
	): Promise<Result<number>> {
		return this.#writes.run(workspaceId, async () => {
			let added = 0;
			for (const comment of comments) {
				const written = await this.#deps.repos.diffComments.add({
					workspaceId,
					filePath: comment.file,
					line: comment.line,
					endLine: comment.endLine ?? null,
					body: comment.body,
					author: { kind: "agent", name: model, avatarUrl: null },
					side: "additions",
					threadId: null,
					replyToId: null,
					suggestion: null,
				});
				if (!written.ok) return written;
				added += 1;
			}
			const refreshed = await this.#read(workspaceId);
			return refreshed.ok ? ok(added) : refreshed;
		});
	}

	/** Backs `Actions.comments.sendToChat`. */
	async sendToChat(workspaceId: WorkspaceId, ids: readonly CommentId[]): Promise<Result<void>> {
		if (ids.length === 0) return ok(undefined);
		const found: DiffComment[] = [];
		for (const id of ids) {
			const comment = await this.#deps.repos.diffComments.get(id);
			if (!comment.ok) return comment;
			if (comment.value === null || comment.value.workspaceId !== workspaceId) {
				return err(appError("db.not_found", "That comment no longer exists."));
			}
			if (
				comment.value.outdated ||
				comment.value.resolved ||
				comment.value.state === "hidden" ||
				comment.value.state === "superseded"
			) {
				return inactiveComment();
			}
			found.push(comment.value);
		}
		const workspacePath = await this.#deps.workspacePathOf(workspaceId);
		if (!workspacePath.ok) return workspacePath;
		const folder = join(workspacePath.value, COMMENT_FOLDER);
		const made = await this.#deps.fs.mkdirp(folder);
		if (!made.ok) return made;

		const mentions: string[] = [];
		for (const comment of found) {
			const path = join(COMMENT_FOLDER, commentFileName(comment.id));
			const written = await this.#deps.fs.writeTextAtomic(
				join(workspacePath.value, path),
				commentFileText(comment),
			);
			if (!written.ok) return written;
			mentions.push(formatFileMention(path));
		}

		const sent = await this.#deps.agent.sendInstruction(
			workspaceId,
			`Review these comments on the diff:\n\n${mentions.join("\n")}`,
		);
		return sent.ok ? ok(undefined) : sent;
	}

	/** Pulls review threads and general comments of the workspace's PR into the table. */
	syncFromGithub(_workspaceId: WorkspaceId): Promise<Result<void>> {
		return notImplemented("REV-04");
	}

	/** Resolves a thread on GitHub and marks the local comments of the thread resolved. */
	resolveOnGithub(_id: CommentId): Promise<Result<void>> {
		return notImplemented("REV-04");
	}

	/** Rewrites the comment file when the comment was already sent to a chat. */
	async #rewriteCommentFile(comment: DiffComment): Promise<Result<void>> {
		if (comment.filePath === null) return ok(undefined);
		const workspacePath = await this.#deps.workspacePathOf(comment.workspaceId);
		if (!workspacePath.ok) return workspacePath;
		const path = join(workspacePath.value, COMMENT_FOLDER, commentFileName(comment.id));
		if (!(await this.#deps.fs.exists(path))) return ok(undefined);
		return this.#deps.fs.writeTextAtomic(path, commentFileText(comment));
	}

	/** Backs `Actions.pullRequests.requestAiReview`. */
	async requestAiReview(
		workspaceId: WorkspaceId,
		extraInstructions: string | null,
	): Promise<Result<Session>> {
		const customPrompt = await this.#deps.customPromptOf(workspaceId);
		if (!customPrompt.ok) return customPrompt;
		const text = aiReviewInstruction({
			customPrompt: customPrompt.value,
			extraInstructions,
		});
		return this.#deps.startReviewChat(workspaceId, text);
	}

	/** Backs `Actions.comments.setHidden`. */
	setHidden(_id: CommentId, _hidden: boolean): Promise<Result<void>> {
		return notImplemented("REV-12");
	}

	/** Backs `Actions.comments.markAllReady`. */
	markAllReady(_workspaceId: WorkspaceId): Promise<Result<void>> {
		return notImplemented("REV-12");
	}
}
