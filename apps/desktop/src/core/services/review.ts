/**
 * @feature REV-03 Review: diff comments, GitHub comment sync and AI review
 * Owns: the review comments on a workspace's diff (add, edit, resolve, remove, send to chat),
 * syncing them with GitHub pull request threads, and starting an AI review chat.
 * Behaviour: services-map.md 5A.7 (comment store, states, upsert rules, agent tools, GitHub
 * sync, attaching comments to messages), 3.7.4 (review threads query), ui-map.md 3.6 (inline
 * comments, "Add all to chat"), 5.1 ("Start review").
 * Must handle: every change writes the database first and then updates the store; a comment
 * keeps its line anchors when the file changes (anchors update by line shifts, outdated when the
 * line is gone); GitHub comments have ids `github-<thread>-<comment>` and are never edited
 * locally; sync inserts new ones, updates changed ones, and removes ones that vanished on
 * GitHub, but never touches hidden, reviewed or superseded rows, and a failed fetch skips the
 * removal for that kind; an edited GitHub comment that was already reviewed comes back as
 * pending; inactive (outdated or resolved) comments cannot be sent to chat; sending to chat writes
 * each comment as a small file in the workspace and returns its path; the AI review creates a new
 * chat with the review model and sends the review instruction.
 * Our design choice: the lifecycle uses the columns of migration 0001 (`resolved`, `outdated`,
 * author kind), not Conductor's six-state column. "Sent to chat" is derived from the message.
 * Test first: sync removes a GitHub comment that vanished and keeps a locally authored one.
 */
import { type CommentId, notImplemented, type Result, type WorkspaceId } from "@conducted/shared";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { Repositories } from "../db/repositories.ts";
import type { GitRunner } from "../git/runner.ts";
import type { DiffComment, Session } from "../model.ts";
import type { AgentMessenger } from "./sessions.ts";

export interface ReviewState {
	byWorkspace: Readonly<Record<string, readonly DiffComment[]>>;
}

export interface ReviewServiceDeps {
	repos: Pick<Repositories, "diffComments">;
	git: GitRunner;
	agent: AgentMessenger;
	/** Creates a chat with the review model and sends the text. */
	startReviewChat: (workspaceId: WorkspaceId, text: string) => Promise<Result<Session>>;
}

export class ReviewService {
	readonly store: StoreApi<ReviewState>;
	readonly #deps: ReviewServiceDeps;

	constructor(deps: ReviewServiceDeps) {
		this.#deps = deps;
		this.store = createStore<ReviewState>(() => ({ byWorkspace: {} }));
	}

	/** Loads the comments of a workspace into the store. */
	load(_workspaceId: WorkspaceId): Promise<Result<void>> {
		void this.#deps;
		return notImplemented("REV-03");
	}

	/** A null file makes a comment on the pull request itself (REV-13). */
	add(
		_workspaceId: WorkspaceId,
		_file: string | null,
		_line: number | null,
		_endLine: number | null,
		_body: string,
	): Promise<Result<DiffComment>> {
		return notImplemented("REV-03");
	}

	edit(_id: CommentId, _body: string): Promise<Result<void>> {
		return notImplemented("REV-03");
	}

	remove(_id: CommentId): Promise<Result<void>> {
		return notImplemented("REV-03");
	}

	setResolved(_id: CommentId, _resolved: boolean): Promise<Result<void>> {
		return notImplemented("REV-03");
	}

	/** Comments the `getDiffComments` agent tool may show: open, not outdated, not resolved. */
	listForAgent(
		_workspaceId: WorkspaceId,
		_file: string | undefined,
	): Promise<Result<DiffComment[]>> {
		return notImplemented("REV-03");
	}

	/** Backs the `addDiffComments` agent tool. Comments get author kind "agent". Returns how many were added. */
	addFromAgent(
		_workspaceId: WorkspaceId,
		_comments: readonly { file: string; line: number; endLine?: number; body: string }[],
	): Promise<Result<number>> {
		return notImplemented("REV-03");
	}

	/** Backs `Actions.comments.sendToChat`. */
	sendToChat(_workspaceId: WorkspaceId, _ids: readonly CommentId[]): Promise<Result<void>> {
		return notImplemented("REV-03");
	}

	/** Pulls review threads and general comments of the workspace's PR into the table. */
	syncFromGithub(_workspaceId: WorkspaceId): Promise<Result<void>> {
		return notImplemented("REV-04");
	}

	/** Resolves a thread on GitHub and marks the local comments of the thread resolved. */
	resolveOnGithub(_id: CommentId): Promise<Result<void>> {
		return notImplemented("REV-04");
	}

	/** Backs `Actions.pullRequests.requestAiReview`. */
	requestAiReview(
		_workspaceId: WorkspaceId,
		_extraInstructions: string | null,
	): Promise<Result<Session>> {
		return notImplemented("REV-05");
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
