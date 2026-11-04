/**
 * @feature SIDE-12 App tools: what the tools can ask of the app
 * Owns: the interface behind the tools, and its implementation over the app connection and the
 * interaction broker.
 * Behaviour: research/conductor/claude-runner.md section 4.2 "Backend" column: GetWorkspaceDiff
 * asks the app for the diff (20 s timeout locally), GetDiffComments and DiffComment read and write
 * review comments, GetTerminalOutput asks for terminal text, AskUserQuestion waits for the user,
 * UpdateProgress only feeds the progress tracker, SetTargetBranch checks the branch on origin.
 * Must handle:
 *  - the app is not connected: every call returns an error value that the tool shows to the agent
 *    as text ("The app is not connected; try again in a moment"), never a hang
 *  - getWorkspaceDiff times out after 20 s with an error value
 *  - askQuestions has no timeout; it returns "withdrawn" when the user cancelled or sent a new
 *    message, which the tool reports so the agent can carry on without the answer
 *  - updateProgress never fails: when no app is connected the update is dropped and the tool still
 *    answers "Progress updated" because the next call replaces it anyway
 * Test first: with an app that is not connected, getWorkspaceDiff returns an error value at once.
 */
import type { AppError, Result, SessionId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";
import type { Logger } from "../logging/logger.ts";
import type { SidecarToApp } from "../rpc/types.ts";
import type { InteractionBroker } from "../session/interactions.ts";
import type { DiffCommentInput, DiffCommentView, ProgressUpdate, Question } from "./types.ts";

export interface AppToolBackend {
	getWorkspaceDiff(
		sessionId: SessionId,
		options: { file?: string; statOnly: boolean },
	): Promise<Result<string, AppError>>;
	getDiffComments(
		sessionId: SessionId,
		options: { file?: string },
	): Promise<Result<DiffCommentView[], AppError>>;
	addDiffComments(
		sessionId: SessionId,
		comments: DiffCommentInput[],
	): Promise<Result<number, AppError>>;
	getTerminalOutput(
		sessionId: SessionId,
		options: { source: "auto" | "run_script" | "spotlight" | "terminal"; maxLines: number },
	): Promise<Result<{ output: string; source: string; running: boolean }, AppError>>;
	setTargetBranch(
		sessionId: SessionId,
		branch: string,
	): Promise<Result<{ ok: boolean; message: string }, AppError>>;
	updateProgress(sessionId: SessionId, update: ProgressUpdate): void;
	askQuestions(
		sessionId: SessionId,
		questions: Question[],
	): Promise<Result<string[][] | "withdrawn", AppError>>;
}

/** Time to wait for the app's diff. From the research (20 s locally). */
export const DIFF_REQUEST_TIMEOUT_MS = 20_000;

export class RpcAppToolBackend implements AppToolBackend {
	constructor(
		protected readonly deps: {
			app: SidecarToApp;
			interactions: InteractionBroker;
			logger: Logger;
		},
	) {}

	getWorkspaceDiff(
		_sessionId: SessionId,
		_options: { file?: string; statOnly: boolean },
	): Promise<Result<string, AppError>> {
		return notImplemented("SIDE-12");
	}

	getDiffComments(
		_sessionId: SessionId,
		_options: { file?: string },
	): Promise<Result<DiffCommentView[], AppError>> {
		return notImplemented("SIDE-12");
	}

	addDiffComments(
		_sessionId: SessionId,
		_comments: DiffCommentInput[],
	): Promise<Result<number, AppError>> {
		return notImplemented("SIDE-12");
	}

	getTerminalOutput(
		_sessionId: SessionId,
		_options: { source: "auto" | "run_script" | "spotlight" | "terminal"; maxLines: number },
	): Promise<Result<{ output: string; source: string; running: boolean }, AppError>> {
		return notImplemented("SIDE-12");
	}

	setTargetBranch(
		_sessionId: SessionId,
		_branch: string,
	): Promise<Result<{ ok: boolean; message: string }, AppError>> {
		return notImplemented("SIDE-12");
	}

	updateProgress(_sessionId: SessionId, _update: ProgressUpdate): void {
		notImplemented("SIDE-12");
	}

	askQuestions(
		_sessionId: SessionId,
		_questions: Question[],
	): Promise<Result<string[][] | "withdrawn", AppError>> {
		return notImplemented("SIDE-12");
	}
}
