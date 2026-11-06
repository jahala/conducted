/**
 * @feature AGENT-13 Codex goals: set, pause, resume, clear
 * Owns: a Codex chat's goal: reading it, setting it with an optional token budget, pausing,
 * resuming and clearing it through the app server, turning a message that starts with `/goal` into
 * the matching call, and reporting changes to the app.
 * Behaviour: other-runners.md 2.1 (goal commands are routed to the app server's `thread/goal/*`
 * methods instead of `turn/steer`) and 3 (the events `thread.goal.updated` and `cleared`),
 * sessions.md 2 (goal status literals), ui-map.md 3.5 (`/goal`, the goal bar: Save, Pause, Resume,
 * Edit, Clear). The RPC methods are `getGoal`, `setGoal` and `changeGoal`; the notification is
 * `goalChanged` (packages/protocol/src/rpc.ts).
 * Must handle: `/goal` with no text (a usage error, no call); `/goal pause`, `/goal resume` and
 * `/goal clear` (the word wins over an objective of the same spelling); a goal call on a chat that
 * is not Codex (an invalid-params error value); no live thread yet (the call starts or resumes the
 * thread first); a status the app server sends that we do not know (kept as `blocked`, logged);
 * the server's statuses `usageLimited` and `budgetLimited` map to `usage_limited` and
 * `budget_limited`; a goal changed by the agent while no turn runs (the notification still goes
 * out); the feature flag `codex_goals_disabled` (the app hides the bar; the sidecar still answers).
 * The method and notification names below were checked against the TypeScript bindings that
 * `codex app-server generate-ts` writes for codex-cli 0.154.0. Re-generate them when the Codex
 * version changes.
 * Test first: `parseGoalCommand("/goal pause")` returns the pause action, and
 * `parseGoalCommand("/goal ship the importer")` returns a set action with that objective.
 */
import type { CodexGoal } from "@conducted/protocol";
import { type AppError, appError, err, ok, type Result, type SessionId } from "@conducted/shared";
import type { Logger } from "../../logging/logger.ts";

/** The app server's goal calls. Requests we send to it. */
const CODEX_GOAL_METHODS = {
	get: "thread/goal/get",
	set: "thread/goal/set",
	clear: "thread/goal/clear",
} as const;

/** The goal notifications the app server sends us. */
export const CODEX_GOAL_NOTIFICATIONS = {
	updated: "thread/goal/updated",
	cleared: "thread/goal/cleared",
} as const;

/** How long a goal call may take. It is one of the app server's cheap calls. */
const CODEX_GOAL_CALL_TIMEOUT_MS = 30_000;

export type GoalCommand =
	| { action: "set"; objective: string }
	| { action: "pause" }
	| { action: "resume" }
	| { action: "clear" };

/** Reads a message as a goal command. Null when it does not start with `/goal`. */
export function parseGoalCommand(text: string): Result<GoalCommand | null, AppError> {
	const trimmed = text.trimStart();
	if (!trimmed.startsWith("/goal")) return ok(null);
	const after = trimmed.slice("/goal".length);
	if (after !== "" && !/^\s/.test(after)) return ok(null);
	const rest = after.trim();
	if (rest === "") {
		return err(
			appError("goal_usage", "Add an objective after /goal, or write pause, resume or clear."),
		);
	}
	const first = rest.split(/\s+/)[0] ?? "";
	const word = first.toLowerCase();
	if (word === "pause" || word === "resume" || word === "clear") {
		return ok({ action: word });
	}
	return ok({ action: "set", objective: rest });
}

/** The goal calls of one Codex thread, as the app server offers them. */
export interface CodexGoalClient {
	get(threadId: string): Promise<Result<CodexGoal | null, AppError>>;
	set(
		threadId: string,
		objective: string,
		tokenBudget?: number,
	): Promise<Result<CodexGoal, AppError>>;
	pause(threadId: string): Promise<Result<CodexGoal, AppError>>;
	resume(threadId: string): Promise<Result<CodexGoal, AppError>>;
	clear(threadId: string): Promise<Result<void, AppError>>;
}

/** The part of a Codex app server connection the goal calls need. */
export interface GoalRpc {
	request<T>(
		method: string,
		params: unknown,
		options?: { timeoutMs?: number },
	): Promise<Result<T, AppError>>;
}

/** A goal's status as the app server reports it. */
type ServerGoalStatus =
	| "active"
	| "paused"
	| "blocked"
	| "usageLimited"
	| "budgetLimited"
	| "complete";

/** The protocol status for one the app server sent. An unknown one is kept as blocked. */
function goalStatus(status: unknown, logger: Logger): CodexGoal["status"] {
	switch (status) {
		case "active":
		case "paused":
		case "blocked":
		case "complete":
			return status;
		case "usageLimited":
			return "usage_limited";
		case "budgetLimited":
			return "budget_limited";
		default:
			logger.warn("Codex sent a goal status we do not know; keeping it as blocked", {
				status: typeof status === "string" ? status : String(status),
			});
			return "blocked";
	}
}

/** Reads a goal from a response or notification. Null when the payload has no goal. */
function readCodexGoal(value: unknown, logger: Logger): CodexGoal | null {
	const root = asRecord(value);
	if (root === null) return null;
	const goal = asRecord(root.goal) ?? root;
	const objective = goal.objective;
	if (typeof objective !== "string") return null;
	const mapped: CodexGoal = { objective, status: goalStatus(goal.status, logger) };
	if (typeof goal.tokenBudget === "number") mapped.tokenBudget = goal.tokenBudget;
	if (typeof goal.tokensUsed === "number") mapped.tokensUsed = goal.tokensUsed;
	return mapped;
}

/** The goal calls over one app server connection. */
export class CodexThreadGoalClient implements CodexGoalClient {
	constructor(protected readonly deps: { rpc: GoalRpc; logger: Logger }) {}

	async get(threadId: string): Promise<Result<CodexGoal | null, AppError>> {
		const read = await this.request<unknown>(CODEX_GOAL_METHODS.get, { threadId });
		if (!read.ok) return read;
		return ok(readCodexGoal(read.value, this.deps.logger));
	}

	async set(
		threadId: string,
		objective: string,
		tokenBudget?: number,
	): Promise<Result<CodexGoal, AppError>> {
		const params: Record<string, unknown> = { threadId, objective };
		if (tokenBudget !== undefined) params.tokenBudget = tokenBudget;
		return this.setGoal(params);
	}

	async pause(threadId: string): Promise<Result<CodexGoal, AppError>> {
		return this.setGoal({ threadId, status: "paused" satisfies ServerGoalStatus });
	}

	async resume(threadId: string): Promise<Result<CodexGoal, AppError>> {
		return this.setGoal({ threadId, status: "active" satisfies ServerGoalStatus });
	}

	async clear(threadId: string): Promise<Result<void, AppError>> {
		const cleared = await this.request<unknown>(CODEX_GOAL_METHODS.clear, { threadId });
		if (!cleared.ok) return cleared;
		return ok(undefined);
	}

	private async setGoal(params: Record<string, unknown>): Promise<Result<CodexGoal, AppError>> {
		const written = await this.request<unknown>(CODEX_GOAL_METHODS.set, params);
		if (!written.ok) return written;
		const goal = readCodexGoal(written.value, this.deps.logger);
		if (goal === null) {
			return err(appError("codex_goal_missing", "Codex did not return the goal it set."));
		}
		return ok(goal);
	}

	private request<T>(method: string, params: unknown): Promise<Result<T, AppError>> {
		return this.deps.rpc.request<T>(method, params, {
			timeoutMs: CODEX_GOAL_CALL_TIMEOUT_MS,
		});
	}
}

/** A chat's thread and goal calls. Releasing it gives the process lease back. */
export interface CodexGoalHandle {
	threadId: string;
	goals: CodexGoalClient;
	release(): void;
}

export class CodexGoalController {
	constructor(
		protected readonly deps: {
			/** The goal client of the chat's live thread; starts the thread when there is none. */
			clientFor(sessionId: SessionId): Promise<Result<CodexGoalHandle>>;
			/** Sends `goalChanged` to the app. */
			announce(sessionId: SessionId, goal: CodexGoal | null): void;
			logger: Logger;
		},
	) {}

	async get(sessionId: SessionId): Promise<Result<CodexGoal | null, AppError>> {
		const found = await this.deps.clientFor(sessionId);
		if (!found.ok) return found;
		try {
			return await found.value.goals.get(found.value.threadId);
		} finally {
			found.value.release();
		}
	}

	async set(
		sessionId: SessionId,
		objective: string,
		tokenBudget?: number,
	): Promise<Result<CodexGoal, AppError>> {
		const trimmed = objective.trim();
		if (trimmed === "") {
			return err(appError("goal_usage", "A goal needs an objective."));
		}
		const found = await this.deps.clientFor(sessionId);
		if (!found.ok) return found;
		try {
			const written = await found.value.goals.set(found.value.threadId, trimmed, tokenBudget);
			if (!written.ok) return written;
			this.deps.announce(sessionId, written.value);
			return written;
		} finally {
			found.value.release();
		}
	}

	async change(
		sessionId: SessionId,
		action: "pause" | "resume" | "clear",
	): Promise<Result<CodexGoal | null, AppError>> {
		const found = await this.deps.clientFor(sessionId);
		if (!found.ok) return found;
		try {
			const { threadId, goals } = found.value;
			if (action === "clear") {
				const cleared = await goals.clear(threadId);
				if (!cleared.ok) return cleared;
				this.deps.announce(sessionId, null);
				return ok(null);
			}
			const written =
				action === "pause" ? await goals.pause(threadId) : await goals.resume(threadId);
			if (!written.ok) return written;
			this.deps.announce(sessionId, written.value);
			return written;
		} finally {
			found.value.release();
		}
	}

	/** Called for each goal notification of the app server. */
	onServerGoalEvent(sessionId: SessionId, event: unknown): void {
		const root = asRecord(event);
		if (root === null) {
			this.deps.logger.warn("Ignored a Codex goal event that is not an object", {
				sessionId,
			});
			return;
		}
		if ("goal" in root) {
			const goal = readCodexGoal(root, this.deps.logger);
			if (goal === null) {
				this.deps.logger.warn("Ignored a Codex goal update with no goal", { sessionId });
				return;
			}
			this.deps.announce(sessionId, goal);
			return;
		}
		if (typeof root.threadId === "string") {
			this.deps.announce(sessionId, null);
			return;
		}
		this.deps.logger.warn("Ignored a Codex goal event with no goal and no thread", { sessionId });
	}
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}
