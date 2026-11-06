/**
 * @feature REV-03 Review: diff comments and AI review
 * @feature REV-04 syncing review threads and general comments from GitHub, and resolving a thread
 * @feature REV-12 comment states, and the attachment rows that say which chat received a comment
 * Owns: the review comments on a workspace's diff (load, add, edit, resolve, remove, send to
 * chat), the reads and writes behind the agent's GetDiffComments and DiffComment tools, starting
 * an AI review chat, and mapping GitHub review threads and general comments into the store.
 * Behaviour: services-map.md 5A.7.1 and 5A.7.2 (comment store, agent tools), 5A.7.3 and 3.7.4
 * (GitHub sync and resolving a thread), 5A.6.4 (a comment sent to chat is written as a file),
 * ui-map.md 3.6 (inline comments), 5.1 ("Start review").
 * Must handle: every change writes the database first and then re-reads the workspace rows; a
 * load runs once per workspace and only the newest read writes the store; writes for one
 * workspace run in order, so an insert finishes before a later write; an inactive (outdated or
 * resolved) comment cannot be sent to chat; sending to chat writes each comment as a small file
 * in the workspace and, only after the chat accepted the message, records one sent attachment
 * per comment naming that chat and marks all of them reviewed in one statement; a failure there
 * is reported as sent but not recorded (`review_sent_not_recorded`), not as a failed send;
 * hiding a comment keeps it hidden until the user brings it back, which makes it pending; a
 * superseded comment is never hidden or brought back; every pending open comment can be made
 * ready in one step; editing a comment that was sent rewrites its file; the AI review
 * creates a new chat with the review model and sends the review instruction, using the
 * repository's review prompt when it has one; a GitHub sync loads threads and general comments
 * in parallel, keeps the other list when one fetch fails, deletes only GitHub rows of the scope
 * that answered, and treats a repository that is not GitHub or a workspace with no PR as a
 * normal skip; a failed sync stays in `syncErrors` until a sync answers, so the screen can say
 * the list may be out of date; resolving a thread on GitHub marks every local comment of that
 * thread resolved only after GitHub accepted it, and unresolving a GitHub thread here is refused.
 * Our design choice: sending to chat asks the active chat through AgentMessenger, because the
 * composer's attachment pipeline belongs to COMP-01. AgentMessenger answers with the chat but not
 * the message, so the attachment rows name the chat and leave the message id empty. A GitHub
 * suggestion's replacement comes from its fenced `suggestion` block. Its base code is not read
 * from the diff hunk yet (Conductor computes it there), so a synced suggestion has none.
 * A user's comment keeps its side, its suggested change with the original lines it replaces
 * (migration 0005), and its thread: a reply names the comment it answers, which must be in the
 * same workspace. An edit changes the text and, when asked, the suggested change, never the side
 * or the thread.
 * Test first: create, edit, resolve and remove each write SQLite and re-read the workspace rows.
 * REV-04 test first: a failed general-comment fetch keeps thread comments that vanished from GitHub.
 */
import { join } from "node:path";
import { formatFileMention } from "@conducted/protocol";
import {
	appError,
	type CommentId,
	err,
	ok,
	type Result,
	type SessionId,
	type WorkspaceId,
} from "@conducted/shared";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { FileSystem } from "../../platform/platform.ts";
import type { CommentDetails, CommentSuggestion } from "../api.ts";
import { createLatestWins } from "../async/latest-wins.ts";
import { createKeyedQueue } from "../async/serial-queue.ts";
import type { Repositories } from "../db/repositories.ts";
import type { GitRunner } from "../git/runner.ts";
import type { DiffComment, Session } from "../model.ts";
import { aiReviewInstruction } from "./agent-instructions.ts";
import type { GithubGeneralComment, GithubReviewThread } from "./github.ts";
import type { AgentMessenger } from "./sessions.ts";

export interface ReviewState {
	byWorkspace: Readonly<Record<string, readonly DiffComment[]>>;
	errors: Readonly<Record<string, { code: string; message: string }>>;
	/**
	 * The last failed GitHub sync per workspace. While it is set, the GitHub comments shown may be
	 * out of date. A sync that answers, or finds nothing to sync, clears it.
	 */
	syncErrors: Readonly<Record<string, { code: string; message: string }>>;
}

/** The GitHub reads and write a review-comment sync needs, kept narrow for the review service. */
export interface GithubReviewCommentsPort {
	readReviewThreads(workspaceId: WorkspaceId): Promise<Result<GithubReviewThread[]>>;
	readGeneralComments(workspaceId: WorkspaceId): Promise<Result<GithubGeneralComment[]>>;
	resolveReviewThread(workspaceId: WorkspaceId, threadId: string): Promise<Result<void>>;
}

export interface ReviewServiceDeps {
	repos: Pick<Repositories, "diffComments" | "attachments">;
	git: GitRunner;
	agent: AgentMessenger;
	fs: Pick<FileSystem, "mkdirp" | "writeTextAtomic" | "exists">;
	/**
	 * GitHub access for REV-04. The container supplies it; a test that never syncs may leave it
	 * out, and the sync then returns `review_github_unavailable` instead of guessing.
	 */
	githubComments?: GithubReviewCommentsPort;
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

function supersededComment(): Result<never> {
	return err(
		appError("review_comment_superseded", "A superseded comment can't be hidden or brought back."),
	);
}

function inactiveComment(): Result<never> {
	return err(
		appError(
			"review_comment_inactive",
			"Resolved or outdated comments cannot be added to the chat.",
		),
	);
}

/** The id prefix general pull request comments get (services-map 5A.7.3). */
export const GITHUB_GENERAL_PREFIX = "github-general-";

/** A GitHub review comment's local id, from its thread and numeric id (or its node id). */
function githubCommentId(threadId: string, databaseId: number | null, nodeId: string): CommentId {
	return (
		databaseId === null ? `github-${nodeId}` : `github-${threadId}-${databaseId}`
	) as CommentId;
}

function githubReplyToId(
	threadId: string,
	replyToId: string | null,
	replyToDatabaseId: number | null,
): CommentId | null {
	if (replyToId === null) return null;
	return (
		replyToDatabaseId === null ? `github-${replyToId}` : `github-${threadId}-${replyToDatabaseId}`
	) as CommentId;
}

/** The two stored columns of a suggested change. */
function suggestionColumns(
	suggestion: CommentSuggestion | null,
): Pick<DiffComment, "suggestion" | "suggestionBaseCode"> {
	return suggestion === null
		? { suggestion: null, suggestionBaseCode: null }
		: { suggestion: suggestion.code, suggestionBaseCode: suggestion.baseCode };
}

/** The replacement in a comment's fenced `suggestion` block, or null when it has none. */
export function suggestionFromGithubBody(body: string): string | null {
	const match = /```suggestion[^\n]*\r?\n([\s\S]*?)```/.exec(body);
	if (match === null) return null;
	const text = match[1] ?? "";
	return text.endsWith("\n") ? text.slice(0, -1) : text;
}

/** Maps GitHub review threads into the comments our store and diff panel show. */
export function diffCommentsFromGithubThreads(
	workspaceId: WorkspaceId,
	threads: readonly GithubReviewThread[],
): DiffComment[] {
	const comments: DiffComment[] = [];
	for (const thread of threads) {
		const start =
			thread.startLine ?? thread.originalStartLine ?? thread.line ?? thread.originalLine;
		const end = thread.line ?? thread.originalLine;
		const ranged = thread.startLine !== null || thread.originalStartLine !== null;
		const line = ranged ? start : (thread.line ?? thread.originalLine);
		const endLine = ranged && start !== null && end !== null && end !== start ? end : null;
		const side = (thread.diffSide ?? thread.startDiffSide) === "LEFT" ? "deletions" : "additions";
		for (const comment of thread.comments) {
			comments.push({
				id: githubCommentId(thread.id, comment.databaseId, comment.id),
				workspaceId,
				filePath: thread.path,
				line,
				endLine,
				body: comment.body,
				author: {
					kind: "github",
					name: comment.authorLogin,
					avatarUrl: comment.authorAvatarUrl,
				},
				state: "pending",
				side,
				threadId: thread.id,
				replyToId: githubReplyToId(thread.id, comment.replyToId, comment.replyToDatabaseId),
				suggestion: suggestionFromGithubBody(comment.body),
				suggestionBaseCode: null,
				remoteUrl: comment.url,
				resolved: thread.isResolved,
				outdated: thread.isOutdated,
				createdAt: comment.createdAt,
				updatedAt: comment.updatedAt,
			});
		}
	}
	return comments;
}

/** Maps pull request conversation comments, which sit on no file, into our comment shape. */
export function diffCommentsFromGithubGeneral(
	workspaceId: WorkspaceId,
	comments: readonly GithubGeneralComment[],
): DiffComment[] {
	return comments.map((comment) => ({
		id: `${GITHUB_GENERAL_PREFIX}${comment.databaseId}` as CommentId,
		workspaceId,
		filePath: null,
		line: null,
		endLine: null,
		body: comment.body,
		author: {
			kind: "github",
			name: comment.authorLogin,
			avatarUrl: comment.authorAvatarUrl,
		},
		state: "pending",
		side: "additions",
		threadId: null,
		replyToId: null,
		suggestion: null,
		suggestionBaseCode: null,
		remoteUrl: comment.url,
		resolved: false,
		outdated: false,
		createdAt: comment.createdAt,
		updatedAt: comment.updatedAt,
	}));
}

/** A workspace with no pull request, or a remote that is not GitHub, has nothing to sync. */
function isGithubSyncSkip(result: Result<unknown>): boolean {
	return (
		!result.ok &&
		(result.error.code === "github_not_github" || result.error.code === "github_pr_missing")
	);
}

/** The first failure that is not a normal skip, else the first failure, else ok. */
function firstRealFailure(...results: Result<unknown>[]): Result<void> {
	const failures = results.filter((result) => !result.ok);
	const failure = failures.find((result) => !isGithubSyncSkip(result)) ?? failures[0];
	return failure === undefined || failure.ok ? ok(undefined) : failure;
}

function githubUnavailable(): Result<never> {
	return err(
		appError(
			"review_github_unavailable",
			"GitHub review comments are not available in this build.",
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
		this.store = createStore<ReviewState>(() => ({ byWorkspace: {}, errors: {}, syncErrors: {} }));
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
	/**
	 * Backs `Actions.comments.add`: a comment by the user, on the side, with the suggested change
	 * and in the thread the details name. A reply must answer a comment of the same workspace.
	 */
	async add(
		workspaceId: WorkspaceId,
		file: string | null,
		line: number | null,
		endLine: number | null,
		body: string,
		details: CommentDetails = {},
	): Promise<Result<DiffComment>> {
		return this.#writes.run(workspaceId, async () => {
			const replyToId = details.replyToId ?? null;
			if (replyToId !== null) {
				const parent = await this.#deps.repos.diffComments.get(replyToId);
				if (!parent.ok) return parent;
				if (parent.value === null || parent.value.workspaceId !== workspaceId) {
					return err(appError("db.not_found", "The comment this replies to no longer exists."));
				}
			}
			const added = await this.#deps.repos.diffComments.add({
				workspaceId,
				filePath: file,
				line,
				endLine,
				body,
				author: { kind: "user", name: null, avatarUrl: null },
				side: details.side ?? "additions",
				threadId: details.threadId ?? null,
				replyToId,
				...suggestionColumns(details.suggestion ?? null),
			});
			if (!added.ok) return added;
			const refreshed = await this.#read(workspaceId);
			return refreshed.ok ? ok(added.value) : refreshed;
		});
	}

	/**
	 * Backs `Actions.comments.edit`. Without a `suggestion` in the details the suggested change
	 * stays as it was; null removes it.
	 */
	async edit(
		id: CommentId,
		body: string,
		details: Pick<CommentDetails, "suggestion"> = {},
	): Promise<Result<void>> {
		const found = await this.#deps.repos.diffComments.get(id);
		if (!found.ok) return found;
		if (found.value === null)
			return err(appError("db.not_found", "That comment no longer exists."));
		const comment = found.value;
		const suggestion =
			details.suggestion === undefined
				? { suggestion: comment.suggestion, suggestionBaseCode: comment.suggestionBaseCode }
				: suggestionColumns(details.suggestion);
		return this.#writes.run(comment.workspaceId, async () => {
			const written = await this.#deps.repos.diffComments.setBody(id, body, suggestion);
			if (!written.ok) return written;
			const rewritten = await this.#rewriteCommentFile({ ...comment, ...suggestion, body });
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

	/**
	 * Backs `Actions.comments.setResolved`. A comment of a GitHub review thread is resolved on
	 * GitHub first, so the next sync agrees with the screen. Unresolving such a thread is refused:
	 * GitHub would still say resolved, and the next sync would flip the row back.
	 */
	async setResolved(id: CommentId, resolved: boolean): Promise<Result<void>> {
		const found = await this.#deps.repos.diffComments.get(id);
		if (!found.ok) return found;
		if (found.value === null)
			return err(appError("db.not_found", "That comment no longer exists."));
		if (found.value.author.kind === "github" && found.value.threadId !== null) {
			if (resolved) return this.resolveOnGithub(id);
			return err(
				appError(
					"review_github_unresolve",
					"Unresolve this thread on GitHub. The next sync shows the change here.",
				),
			);
		}
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
					suggestionBaseCode: null,
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
		return this.#writes.run(workspaceId, async () => {
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
			if (!sent.ok) return sent;
			const recorded = await this.#recordSent(workspacePath.value, sent.value, found);
			const refreshed = await this.#read(workspaceId);
			if (!recorded.ok) return recorded;
			return refreshed.ok ? ok(undefined) : refreshed;
		});
	}

	/**
	 * After a chat took the message: one sent attachment per comment, naming the comment and the
	 * chat, then every comment marked reviewed in one statement. A failure here is not a failed
	 * send, so it gets its own code, `review_sent_not_recorded`, and the message says the comments
	 * did reach the chat.
	 */
	async #recordSent(
		workspacePath: string,
		sessionId: SessionId,
		comments: readonly DiffComment[],
	): Promise<Result<void>> {
		const notRecorded = (cause: unknown): Result<void> =>
			err(
				appError(
					"review_sent_not_recorded",
					"The comments were added to the chat, but couldn't be marked as sent.",
					cause,
				),
			);
		for (const comment of comments) {
			const fileName = commentFileName(comment.id);
			const recorded = await this.#deps.repos.attachments.addSent({
				sessionId,
				messageId: null,
				kind: "review",
				originalName: fileName,
				path: join(workspacePath, COMMENT_FOLDER, fileName),
				commentId: comment.id,
			});
			if (!recorded.ok) return notRecorded(recorded.error);
		}
		const reviewed = await this.#deps.repos.diffComments.markReviewed(
			comments.map((comment) => comment.id),
		);
		return reviewed.ok ? ok(undefined) : notRecorded(reviewed.error);
	}

	/**
	 * Pulls review threads and general comments of the workspace's PR into the table
	 * (services-map 5A.7.3). Both lists are asked for at once. A list that failed keeps every row
	 * of its scope, so a failed general fetch cannot delete thread comments that vanished from
	 * GitHub. The other scope is still written and read back.
	 */
	async syncFromGithub(workspaceId: WorkspaceId): Promise<Result<void>> {
		const github = this.#deps.githubComments;
		const synced =
			github === undefined ? githubUnavailable() : await this.#sync(workspaceId, github);
		this.#recordSyncResult(workspaceId, synced);
		return synced;
	}

	/** Keeps a failed sync in `syncErrors`, so the screen can say the list may be out of date. */
	#recordSyncResult(workspaceId: WorkspaceId, result: Result<void>): void {
		this.store.setState((state) => {
			const syncErrors = { ...state.syncErrors };
			if (result.ok || isGithubSyncSkip(result)) {
				delete syncErrors[workspaceId];
			} else {
				syncErrors[workspaceId] = { code: result.error.code, message: result.error.message };
			}
			return { syncErrors };
		});
	}

	async #sync(workspaceId: WorkspaceId, github: GithubReviewCommentsPort): Promise<Result<void>> {
		return this.#writes.run(workspaceId, async () => {
			const [threadsRead, generalRead] = await Promise.all([
				github.readReviewThreads(workspaceId),
				github.readGeneralComments(workspaceId),
			]);
			if (isGithubSyncSkip(threadsRead) && isGithubSyncSkip(generalRead)) return ok(undefined);
			if (!threadsRead.ok && !generalRead.ok) return firstRealFailure(threadsRead, generalRead);

			const existing = await this.#deps.repos.diffComments.listByWorkspace(workspaceId);
			if (!existing.ok) return existing;
			const githubRows = existing.value.filter((comment) => comment.author.kind === "github");
			const currentGeneral = githubRows.filter((comment) =>
				comment.id.startsWith(GITHUB_GENERAL_PREFIX),
			);
			const currentThreads = githubRows.filter(
				(comment) => !comment.id.startsWith(GITHUB_GENERAL_PREFIX),
			);
			const threads = threadsRead.ok
				? diffCommentsFromGithubThreads(workspaceId, threadsRead.value)
				: currentThreads;
			const general = generalRead.ok
				? diffCommentsFromGithubGeneral(workspaceId, generalRead.value)
				: currentGeneral;

			const synced = await this.#deps.repos.diffComments.syncRemote(workspaceId, [
				...threads,
				...general,
			]);
			if (!synced.ok) return synced;
			const refreshed = await this.#read(workspaceId);
			if (!refreshed.ok) return refreshed;
			return firstRealFailure(threadsRead, generalRead);
		});
	}

	/** Resolves a thread on GitHub and marks the local comments of the thread resolved. */
	async resolveOnGithub(id: CommentId): Promise<Result<void>> {
		const found = await this.#deps.repos.diffComments.get(id);
		if (!found.ok) return found;
		if (found.value === null)
			return err(appError("db.not_found", "That comment no longer exists."));
		const comment = found.value;
		if (comment.threadId === null) {
			return err(
				appError("review_thread_missing", "That comment is not part of a GitHub review thread."),
			);
		}
		const workspaceId = comment.workspaceId;
		const threadId = comment.threadId;
		const github = this.#deps.githubComments;
		if (github === undefined) return githubUnavailable();
		return this.#writes.run(workspaceId, async () => {
			const resolved = await github.resolveReviewThread(workspaceId, threadId);
			if (!resolved.ok) return resolved;
			const marked = await this.#deps.repos.diffComments.setThreadResolved(
				workspaceId,
				threadId,
				true,
			);
			if (!marked.ok) return marked;
			return this.#read(workspaceId);
		});
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

	/**
	 * Backs `Actions.comments.setHidden`. Bringing a hidden comment back makes it pending, as
	 * Conductor's `unhideComment` does (services-map.md 5A.7.1); a comment that is not hidden keeps
	 * its state. A superseded comment is frozen and refused either way.
	 */
	async setHidden(id: CommentId, hidden: boolean): Promise<Result<void>> {
		const found = await this.#deps.repos.diffComments.get(id);
		if (!found.ok) return found;
		if (found.value === null)
			return err(appError("db.not_found", "That comment no longer exists."));
		if (found.value.state === "superseded") return supersededComment();
		const workspaceId = found.value.workspaceId;
		return this.#writes.run(workspaceId, async () => {
			const written = hidden
				? await this.#deps.repos.diffComments.hide(id)
				: await this.#deps.repos.diffComments.unhide(id);
			if (!written.ok) return written;
			if (!written.value && hidden) {
				// The guarded statement changed nothing: the comment was superseded meanwhile.
				const refreshed = await this.#read(workspaceId);
				return refreshed.ok ? supersededComment() : refreshed;
			}
			return this.#read(workspaceId);
		});
	}

	/** Backs `Actions.comments.markAllReady`: pending open comments become ready for review. */
	async markAllReady(workspaceId: WorkspaceId): Promise<Result<void>> {
		return this.#writes.run(workspaceId, async () => {
			const marked = await this.#deps.repos.diffComments.markReadyForReview(workspaceId);
			if (!marked.ok) return marked;
			return this.#read(workspaceId);
		});
	}
}
