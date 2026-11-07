/**
 * @feature SIDE-12 App tools: what the tools can ask of the app
 * Owns: the interface behind the tools, and its implementation over the app connection and the
 * interaction broker.
 * Behaviour: research/conductor/claude-runner.md section 4.2 "Backend" column: GetWorkspaceDiff
 * asks the app for the diff (20 s timeout locally), GetDiffComments and DiffComment read and write
 * review comments, GetTerminalOutput asks for terminal text, AskUserQuestion waits for the user,
 * UpdateProgress only feeds the progress tracker, SetTargetBranch checks the branch on origin,
 * and RunLocalCommand asks the app to approve and run a command on the Mac (CLOUD-14).
 * Must handle:
 *  - the app is not connected: every request returns an error value that the tool shows to the
 *    agent as text ("The app is not connected; try again in a moment"), never a hang
 *  - getWorkspaceDiff times out after 20 s with an error value
 *  - askQuestions has no timeout; it returns "withdrawn" when the user cancelled or sent a new
 *    message, which the tool reports so the agent can carry on without the answer
 *  - updateProgress never fails: when no app is connected the update is dropped and the tool still
 *    answers "Progress updated" because the next call replaces it anyway
 * Test first: with an app that is not connected, getWorkspaceDiff returns an error value at once.
 */

import {
	LOCAL_COMMAND_APPROVAL_TIMEOUT_MS,
	LOCAL_COMMAND_EXTENDED_MAX_TIMEOUT_MS,
	type SidecarToAppRequest,
} from "@conducted/protocol";
import type { AppError, Result, SessionId } from "@conducted/shared";
import { appError, asAppError, err, messageOf, ok } from "@conducted/shared";
import type { Logger } from "../logging/logger.ts";
import type {
	SidecarToApp,
	SidecarToAppRequestParams,
	SidecarToAppRequestResult,
} from "../rpc/types.ts";
import type { InteractionBroker } from "../session/interactions.ts";
import type {
	DiffCommentInput,
	DiffCommentView,
	LocalCommandAnswer,
	ProgressUpdate,
	Question,
} from "./types.ts";

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
	/** Runs a one-shot command on the Mac, after the app's own approval (CLOUD-14). */
	runLocalCommand(
		sessionId: SessionId,
		options: {
			command: string;
			description?: string;
			reason?: string;
			cwd?: string;
			timeoutMs: number;
			extendedTimeoutReason?: string;
		},
	): Promise<Result<LocalCommandAnswer, AppError>>;
	updateProgress(sessionId: SessionId, update: ProgressUpdate): void;
	askQuestions(
		sessionId: SessionId,
		questions: Question[],
	): Promise<Result<string[][] | "withdrawn", AppError>>;
}

/** Time to wait for the app's diff. From the research (20 s locally). */
export const DIFF_REQUEST_TIMEOUT_MS = 20_000;

/**
 * How long the sidecar waits for a local command's answer: the longest command plus the approval
 * and a minute of slack. The app enforces the shorter limits itself (CLOUD-14).
 */
export const LOCAL_COMMAND_RPC_TIMEOUT_MS =
	LOCAL_COMMAND_EXTENDED_MAX_TIMEOUT_MS + LOCAL_COMMAND_APPROVAL_TIMEOUT_MS + 60_000;

/** What every call says when the app is not attached. */
export const APP_NOT_CONNECTED_MESSAGE = "The app is not connected; try again in a moment.";

/** The app's error code, carried as data on the JSON-RPC failure the app answers with. */
function appErrorCodeOf(cause: unknown): string | undefined {
	if (typeof cause !== "object" || cause === null || !("appErrorCode" in cause)) return undefined;
	const code = (cause as { appErrorCode?: unknown }).appErrorCode;
	return typeof code === "string" ? code : undefined;
}

export class RpcAppToolBackend implements AppToolBackend {
	constructor(
		protected readonly deps: {
			app: SidecarToApp;
			interactions: InteractionBroker;
			logger: Logger;
		},
	) {}

	async getWorkspaceDiff(
		sessionId: SessionId,
		options: { file?: string; statOnly: boolean },
	): Promise<Result<string, AppError>> {
		const result = await this.call(
			"getWorkspaceDiff",
			{ sessionId, file: options.file, statOnly: options.statOnly },
			{ timeoutMs: DIFF_REQUEST_TIMEOUT_MS },
		);
		if (result.ok) return ok(result.value.diff);
		const recorded = appErrorCodeOf(result.error.cause);
		return recorded === undefined
			? result
			: err(appError(recorded, result.error.message, result.error));
	}

	async getDiffComments(
		sessionId: SessionId,
		options: { file?: string },
	): Promise<Result<DiffCommentView[], AppError>> {
		const result = await this.call("getDiffComments", { sessionId, file: options.file });
		return result.ok ? ok(result.value.comments) : result;
	}

	async addDiffComments(
		sessionId: SessionId,
		comments: DiffCommentInput[],
	): Promise<Result<number, AppError>> {
		const result = await this.call("addDiffComments", { sessionId, comments });
		return result.ok ? ok(result.value.added) : result;
	}

	async getTerminalOutput(
		sessionId: SessionId,
		options: { source: "auto" | "run_script" | "spotlight" | "terminal"; maxLines: number },
	): Promise<Result<{ output: string; source: string; running: boolean }, AppError>> {
		return this.call("getTerminalOutput", {
			sessionId,
			source: options.source,
			maxLines: options.maxLines,
		});
	}

	async setTargetBranch(
		sessionId: SessionId,
		branch: string,
	): Promise<Result<{ ok: boolean; message: string }, AppError>> {
		return this.call("setTargetBranch", { sessionId, branch });
	}

	async runLocalCommand(
		sessionId: SessionId,
		options: {
			command: string;
			description?: string;
			reason?: string;
			cwd?: string;
			timeoutMs: number;
			extendedTimeoutReason?: string;
		},
	): Promise<Result<LocalCommandAnswer, AppError>> {
		return this.call(
			"runLocalCommand",
			{ sessionId, ...options },
			{
				timeoutMs: LOCAL_COMMAND_RPC_TIMEOUT_MS,
			},
		);
	}

	updateProgress(sessionId: SessionId, update: ProgressUpdate): void {
		const sent = this.deps.app.notify("progress", { sessionId, progress: update });
		if (!sent) {
			this.deps.logger.debug("A progress update was dropped because the app did not accept it.", {
				sessionId,
			});
		}
	}

	async askQuestions(
		sessionId: SessionId,
		questions: Question[],
	): Promise<Result<string[][] | "withdrawn", AppError>> {
		const answer = await this.deps.interactions.open(sessionId, { kind: "question", questions });
		if (answer.kind === "withdrawn") return ok("withdrawn");
		if (answer.kind !== "question") {
			return err(
				appError("unexpected_answer", `The user answered a question with a ${answer.kind} answer.`),
			);
		}
		return ok(answer.answers);
	}

	private async call<K extends SidecarToAppRequest>(
		method: K,
		params: SidecarToAppRequestParams<K>,
		options?: { timeoutMs?: number },
	): Promise<Result<SidecarToAppRequestResult<K>, AppError>> {
		if (!this.deps.app.connected) {
			return err(appError("app_not_connected", APP_NOT_CONNECTED_MESSAGE));
		}
		try {
			return await this.deps.app.request(method, params, options);
		} catch (cause) {
			this.deps.logger.warn("An app tool request failed", {
				method,
				reason: messageOf(cause),
			});
			return err(asAppError("app_request_failed", `The ${method} request failed`, cause));
		}
	}
}
