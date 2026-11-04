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
 * Our design choice: the exact app-server method names are not copied here. Generate the bindings
 * with `codex app-server generate-ts` when building this, as AGENT-06's header says, and put the
 * names in `protocol.ts` beside the others.
 * Test first: `parseGoalCommand("/goal pause")` returns the pause action, and
 * `parseGoalCommand("/goal ship the importer")` returns a set action with that objective.
 */
import type { CodexGoal } from "@conducted/protocol";
import type { AppError, Result, SessionId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";
import type { Logger } from "../../logging/logger.ts";

export type GoalCommand =
	| { action: "set"; objective: string }
	| { action: "pause" }
	| { action: "resume" }
	| { action: "clear" };

/** Reads a message as a goal command. Null when it does not start with `/goal`. */
export function parseGoalCommand(_text: string): Result<GoalCommand | null, AppError> {
	return notImplemented("AGENT-13");
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

export class CodexGoalController {
	constructor(
		protected readonly deps: {
			/** The goal client of the chat's live thread; starts the thread when there is none. */
			clientFor(
				sessionId: SessionId,
			): Promise<Result<{ threadId: string; goals: CodexGoalClient }>>;
			/** Sends `goalChanged` to the app. */
			announce(sessionId: SessionId, goal: CodexGoal | null): void;
			logger: Logger;
		},
	) {}

	get(_sessionId: SessionId): Promise<Result<CodexGoal | null, AppError>> {
		return notImplemented("AGENT-13");
	}

	set(
		_sessionId: SessionId,
		_objective: string,
		_tokenBudget?: number,
	): Promise<Result<CodexGoal, AppError>> {
		return notImplemented("AGENT-13");
	}

	change(
		_sessionId: SessionId,
		_action: "pause" | "resume" | "clear",
	): Promise<Result<CodexGoal | null, AppError>> {
		return notImplemented("AGENT-13");
	}

	/** Called for each goal notification of the app server. */
	onServerGoalEvent(_sessionId: SessionId, _event: unknown): void {
		notImplemented("AGENT-13");
	}
}
