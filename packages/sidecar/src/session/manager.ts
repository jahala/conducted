/**
 * @feature SIDE-03 Session manager: per-session queue, duplicate guard, idle after flush
 * Owns: every chat the sidecar knows about, and the app's requests about them: sendMessage,
 * cancel, warmAgent, resetAgent, updateConfig, setAutoApproveEdits, getSessionStatus,
 * answerInteraction, a Codex chat's goal (AGENT-13) and its compact turn (AGENT-14), and the ACP
 * chat options of a live chat (AGENT-17). It also builds each
 * agent's environment from the chat's launch settings, hands the runner the program the launch
 * names, and restarts an agent whose launch changed once no turn and no background task runs
 * (SIDE-21, `decideLaunchChange` in process/launch-fingerprint.ts).
 * Behaviour: research/conductor/sessions.md sections 2, 3 and 6, sessions-and-chats.md "What
 * happens when you send a message" and "While the agent is working", other-runners.md section 2.4
 * (steering policy). Conductor splits this over a server (`CJi`), a host (`PFe`) and a send
 * function (`kFe`); we keep one manager and move each concern to its own file under session/.
 * Must handle:
 *  - sendMessage, warmAgent, resetAgent and updateConfig for one chat run on that chat's serial
 *    queue; cancel and answerInteraction do not
 *  - cancel aborts a sendMessage that is still setting up, so it never reaches the runner
 *  - duplicate message ids are ignored and answered with the earlier delivery
 *  - delivery: new turn, steer or queued, chosen by steering.ts; the answer says which
 *  - a new non-steering message and a steer both withdraw the open interaction
 *  - a model or agent change between turns restarts the agent with resume (applyConfig returns
 *    "restart"); every message applies its config to a live agent; a change during a turn waits
 *    for the next turn (answer "on_next_turn")
 *  - a changed agent kind for an existing chat disposes the old agent first
 *  - a changed launch (program, variables, keys, provider, base URL) restarts the agent with resume
 *    at the first request that finds the chat idle with no background task; a request while a turn
 *    or a background task runs leaves the agent alone, and a launch changed back to the running one
 *    restarts nothing
 *  - getSessionStatus for a chat the sidecar does not know: known false (it restarted)
 *  - compact starts a `/compact` turn for a Codex chat, answers started false while a turn runs,
 *    and refuses a chat the sidecar does not know or a chat run by another agent
 *  - the first message adds the workspace instruction block (prompt/); later ones do not
 *  - cancel drops queued messages, withdraws interactions, asks the running turn to take the end
 *    checkpoint, and reports wasWorking
 *  - shutdown(): stop every agent, take no checkpoint, wait up to 10 s for in-flight turns
 *  - the chat's agent process is marked idle when no turn runs (a turn ends, a cancel finishes, a
 *    lease is given back with no turn), so the process manager's idle stop applies; open
 *    background tasks are reported to it so the stop spares the process
 *  - an agent the process manager stopped by itself (idle stop, warm cap) is forgotten before any
 *    request uses it (`holds`), keeping the resume token, so no request reaches a disposed agent
 *  - a turn that cannot start answers sendMessage with that start's own error (a missing program, a
 *    key the login shell lacks, the app tools bridge down); a queued message that cannot start is
 *    stored as its user_message and a turn_ended error with the reason, so it never vanishes
 *  - warmAgent checks the model against the model catalog's list (SIDE-14), never the runner's
 *    directly, so a warm costs no extra agent process once the list is cached
 *  - the same agent session id is stored from the first callback and sent to the app once
 *  - a config the agent changes by itself (plan mode) updates the chat's state and is sent to the
 *    app with the reason, so the app's stored config agrees
 *  - a goal call on a chat that is not Codex answers invalid_params, and a goal call starts or
 *    resumes the chat's Codex thread and announces every change to the app (AGENT-13)
 *  - a plan answer the broker accepts with feedback is stored as a user_message with delivery
 *    plan_feedback in the running turn, so the chat keeps what the user asked for (CHAT-12,
 *    claude-runner 3.5); an approval, a denial with no feedback and a refused answer store nothing
 * Test first: two sendMessage calls with the same messageId start one turn; the second answer
 * repeats the first deliveredAs.
 * Our design choice: queued messages live in memory only. The app owns the persistent follow-up
 * queue (CHAT-04) and re-sends after a restart; this queue is the second line Conductor also has.
 * Our design choice: one `agentConfigChanged` notification with a reason, plus one
 * `onConfigChanged` runner callback, instead of Conductor's separate enter-plan-mode notification
 * and `onEnterPlanMode` callback. `liveState` and `sessionEvent` keep their own shapes and do not
 * echo the config, so a config change is never batched into an event notification.
 */
import type {
	AgentLaunch,
	SessionConfig,
	SessionEvent,
	SessionStatus,
	WorkspaceContext,
} from "@conducted/protocol";
import type {
	AppError,
	Clock,
	EventId,
	IdSource,
	MessageId,
	Result,
	SessionId,
	TurnId,
} from "@conducted/shared";
import { appError, err, ok } from "@conducted/shared";
import type { CheckpointService } from "../checkpoints/checkpoint-service.ts";
import type { Logger } from "../logging/logger.ts";
import type { ModelCatalog } from "../models/catalog.ts";
import { decideLaunchChange, launchFingerprint } from "../process/launch-fingerprint.ts";
import type { ProcessManager } from "../process/process-manager.ts";
import { processKey } from "../process/process-manager.ts";
import type { PromptAssembler } from "../prompt/assemble.ts";
import type {
	AppToSidecarHandlerValue,
	AppToSidecarRequestParams,
	SidecarToApp,
} from "../rpc/types.ts";
import {
	CodexGoalController,
	type CodexGoalHandle,
	type GoalCommand,
	parseGoalCommand,
} from "../runners/codex/goals.ts";
import {
	NoActiveTurnError,
	SteerNotSupportedError,
	SteerRevertedError,
} from "../runners/errors.ts";
import { agentEnvironmentFromCapture } from "../runners/launch-env.ts";
import type { RunnerRegistry } from "../runners/registry.ts";
import type {
	AgentConfigChangeReason,
	AgentSession,
	Runner,
	RunnerCapabilities,
	TurnOutcome,
} from "../runners/runner.ts";
import type { CapturedShellEnv, ShellEnvProvider } from "../shell-env/capture.ts";
import { isAppError, messageOf } from "../util/errors.ts";
import type { DuplicateGuard } from "./duplicate-guard.ts";
import { DuplicateGuard as Guard } from "./duplicate-guard.ts";
import type { EventPublisher } from "./event-batcher.ts";
import type { InteractionBroker } from "./interactions.ts";
import type { LiveStateStore } from "./live-state.ts";
import { addPendingSteer, endTurn, removePendingSteer } from "./live-state.ts";
import type { QueuedMessages } from "./queued-messages.ts";
import { QueuedMessages as Queue } from "./queued-messages.ts";
import type { RunNumber } from "./run-guard.ts";
import { RunGuard } from "./run-guard.ts";
import type { KeyedSerialQueue } from "./serial-queue.ts";
import { chooseDelivery, resolveSteerFailure, type SteerFailure } from "./steering.ts";
import { Turn, type TurnDeps, type TurnRequest } from "./turn.ts";

/** How long shutdown waits for running turns, from the research (10 s). */
export const SHUTDOWN_TURN_WAIT_MS = 10_000;

export type ShutdownReason = "app_quit" | "parent_gone" | "signal";

/** What a turn needs from the manager. Kept narrow so a test can run the manager alone. */
export interface SessionTurn {
	start(): Promise<RunNumber>;
	settled(): Promise<TurnOutcome>;
	cancel(): Promise<void>;
}

export type TurnFactory = (deps: TurnDeps, request: TurnRequest) => SessionTurn;

export interface SessionManager {
	sendMessage(
		params: AppToSidecarRequestParams<"sendMessage">,
	): Promise<AppToSidecarHandlerValue<"sendMessage">>;
	cancel(params: AppToSidecarRequestParams<"cancel">): Promise<AppToSidecarHandlerValue<"cancel">>;
	warmAgent(
		params: AppToSidecarRequestParams<"warmAgent">,
	): Promise<AppToSidecarHandlerValue<"warmAgent">>;
	resetAgent(
		params: AppToSidecarRequestParams<"resetAgent">,
	): Promise<AppToSidecarHandlerValue<"resetAgent">>;
	/**
	 * Codex only (AGENT-14): start a turn whose text is `/compact`, which the runner sends to
	 * `thread/compact/start` instead of `turn/start`. The answer says whether it started.
	 */
	compact(
		params: AppToSidecarRequestParams<"compact">,
	): Promise<AppToSidecarHandlerValue<"compact">>;
	updateConfig(
		params: AppToSidecarRequestParams<"updateConfig">,
	): Promise<AppToSidecarHandlerValue<"updateConfig">>;
	/**
	 * Claude only: turn auto-approval of file edits on or off for a live chat (AGENT-04). The
	 * manager passes it to that chat's session, which the permission handler reads.
	 */
	setAutoApproveEdits(
		params: AppToSidecarRequestParams<"setAutoApproveEdits">,
	): Promise<AppToSidecarHandlerValue<"setAutoApproveEdits">>;
	getSessionStatus(
		params: AppToSidecarRequestParams<"getSessionStatus">,
	): Promise<AppToSidecarHandlerValue<"getSessionStatus">>;
	answerInteraction(
		params: AppToSidecarRequestParams<"answerInteraction">,
	): Promise<AppToSidecarHandlerValue<"answerInteraction">>;
	/** ACP only: the chat's own options beyond the model, after the saved choices are applied. */
	listAcpConfigOptions(
		params: AppToSidecarRequestParams<"listAcpConfigOptions">,
	): Promise<AppToSidecarHandlerValue<"listAcpConfigOptions">>;
	/** ACP only: set one chat option between turns. */
	setAcpConfigOption(
		params: AppToSidecarRequestParams<"setAcpConfigOption">,
	): Promise<AppToSidecarHandlerValue<"setAcpConfigOption">>;
	/** Codex only: the chat's goal, or null when it has none (AGENT-13). */
	getGoal(
		params: AppToSidecarRequestParams<"getGoal">,
	): Promise<AppToSidecarHandlerValue<"getGoal">>;
	/** Codex only: set or replace the chat's goal (AGENT-13). */
	setGoal(
		params: AppToSidecarRequestParams<"setGoal">,
	): Promise<AppToSidecarHandlerValue<"setGoal">>;
	/** Codex only: pause, resume or clear the chat's goal (AGENT-13). */
	changeGoal(
		params: AppToSidecarRequestParams<"changeGoal">,
	): Promise<AppToSidecarHandlerValue<"changeGoal">>;
	/** Called when the app connection attaches: resend open interactions. */
	onAppAttached(): void;
	shutdown(reason: ShutdownReason): Promise<void>;
}

export interface SessionManagerDeps {
	app: SidecarToApp;
	runners: RunnerRegistry;
	processes: ProcessManager;
	checkpoints: CheckpointService;
	prompt: PromptAssembler;
	shellEnv: ShellEnvProvider;
	publisher: EventPublisher;
	liveState: LiveStateStore;
	interactions: InteractionBroker;
	queue: KeyedSerialQueue;
	/** The one home for each agent's model list, with its cache (SIDE-14). warmAgent reads it. */
	models: Pick<ModelCatalog, "list">;
	clock: Clock;
	ids: IdSource;
	logger: Logger;
	/** The seam that lets a manager test run without the turn lifecycle (SIDE-04). */
	createTurn?: TurnFactory;
}

type ResumeParams = AppToSidecarRequestParams<"sendMessage">["resume"];

interface ActiveTurn {
	turn: SessionTurn;
	messageId: MessageId;
	turnId: TurnId;
}

interface SessionState {
	readonly sessionId: SessionId;
	config: SessionConfig;
	workspace: WorkspaceContext;
	launch: AgentLaunch;
	/** The fingerprint the running agent was started with. Null when no agent runs. */
	agentLaunchFingerprint: string | null;
	resume: ResumeParams;
	agent: AgentSession | null;
	agentConfig: SessionConfig | null;
	agentSessionId: string | null;
	runner: Runner | null;
	readonly runGuard: RunGuard;
	readonly queued: QueuedMessages;
	readonly duplicates: DuplicateGuard;
	activeTurn: ActiveTurn | null;
	setup: AbortController | null;
	autoApproveEdits: boolean;
	cancelEpoch: number;
	/** The key of the chat's agent process in the process manager, once a lease was taken. */
	processKey: string | null;
}

interface StartParams {
	sessionId: SessionId;
	config: SessionConfig;
	workspace: WorkspaceContext;
	launch: AgentLaunch;
	resume: ResumeParams;
}

function sameAgent(left: SessionConfig, right: SessionConfig): boolean {
	return left.agent === right.agent && left.acpAgent === right.acpAgent;
}

function queueKey(sessionId: SessionId): string {
	return String(sessionId);
}

export class DefaultSessionManager implements SessionManager {
	private readonly sessions = new Map<SessionId, SessionState>();
	private readonly createTurn: TurnFactory;
	private readonly goals: CodexGoalController;

	constructor(protected readonly deps: SessionManagerDeps) {
		this.createTurn = deps.createTurn ?? ((turnDeps, request) => new Turn(turnDeps, request));
		this.goals = new CodexGoalController({
			clientFor: (sessionId) => this.goalClientFor(sessionId),
			announce: (sessionId, goal) => {
				const sent = this.deps.app.notify("goalChanged", { sessionId, goal });
				if (!sent) {
					this.deps.logger.debug("Could not announce a Codex goal change", { sessionId });
				}
			},
			logger: this.deps.logger,
		});
	}

	sendMessage(
		params: AppToSidecarRequestParams<"sendMessage">,
	): Promise<AppToSidecarHandlerValue<"sendMessage">> {
		const cancelEpochAtCall = this.sessions.get(params.sessionId)?.cancelEpoch ?? 0;
		return this.deps.queue.run(queueKey(params.sessionId), async () => {
			const state = this.ensureSession(params);
			const verdict = state.duplicates.check(params.messageId);
			if (verdict === "new" && state.cancelEpoch !== cancelEpochAtCall) {
				return err(appError("cancelled", "The message was cancelled before it was sent."));
			}
			if (verdict === "duplicate") {
				const deliveredAs = state.duplicates.deliveryOf(params.messageId);
				if (deliveredAs === undefined) {
					return err(
						appError(
							"duplicate_without_delivery",
							"The sidecar saw this message twice but does not remember how it was delivered.",
						),
					);
				}
				return ok({ deliveredAs });
			}

			await this.restartForLaunchChange(state);
			state.duplicates.markInFlight(params.messageId);
			const setup = new AbortController();
			state.setup = setup;
			try {
				const prepared = await this.prepareRequest(params);
				if (!prepared.ok) {
					state.duplicates.forget(params.messageId);
					return err(prepared.error);
				}
				if (setup.signal.aborted) {
					state.duplicates.forget(params.messageId);
					return err(appError("cancelled", "The message was cancelled before it was sent."));
				}

				const runnerResult = this.runnerFor(params.config);
				if (!runnerResult.ok) {
					state.duplicates.forget(params.messageId);
					return err(runnerResult.error);
				}

				const status = this.liveStatus(state.sessionId);
				const agentDiffers =
					state.agentConfig !== null && !sameAgent(state.agentConfig, params.config);
				const capabilities: RunnerCapabilities = agentDiffers
					? { ...runnerResult.value.capabilities, steer: false }
					: (state.runner ?? runnerResult.value).capabilities;
				const choice = chooseDelivery({
					requested: params.delivery,
					status,
					capabilities,
				});

				switch (choice) {
					case "new_turn": {
						if (setup.signal.aborted) {
							state.duplicates.forget(params.messageId);
							return err(appError("cancelled", "The message was cancelled before it was sent."));
						}
						const started = await this.startTurn(state, prepared.value, setup.signal);
						if (!started.ok) {
							if (setup.signal.aborted) {
								return err(appError("cancelled", "The message was cancelled before it was sent."));
							}
							return err(started.error);
						}
						return ok({ deliveredAs: "new_turn" });
					}
					case "steer":
						return this.deliverSteer(state, prepared.value, setup.signal);
					case "queue":
						this.enqueue(state, prepared.value);
						return ok({ deliveredAs: "queued" });
				}
			} finally {
				if (state.setup === setup) state.setup = null;
			}
		});
	}

	async cancel(
		params: AppToSidecarRequestParams<"cancel">,
	): Promise<AppToSidecarHandlerValue<"cancel">> {
		const state = this.sessions.get(params.sessionId);
		if (state === undefined) {
			return ok({ wasWorking: false, droppedMessageIds: [] });
		}

		state.cancelEpoch += 1;
		state.setup?.abort();
		const wasWorking = state.activeTurn !== null || this.liveStatus(state.sessionId) === "working";
		const droppedMessageIds = state.queued.clear();
		for (const id of droppedMessageIds) state.duplicates.forget(id);
		state.duplicates.cancelInFlight();
		this.deps.interactions.withdrawAll(state.sessionId);

		const active = state.activeTurn;
		state.activeTurn = null;
		if (active !== null) {
			state.duplicates.markHandled(active.messageId);
			await active.turn.cancel();
			// The cancelled run is stale, so turnSettled ignores it. The process is idle now.
			this.markProcessIdleWhenNoTurn(state);
		} else {
			await this.deps.liveState.update(state.sessionId, (live) => endTurn(live, "aborted by user"));
		}
		return ok({ wasWorking, droppedMessageIds });
	}

	warmAgent(
		params: AppToSidecarRequestParams<"warmAgent">,
	): Promise<AppToSidecarHandlerValue<"warmAgent">> {
		return this.deps.queue.run(queueKey(params.sessionId), async () => {
			const state = this.ensureSession(params);
			if (state.activeTurn !== null) return ok({});
			await this.restartForLaunchChange(state);
			const runnerResult = this.runnerFor(params.config);
			if (!runnerResult.ok) {
				this.deps.logger.warn("Could not warm the agent", {
					sessionId: state.sessionId,
					code: runnerResult.error.code,
					message: runnerResult.error.message,
				});
				return ok({});
			}

			const config = await this.warmConfig(state.sessionId, params.config);
			state.config = config;
			await this.replaceAgentIfKindChanged(state, config);

			const captured = await this.deps.shellEnv.get(params.workspace.workspacePath);
			if (!captured.ok) {
				this.deps.logger.warn("Could not warm the agent without the login-shell environment", {
					sessionId: state.sessionId,
					code: captured.error.code,
					message: captured.error.message,
				});
				return ok({});
			}
			const env = this.agentEnvironment(state, config, params.workspace, captured.value);
			if (!env.ok) {
				this.deps.logger.warn("Could not warm the agent with the chat's launch settings", {
					sessionId: state.sessionId,
					code: env.error.code,
					message: env.error.message,
				});
				return ok({});
			}

			const key = processKey(config.agent, config.acpAgent, state.sessionId);
			try {
				await this.deps.processes.ensureWarm(key, () =>
					this.startAgent(state, runnerResult.value, config, params.workspace, env.value),
				);
			} catch (cause) {
				this.deps.logger.warn("Warming the agent failed", {
					sessionId: state.sessionId,
					reason: messageOf(cause),
				});
			}
			return ok({});
		});
	}

	resetAgent(
		params: AppToSidecarRequestParams<"resetAgent">,
	): Promise<AppToSidecarHandlerValue<"resetAgent">> {
		return this.deps.queue.run(queueKey(params.sessionId), async () => {
			const state = this.sessions.get(params.sessionId);
			if (state === undefined) return ok({});
			state.runGuard.invalidate();
			state.setup?.abort();
			state.activeTurn = null;
			state.queued.clear();
			state.duplicates.cancelInFlight();
			this.deps.interactions.withdrawAll(state.sessionId);
			await this.disposeAgent(state, state.agentConfig ?? state.config, false);
			this.deps.liveState.drop(state.sessionId);
			this.sessions.delete(state.sessionId);
			return ok({});
		});
	}

	compact(
		params: AppToSidecarRequestParams<"compact">,
	): Promise<AppToSidecarHandlerValue<"compact">> {
		return this.deps.queue.run(queueKey(params.sessionId), async () => {
			const state = this.sessions.get(params.sessionId);
			if (state === undefined) {
				return err(appError("session_unknown", "The sidecar has no state for this chat."));
			}
			if (state.config.agent !== "codex") {
				return err(appError("compact_unsupported", "Only a Codex chat can compact its history."));
			}
			if (state.activeTurn !== null) return ok({ started: false });
			const request: TurnRequest = {
				sessionId: state.sessionId,
				messageId: this.deps.ids.uuid() as MessageId,
				turnId: this.deps.ids.uuid() as TurnId,
				text: "/compact",
				agentText: "/compact",
				attachmentPaths: [],
				config: state.config,
				workspace: state.workspace,
			};
			const started = await this.startTurn(state, request);
			if (!started.ok) return started;
			return ok({ started: true });
		});
	}

	updateConfig(
		params: AppToSidecarRequestParams<"updateConfig">,
	): Promise<AppToSidecarHandlerValue<"updateConfig">> {
		return this.deps.queue.run(queueKey(params.sessionId), async () => {
			const state = this.sessions.get(params.sessionId);
			if (state === undefined) return ok({ applied: "on_next_turn" });

			const working = state.activeTurn !== null || this.liveStatus(state.sessionId) === "working";
			if (working) {
				return ok({ applied: "on_next_turn" });
			}

			const agentConfig = state.agentConfig;
			state.config = params.config;
			await this.replaceAgentIfKindChanged(state, params.config);

			const agent = this.liveAgent(state);
			if (agent === null) return ok({ applied: "live" });

			try {
				const applied = await agent.applyConfig(params.config);
				if (applied === "restart") {
					await this.disposeAgent(state, agentConfig ?? params.config, true);
				}
				return ok({ applied: "live" });
			} catch (cause) {
				const message = messageOf(cause);
				this.deps.logger.warn("Could not apply the chat's settings", {
					sessionId: state.sessionId,
					reason: message,
				});
				return err(appError("config_apply_failed", message, cause));
			}
		});
	}

	async setAutoApproveEdits(
		params: AppToSidecarRequestParams<"setAutoApproveEdits">,
	): Promise<AppToSidecarHandlerValue<"setAutoApproveEdits">> {
		const state = this.sessions.get(params.sessionId);
		if (state === undefined) return ok({});
		state.autoApproveEdits = params.enabled;
		this.liveAgent(state)?.setAutoApproveEdits?.(params.enabled);
		return ok({});
	}

	async getSessionStatus(
		params: AppToSidecarRequestParams<"getSessionStatus">,
	): Promise<AppToSidecarHandlerValue<"getSessionStatus">> {
		const state = this.sessions.get(params.sessionId);
		if (state === undefined) return ok({ known: false });
		return ok({ known: true, liveState: this.deps.liveState.get(state.sessionId) });
	}

	async answerInteraction(
		params: AppToSidecarRequestParams<"answerInteraction">,
	): Promise<AppToSidecarHandlerValue<"answerInteraction">> {
		const state = this.sessions.get(params.sessionId);
		if (state === undefined) return ok({ accepted: false, superseded: true });
		const result = this.deps.interactions.answer(
			state.sessionId,
			params.interactionId,
			params.answer,
		);
		if (result.accepted) this.publishPlanFeedback(state, params.answer);
		return ok(result);
	}

	/** Stores the feedback that rejected a plan as a user message in the running turn. */
	private publishPlanFeedback(
		state: SessionState,
		answer: AppToSidecarRequestParams<"answerInteraction">["answer"],
	): void {
		if (answer.kind !== "plan_approval" || answer.approved) return;
		const text = answer.feedback?.trim() ?? "";
		if (text.length === 0 || state.activeTurn === null) return;
		const event: SessionEvent = {
			type: "user_message",
			eventId: this.deps.ids.uuid() as EventId,
			at: this.deps.clock.now(),
			messageId: this.deps.ids.uuid() as MessageId,
			turnId: state.activeTurn.turnId,
			text,
			attachmentPaths: [],
			delivery: "plan_feedback",
			config: state.config,
		};
		this.deps.publisher.publish(state.sessionId, event);
	}

	listAcpConfigOptions(
		params: AppToSidecarRequestParams<"listAcpConfigOptions">,
	): Promise<AppToSidecarHandlerValue<"listAcpConfigOptions">> {
		return this.deps.queue.run(queueKey(params.sessionId), async () => {
			const state = this.sessions.get(params.sessionId);
			if (state === undefined) {
				return err(appError("session_unknown", "The sidecar has no state for this chat."));
			}
			if (this.configRefused(state)) {
				return err(
					appError("acp_options_busy", "Chat options cannot change while a reply is running."),
				);
			}
			const ensured = await this.ensureConfigAgent(state);
			if (!ensured.ok) return err(ensured.error);
			try {
				const list = ensured.value.agent.listAcpConfigOptions;
				if (list === undefined) {
					return err(appError("acp_options_unsupported", "This agent has no chat options."));
				}
				const listed = await list.call(ensured.value.agent, state.config, (agentSessionId) =>
					this.rememberAgentSessionId(state, agentSessionId),
				);
				if (!listed.ok) return err(listed.error);
				return ok({ options: listed.value });
			} finally {
				ensured.value.release();
			}
		});
	}

	setAcpConfigOption(
		params: AppToSidecarRequestParams<"setAcpConfigOption">,
	): Promise<AppToSidecarHandlerValue<"setAcpConfigOption">> {
		return this.deps.queue.run(queueKey(params.sessionId), async () => {
			const state = this.sessions.get(params.sessionId);
			if (state === undefined) {
				return err(appError("session_unknown", "The sidecar has no state for this chat."));
			}
			if (this.configRefused(state)) {
				return err(
					appError("acp_options_busy", "Chat options cannot change while a reply is running."),
				);
			}
			const ensured = await this.ensureConfigAgent(state);
			if (!ensured.ok) return err(ensured.error);
			try {
				const set = ensured.value.agent.setAcpConfigOption;
				if (set === undefined) {
					return err(appError("acp_options_unsupported", "This agent has no chat options."));
				}
				const changed = await set.call(
					ensured.value.agent,
					params.optionId,
					params.value,
					state.config,
					(agentSessionId) => this.rememberAgentSessionId(state, agentSessionId),
				);
				if (!changed.ok) return err(changed.error);
				const next: SessionConfig = {
					...state.config,
					acpConfig: { ...(state.config.acpConfig ?? {}), [params.optionId]: params.value },
				};
				state.config = next;
				if (state.agentConfig !== null) state.agentConfig = next;
				return ok({ options: changed.value });
			} finally {
				ensured.value.release();
			}
		});
	}

	async getGoal(
		params: AppToSidecarRequestParams<"getGoal">,
	): Promise<AppToSidecarHandlerValue<"getGoal">> {
		const goal = await this.goals.get(params.sessionId);
		return goal.ok ? ok({ goal: goal.value }) : goal;
	}

	async setGoal(
		params: AppToSidecarRequestParams<"setGoal">,
	): Promise<AppToSidecarHandlerValue<"setGoal">> {
		const goal = await this.goals.set(params.sessionId, params.objective, params.tokenBudget);
		return goal.ok ? ok({ goal: goal.value }) : goal;
	}

	async changeGoal(
		params: AppToSidecarRequestParams<"changeGoal">,
	): Promise<AppToSidecarHandlerValue<"changeGoal">> {
		const goal = await this.goals.change(params.sessionId, params.action);
		return goal.ok ? ok({ goal: goal.value }) : goal;
	}

	/**
	 * The goal calls of a Codex chat's thread. The chat keeps a process lease until the call ends,
	 * and a chat that is not Codex is an invalid-params failure.
	 */
	private async goalClientFor(sessionId: SessionId): Promise<Result<CodexGoalHandle, AppError>> {
		const state = this.sessions.get(sessionId);
		if (state === undefined) {
			return err(appError("session_unknown", "The sidecar has no state for this chat."));
		}
		if (state.config.agent !== "codex") {
			return err(appError("invalid_params", "Only Codex chats have goals."));
		}
		const ensured = await this.ensureConfigAgent(state);
		if (!ensured.ok) return err(ensured.error);
		const goalClient = ensured.value.agent.goalClient;
		if (goalClient === undefined) {
			ensured.value.release();
			return err(appError("invalid_params", "This chat's agent does not have goals."));
		}
		const client = await goalClient.call(ensured.value.agent, (agentSessionId) =>
			this.rememberAgentSessionId(state, agentSessionId),
		);
		if (!client.ok) {
			ensured.value.release();
			return err(client.error);
		}
		return ok({
			threadId: client.value.threadId,
			goals: client.value.goals,
			release: ensured.value.release,
		});
	}

	/**
	 * The chat's live agent and whether its runner reports context usage, for the usage reader
	 * (SIDE-17). Null agent when the chat is known but no agent is running.
	 */
	find(sessionId: SessionId): { agent: AgentSession | null; contextUsage: boolean } | undefined {
		const state = this.sessions.get(sessionId);
		if (state === undefined) return undefined;
		const agent = this.liveAgent(state);
		return {
			agent,
			contextUsage: agent === null ? false : (state.runner?.capabilities.contextUsage ?? false),
		};
	}

	onAppAttached(): void {
		for (const sessionId of this.sessions.keys()) {
			const request = this.deps.interactions.openRequest(sessionId);
			if (request === undefined) continue;
			void this.deps.app
				.request("requestInteraction", request)
				.then((result) => {
					if (!result.ok) {
						this.deps.logger.debug("Could not resend an open interaction", {
							sessionId,
							code: result.error.code,
						});
					}
				})
				.catch((cause: unknown) => {
					this.deps.logger.debug("Could not resend an open interaction", {
						sessionId,
						reason: messageOf(cause),
					});
				});
		}
	}

	async shutdown(reason: ShutdownReason): Promise<void> {
		const waiting: Promise<unknown>[] = [];
		for (const state of this.sessions.values()) {
			state.setup?.abort();
			state.queued.clear();
			state.duplicates.cancelInFlight();
			this.deps.interactions.withdrawAll(state.sessionId);
			state.runGuard.invalidate();

			const active = state.activeTurn;
			state.activeTurn = null;
			if (active !== null) waiting.push(active.turn.settled());
			const agent = this.liveAgent(state);
			if (agent !== null) waiting.push(agent.cancel());
		}

		this.deps.logger.info("Stopping every agent", {
			reason,
			turns: waiting.length,
		});
		await this.waitForTurns(waiting);
		await this.deps.processes.stopAll();
		this.sessions.clear();
	}

	private ensureSession(
		params: Pick<StartParams, "sessionId" | "config" | "workspace" | "launch"> & {
			resume?: ResumeParams;
		},
	): SessionState {
		let state = this.sessions.get(params.sessionId);
		if (state === undefined) {
			state = {
				sessionId: params.sessionId,
				config: params.config,
				workspace: params.workspace,
				launch: params.launch,
				agentLaunchFingerprint: null,
				resume: params.resume,
				agent: null,
				agentConfig: null,
				agentSessionId: null,
				runner: null,
				runGuard: new RunGuard(),
				queued: new Queue(),
				duplicates: new Guard(),
				activeTurn: null,
				setup: null,
				autoApproveEdits: false,
				cancelEpoch: 0,
				processKey: null,
			};
			this.sessions.set(params.sessionId, state);
		} else {
			state.config = params.config;
			state.workspace = params.workspace;
			state.launch = params.launch;
			if (params.resume !== undefined) state.resume = params.resume;
		}
		return state;
	}

	/**
	 * Restarts the agent when its launch changed and the chat is idle with no background task,
	 * keeping its resume token. Otherwise the agent keeps running, and every later request asks
	 * again with the launch it carries, so a launch changed back to the running one restarts nothing.
	 */
	private async restartForLaunchChange(state: SessionState): Promise<void> {
		if (this.liveAgent(state) === null) return;
		const change = decideLaunchChange({
			previous: state.agentLaunchFingerprint,
			next: launchFingerprint(state.launch),
			chatWorking: state.activeTurn !== null || this.liveStatus(state.sessionId) === "working",
			hasBackgroundTasks: this.deps.liveState.get(state.sessionId).backgroundTasks.length > 0,
		});
		if (change !== "restart_now") return;
		await this.disposeAgent(state, state.agentConfig ?? state.config, true);
	}

	/** The environment a chat's agent starts with, from the capture and the chat's launch. */
	private agentEnvironment(
		state: SessionState,
		config: SessionConfig,
		workspace: WorkspaceContext,
		captured: CapturedShellEnv,
	): Result<Record<string, string>> {
		return agentEnvironmentFromCapture({
			agent: config.agent,
			...(config.acpAgent === undefined ? {} : { acpAgent: config.acpAgent }),
			sessionId: state.sessionId,
			workspace,
			captured,
			launch: state.launch,
		});
	}

	private configRefused(state: SessionState): boolean {
		return state.activeTurn !== null || this.liveStatus(state.sessionId) === "working";
	}

	/** The chat's live agent, started when it is not running yet, with the lease to give back. */
	private async ensureConfigAgent(
		state: SessionState,
	): Promise<Result<{ agent: AgentSession; release: () => void }, AppError>> {
		const live = this.liveAgent(state);
		if (live !== null) return ok({ agent: live, release: () => {} });
		const runner = this.runnerFor(state.config);
		if (!runner.ok) return err(runner.error);
		const claimed = await this.claimAgent(state, runner.value, state.config, state.workspace);
		if (!claimed.ok) return err(claimed.error);
		return ok({
			agent: claimed.value.agent,
			release: () => this.releaseLease(state, claimed.value.lease),
		});
	}

	/**
	 * The chat's agent, or null when there is none. The process manager stops an idle agent by
	 * itself (the idle stop, the warm cap), so an agent it no longer holds is forgotten here before
	 * anyone uses it; the conversation is kept, and the next start resumes it.
	 */
	private liveAgent(state: SessionState): AgentSession | null {
		const agent = state.agent;
		const config = state.agentConfig;
		if (agent === null || config === null) return agent;
		const key = processKey(config.agent, config.acpAgent, state.sessionId);
		if (this.deps.processes.holds(key, agent)) return agent;
		state.agent = null;
		state.agentConfig = null;
		state.runner = null;
		state.agentLaunchFingerprint = null;
		return null;
	}

	private runnerFor(config: SessionConfig): Result<Runner, AppError> {
		return this.deps.runners.get({ agent: config.agent, acpAgent: config.acpAgent });
	}

	private liveStatus(sessionId: SessionId): SessionStatus {
		return this.deps.liveState.get(sessionId).status;
	}

	private resumeFor(state: SessionState): ResumeParams {
		if (state.agentSessionId !== null) return { agentSessionId: state.agentSessionId };
		return state.resume;
	}

	private async prepareRequest(
		params: AppToSidecarRequestParams<"sendMessage">,
	): Promise<Result<TurnRequest, AppError>> {
		const assembled = await this.deps.prompt.assemble({
			text: params.text,
			attachmentPaths: params.attachmentPaths,
			firstMessage: params.firstMessage,
			workspace: params.workspace,
			config: params.config,
		});
		if (!assembled.ok) return err(assembled.error);
		return ok({
			sessionId: params.sessionId,
			messageId: params.messageId,
			turnId: params.turnId,
			text: params.text,
			agentText: assembled.value,
			attachmentPaths: params.attachmentPaths,
			config: params.config,
			workspace: params.workspace,
		});
	}

	/**
	 * Starts a turn for the request. A failure keeps its own code and message (a missing program, a
	 * key the login shell lacks, a stopped app tools bridge), so the app can show the user why.
	 */
	private async startTurn(
		state: SessionState,
		request: TurnRequest,
		signal?: AbortSignal,
	): Promise<Result<void, AppError>> {
		this.deps.interactions.withdrawAll(state.sessionId);
		await this.replaceAgentIfKindChanged(state, request.config);
		if (this.liveAgent(state) !== null) {
			await this.applyConfigToLiveAgent(state, request.config);
		}

		const runnerResult = this.runnerFor(request.config);
		if (!runnerResult.ok) {
			this.deps.logger.warn("Could not find the chat's agent", {
				sessionId: state.sessionId,
				code: runnerResult.error.code,
				message: runnerResult.error.message,
			});
			state.duplicates.forget(request.messageId);
			return err(runnerResult.error);
		}

		const claimed = await this.claimAgent(
			state,
			runnerResult.value,
			request.config,
			request.workspace,
		);
		if (!claimed.ok) {
			this.deps.logger.warn("Could not start the chat's agent", {
				sessionId: state.sessionId,
				code: claimed.error.code,
				message: claimed.error.message,
			});
			state.duplicates.forget(request.messageId);
			return err(claimed.error);
		}

		const { agent, lease } = claimed.value;
		if (signal?.aborted) {
			this.releaseLease(state, lease);
			state.duplicates.forget(request.messageId);
			return err(appError("cancelled", "The message was cancelled before it was sent."));
		}
		const turn = this.createTurn(this.turnDeps(state, agent), request);
		state.duplicates.markRunning(request.messageId);
		state.duplicates.rememberDelivery(request.messageId, "new_turn");
		state.activeTurn = { turn, messageId: request.messageId, turnId: request.turnId };
		try {
			await turn.start();
			return ok(undefined);
		} catch (cause) {
			if (state.activeTurn?.turn === turn) state.activeTurn = null;
			state.duplicates.forget(request.messageId);
			this.deps.logger.warn("A turn could not be started", {
				sessionId: state.sessionId,
				reason: messageOf(cause),
			});
			return err(appError("turn_start_failed", messageOf(cause), cause));
		} finally {
			this.releaseLease(state, lease);
		}
	}

	private async deliverSteer(
		state: SessionState,
		request: TurnRequest,
		signal: AbortSignal,
	): Promise<AppToSidecarHandlerValue<"sendMessage">> {
		const command = parseGoalCommand(request.text);
		if (!command.ok) {
			state.duplicates.forget(request.messageId);
			return err(command.error);
		}
		if (command.value !== null && request.config.agent === "codex") {
			return this.deliverGoalCommand(state, request, command.value);
		}
		const runnerResult = this.runnerFor(request.config);
		if (!runnerResult.ok) {
			state.duplicates.forget(request.messageId);
			return err(runnerResult.error);
		}
		const claimed = await this.claimAgent(
			state,
			runnerResult.value,
			request.config,
			request.workspace,
		);
		if (!claimed.ok) {
			state.duplicates.forget(request.messageId);
			return err(claimed.error);
		}

		const { agent, lease } = claimed.value;
		const epoch = state.cancelEpoch;
		try {
			const { consumed } = await agent.steer({
				text: request.agentText,
				attachmentPaths: request.attachmentPaths,
				config: request.config,
			});
			if (signal.aborted || epoch !== state.cancelEpoch) {
				state.duplicates.forget(request.messageId);
				return err(appError("cancelled", "The message was cancelled while it was being steered."));
			}

			state.duplicates.markHandled(request.messageId);
			state.duplicates.rememberDelivery(request.messageId, "steer");
			this.deps.interactions.withdrawAll(state.sessionId);
			// The agent has the message now. A failure of the bookkeeping below must not send it to the
			// agent a second time through the steer-failed path.
			try {
				await this.deps.liveState.update(state.sessionId, (live) =>
					addPendingSteer(live, request.messageId),
				);
			} catch (cause) {
				this.deps.logger.warn("A delivered steer could not be marked pending", {
					sessionId: state.sessionId,
					reason: messageOf(cause),
				});
			}
			this.publishUserMessage(request, "steer");
			void consumed
				.then(
					() => this.steerConsumed(state, request.messageId, epoch),
					(cause: unknown) => {
						this.deps.logger.warn("The agent did not read a steer", {
							sessionId: state.sessionId,
							reason: messageOf(cause),
						});
					},
				)
				.catch((cause: unknown) => {
					this.deps.logger.warn("A steer could not be marked read", {
						sessionId: state.sessionId,
						reason: messageOf(cause),
					});
				});
			return ok({ deliveredAs: "steer" });
		} catch (cause) {
			if (signal.aborted || epoch !== state.cancelEpoch) {
				state.duplicates.forget(request.messageId);
				return err(appError("cancelled", "The message was cancelled while it was being steered."));
			}
			return this.steerFailed(state, request, cause);
		} finally {
			this.releaseLease(state, lease);
		}
	}

	/** A `/goal` steer changes the chat's Codex goal instead of reaching the running turn. */
	private async deliverGoalCommand(
		state: SessionState,
		request: TurnRequest,
		command: GoalCommand,
	): Promise<AppToSidecarHandlerValue<"sendMessage">> {
		const changed =
			command.action === "set"
				? await this.goals.set(state.sessionId, command.objective)
				: await this.goals.change(state.sessionId, command.action);
		if (!changed.ok) {
			state.duplicates.forget(request.messageId);
			return err(changed.error);
		}
		state.duplicates.markHandled(request.messageId);
		state.duplicates.rememberDelivery(request.messageId, "steer");
		this.deps.interactions.withdrawAll(state.sessionId);
		this.publishUserMessage(request, "steer");
		return ok({ deliveredAs: "steer" });
	}

	private async steerFailed(
		state: SessionState,
		request: TurnRequest,
		cause: unknown,
	): Promise<AppToSidecarHandlerValue<"sendMessage">> {
		const fallback = resolveSteerFailure(this.steerFailure(state, cause));
		this.deps.logger.warn("A steer was not delivered", {
			sessionId: state.sessionId,
			reason: messageOf(cause),
			fallback: fallback.action,
		});

		switch (fallback.action) {
			case "new_turn": {
				const started = await this.startTurn(state, request);
				if (started.ok) return ok({ deliveredAs: "new_turn" });
				return err(started.error);
			}
			case "queue":
				state.duplicates.forget(request.messageId);
				this.enqueue(state, request);
				return ok({ deliveredAs: "queued" });
			case "drop":
				state.duplicates.forget(request.messageId);
				return err(appError("cancelled", "The message was cancelled while it was being steered."));
			case "fail":
				state.duplicates.forget(request.messageId);
				return err(appError("steer_failed", fallback.reason));
		}
	}

	private steerFailure(state: SessionState, cause: unknown): SteerFailure {
		if (cause instanceof NoActiveTurnError) {
			return {
				kind: "no_active_turn",
				sessionIdle: this.liveStatus(state.sessionId) === "idle",
			};
		}
		if (cause instanceof SteerRevertedError) return { kind: "reverted" };
		if (cause instanceof SteerNotSupportedError) return { kind: "unsupported" };
		return { kind: "other", message: messageOf(cause) };
	}

	private async steerConsumed(
		state: SessionState,
		messageId: MessageId,
		epoch: number,
	): Promise<void> {
		if (epoch !== state.cancelEpoch) return;
		state.duplicates.markHandled(messageId);
		await this.deps.liveState.update(state.sessionId, (live) =>
			removePendingSteer(live, messageId),
		);
	}

	private enqueue(state: SessionState, request: TurnRequest): void {
		this.deps.interactions.withdrawAll(state.sessionId);
		state.queued.enqueue(request);
		state.duplicates.markQueued(request.messageId);
		state.duplicates.rememberDelivery(request.messageId, "queued");
	}

	/** Stops a live agent whose kind the new config no longer matches, so a fresh one starts. */
	private async replaceAgentIfKindChanged(
		state: SessionState,
		config: SessionConfig,
	): Promise<void> {
		if (state.agentConfig !== null && !sameAgent(state.agentConfig, config)) {
			await this.disposeAgent(state, state.agentConfig, false);
		}
	}

	/**
	 * Applies the message's config to the agent that is already running, before the turn starts.
	 * A restart keeps the agent's session id so the new process resumes the same conversation.
	 */
	private async applyConfigToLiveAgent(state: SessionState, config: SessionConfig): Promise<void> {
		const agent = this.liveAgent(state);
		if (agent === null) return;
		try {
			const applied = await agent.applyConfig(config);
			if (applied === "restart") {
				await this.disposeAgent(state, state.agentConfig ?? config, true);
			} else {
				state.agentConfig = config;
			}
		} catch (cause) {
			this.deps.logger.warn("Could not apply the message's settings; restarting the agent", {
				sessionId: state.sessionId,
				reason: messageOf(cause),
				keepResume: true,
			});
			await this.disposeAgent(state, state.agentConfig ?? config, true);
		}
	}

	/** Starts an agent and records it on the chat, including the current auto-approve choice. */
	private async startAgent(
		state: SessionState,
		runner: Runner,
		config: SessionConfig,
		workspace: WorkspaceContext,
		env: Readonly<Record<string, string>>,
	): Promise<AgentSession> {
		const resume = this.resumeFor(state);
		const agent = await runner.start({
			sessionId: state.sessionId,
			config,
			workspace,
			env,
			...(state.launch.executablePath === undefined
				? {}
				: { executablePath: state.launch.executablePath }),
			...(resume === undefined ? {} : { resume }),
			onConfigChanged: (next, reason) => this.applyAgentConfig(state, next, reason),
			onGoalEvent: (event) => this.goals.onServerGoalEvent(state.sessionId, event),
		});
		state.agent = agent;
		state.agentConfig = config;
		state.runner = runner;
		state.agentLaunchFingerprint = launchFingerprint(state.launch);
		if (state.autoApproveEdits) agent.setAutoApproveEdits?.(true);
		return agent;
	}

	/** Stores a config the agent changed by itself and tells the app, so its stored config agrees. */
	private applyAgentConfig(
		state: SessionState,
		config: SessionConfig,
		reason: AgentConfigChangeReason,
	): void {
		state.config = config;
		if (state.agentConfig !== null) state.agentConfig = config;
		this.deps.app.notify("agentConfigChanged", {
			sessionId: state.sessionId,
			config,
			reason,
		});
	}

	private async claimAgent(
		state: SessionState,
		runner: Runner,
		config: SessionConfig,
		workspace: WorkspaceContext,
	): Promise<Result<{ agent: AgentSession; lease: { release(): void } }, AppError>> {
		const captured = await this.deps.shellEnv.get(workspace.workspacePath);
		if (!captured.ok) return err(captured.error);
		const env = this.agentEnvironment(state, config, workspace, captured.value);
		if (!env.ok) return err(env.error);
		const key = processKey(config.agent, config.acpAgent, state.sessionId);
		const start = (): Promise<AgentSession> =>
			this.startAgent(state, runner, config, workspace, env.value);

		try {
			const lease = await this.deps.processes.claimActive(key, start);
			state.processKey = key;
			state.agent = lease.agent;
			state.agentConfig = config;
			state.runner = runner;
			return ok({ agent: lease.agent, lease });
		} catch (cause) {
			// Runners throw an AppError (a plain object) for a missing program or a stopped bridge;
			// it is kept whole, so its own code and message reach the app.
			if (isAppError(cause)) return err(cause);
			return err(appError("agent_start_failed", messageOf(cause), cause));
		}
	}

	private async disposeAgent(
		state: SessionState,
		config: SessionConfig,
		keepResume: boolean,
	): Promise<void> {
		const key = processKey(config.agent, config.acpAgent, state.sessionId);
		state.agent = null;
		state.agentConfig = null;
		state.runner = null;
		state.agentLaunchFingerprint = null;
		if (!keepResume) {
			state.agentSessionId = null;
			state.resume = undefined;
		}
		try {
			await this.deps.processes.disconnect(key);
		} catch (cause) {
			this.deps.logger.warn("Could not stop the chat's agent", {
				sessionId: state.sessionId,
				reason: messageOf(cause),
			});
		}
	}

	private turnDeps(state: SessionState, agent: AgentSession): TurnDeps {
		return {
			agent,
			runGuard: state.runGuard,
			publisher: this.deps.publisher,
			liveState: this.deps.liveState,
			interactions: this.deps.interactions,
			checkpoints: this.deps.checkpoints,
			clock: this.deps.clock,
			ids: this.deps.ids,
			logger: this.deps.logger,
			onAgentSessionId: (agentSessionId) => this.rememberAgentSessionId(state, agentSessionId),
			onTurnSettled: (run) => this.turnSettled(state, run),
			onBackgroundTasks: (hasTasks) => {
				if (state.processKey !== null) {
					this.deps.processes.setBackgroundTasks(state.processKey, hasTasks);
				}
			},
		};
	}

	/**
	 * Gives a lease back. The process manager keeps a process busy after its lease is released,
	 * because it cannot tell whether a turn is running. Only this manager knows, so when no turn
	 * runs it marks the process idle, which starts the 30-minute idle clock.
	 */
	private releaseLease(state: SessionState, lease: { release(): void }): void {
		lease.release();
		this.markProcessIdleWhenNoTurn(state);
	}

	private markProcessIdleWhenNoTurn(state: SessionState): void {
		if (state.activeTurn !== null || state.processKey === null) return;
		this.deps.processes.markIdle(state.processKey);
	}

	private rememberAgentSessionId(state: SessionState, agentSessionId: string): void {
		if (state.agentSessionId === agentSessionId) return;
		state.agentSessionId = agentSessionId;
		this.deps.app.notify("agentSessionId", {
			sessionId: state.sessionId,
			agentSessionId,
		});
	}

	private turnSettled(state: SessionState, run: RunNumber): void {
		this.deps.queue
			.run(queueKey(state.sessionId), async () => {
				if (!state.runGuard.isCurrent(run)) return;
				const active = state.activeTurn;
				if (active !== null) {
					state.activeTurn = null;
					state.duplicates.markHandled(active.messageId);
				}
				state.duplicates.cancelInFlight();
				// Before the drain: a queued message that starts next takes a new lease of its own.
				this.markProcessIdleWhenNoTurn(state);
				await this.drain(state);
			})
			.catch((cause: unknown) => {
				this.deps.logger.error("The next queued message could not start", {
					sessionId: state.sessionId,
					reason: messageOf(cause),
				});
			});
	}

	private async drain(state: SessionState): Promise<void> {
		while (
			state.activeTurn === null &&
			state.queued.size > 0 &&
			this.liveStatus(state.sessionId) === "idle"
		) {
			const next = state.queued.dequeue();
			if (next === undefined) return;
			const started = await this.startTurn(state, next);
			if (started.ok) return;
			this.publishUnstarted(next, started.error);
		}
	}

	/**
	 * A queued message whose turn could not start. The app was told it was queued and hears nothing
	 * else about it, so it is stored as a user message whose turn ended with the reason, and the
	 * chat shows both instead of losing the message.
	 */
	private publishUnstarted(request: TurnRequest, error: AppError): void {
		this.deps.publisher.publish(request.sessionId, {
			type: "user_message",
			eventId: this.deps.ids.uuid() as EventId,
			at: this.deps.clock.now(),
			messageId: request.messageId,
			turnId: request.turnId,
			text: request.text,
			attachmentPaths: request.attachmentPaths,
			delivery: "new_turn",
			config: request.config,
		});
		this.deps.publisher.publish(request.sessionId, {
			type: "turn_ended",
			eventId: this.deps.ids.uuid() as EventId,
			at: this.deps.clock.now(),
			turnId: request.turnId,
			outcome: "error",
			error: error.message,
		});
	}

	private publishUserMessage(request: TurnRequest, delivery: "steer"): void {
		const event: SessionEvent = {
			type: "user_message",
			eventId: this.deps.ids.uuid() as EventId,
			at: this.deps.clock.now(),
			messageId: request.messageId,
			turnId: request.turnId,
			text: request.text,
			attachmentPaths: request.attachmentPaths,
			delivery,
			config: request.config,
		};
		this.deps.publisher.publish(request.sessionId, event);
	}

	/**
	 * The config to warm with: the chosen model when the agent offers it, else the agent's default
	 * (sessions.md 3). The list comes from the model catalog, so warming twice lists once.
	 */
	private async warmConfig(sessionId: SessionId, config: SessionConfig): Promise<SessionConfig> {
		const listed = await this.deps.models.list(config.agent, config.acpAgent);
		if (!listed.ok) {
			this.deps.logger.warn("Could not check the model before warming the agent", {
				sessionId,
				code: listed.error.code,
				message: listed.error.message,
			});
			return config;
		}
		const models = listed.value;
		if (models.some((model) => model.id === config.model)) return config;
		const fallback = models.find((model) => model.isDefault);
		if (fallback === undefined) return config;
		this.deps.logger.warn("The chosen model is not available; warming with the default model", {
			agent: config.agent,
			model: config.model,
			fallback: fallback.id,
		});
		return { ...config, model: fallback.id };
	}

	private async waitForTurns(work: readonly Promise<unknown>[]): Promise<void> {
		if (work.length === 0) return;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const timeout = new Promise<void>((resolve) => {
			timer = setTimeout(resolve, SHUTDOWN_TURN_WAIT_MS);
		});
		try {
			await Promise.race([Promise.allSettled(work).then(() => undefined), timeout]);
		} finally {
			if (timer !== undefined) clearTimeout(timer);
		}
	}
}
