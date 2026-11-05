/**
 * @feature SIDE-03 Session manager: per-session queue, duplicate guard, idle after flush
 * Owns: every chat the sidecar knows about, and the app's requests about them: sendMessage,
 * cancel, warmAgent, resetAgent, updateConfig, setAutoApproveEdits, getSessionStatus and
 * answerInteraction.
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
 *  - getSessionStatus for a chat the sidecar does not know: known false (it restarted)
 *  - the first message adds the workspace instruction block (prompt/); later ones do not
 *  - cancel drops queued messages, withdraws interactions, asks the running turn to take the end
 *    checkpoint, and reports wasWorking
 *  - shutdown(): stop every agent, take no checkpoint, wait up to 10 s for in-flight turns
 *  - the same agent session id is stored from the first callback and sent to the app once
 * Test first: two sendMessage calls with the same messageId start one turn; the second answer
 * repeats the first deliveredAs.
 * Our design choice: queued messages live in memory only. The app owns the persistent follow-up
 * queue (CHAT-04) and re-sends after a restart; this queue is the second line Conductor also has.
 */
import type {
	AgentLaunch,
	LiveState,
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
} from "@conducted/shared";
import { appError, err, ok } from "@conducted/shared";
import type { CheckpointService } from "../checkpoints/checkpoint-service.ts";
import type { Logger } from "../logging/logger.ts";
import type { ProcessManager } from "../process/process-manager.ts";
import { processKey } from "../process/process-manager.ts";
import type { PromptAssembler } from "../prompt/assemble.ts";
import type {
	AppToSidecarHandlerValue,
	AppToSidecarRequestParams,
	SidecarToApp,
} from "../rpc/types.ts";
import {
	NoActiveTurnError,
	SteerNotSupportedError,
	SteerRevertedError,
} from "../runners/errors.ts";
import type { RunnerRegistry } from "../runners/registry.ts";
import type { AgentSession, Runner, RunnerCapabilities, TurnOutcome } from "../runners/runner.ts";
import type { ShellEnvProvider } from "../shell-env/capture.ts";
import { messageOf } from "../util/errors.ts";
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
	/** Live state of a chat, for the process manager's busy and idle marks. */
	liveStateOf(sessionId: SessionId): LiveState | undefined;
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
}

interface SessionState {
	readonly sessionId: SessionId;
	config: SessionConfig;
	workspace: WorkspaceContext;
	launch: AgentLaunch;
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

	constructor(protected readonly deps: SessionManagerDeps) {
		this.createTurn = deps.createTurn ?? ((turnDeps, request) => new Turn(turnDeps, request));
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
						if (!started) {
							if (setup.signal.aborted) {
								return err(appError("cancelled", "The message was cancelled before it was sent."));
							}
							return err(appError("send_failed", "The message could not start a turn."));
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
			const runnerResult = this.runnerFor(params.config);
			if (!runnerResult.ok) {
				this.deps.logger.warn("Could not warm the agent", {
					sessionId: state.sessionId,
					code: runnerResult.error.code,
					message: runnerResult.error.message,
				});
				return ok({});
			}

			let config = params.config;
			try {
				config = await this.warmConfig(runnerResult.value, config);
			} catch (cause) {
				this.deps.logger.warn("Could not check the model before warming the agent", {
					sessionId: state.sessionId,
					reason: messageOf(cause),
				});
			}
			state.config = config;
			await this.replaceAgentIfKindChanged(state, config);

			const env = await this.deps.shellEnv.get(params.workspace.workspacePath);
			if (!env.ok) {
				this.deps.logger.warn("Could not warm the agent without the login-shell environment", {
					sessionId: state.sessionId,
					code: env.error.code,
					message: env.error.message,
				});
				return ok({});
			}

			const key = processKey(config.agent, config.acpAgent, state.sessionId);
			try {
				await this.deps.processes.ensureWarm(key, () =>
					this.startAgent(state, runnerResult.value, config, params.workspace, env.value.env),
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

			if (state.agent === null) return ok({ applied: "live" });

			try {
				const applied = await state.agent.applyConfig(params.config);
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
		state.agent?.setAutoApproveEdits?.(params.enabled);
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
		return ok(this.deps.interactions.answer(state.sessionId, params.interactionId, params.answer));
	}

	liveStateOf(sessionId: SessionId): LiveState | undefined {
		if (!this.sessions.has(sessionId)) return undefined;
		return this.deps.liveState.get(sessionId);
	}

	/**
	 * The chat's live agent and whether its runner reports context usage, for the usage reader
	 * (SIDE-17). Null agent when the chat is known but no agent is running.
	 */
	find(sessionId: SessionId): { agent: AgentSession | null; contextUsage: boolean } | undefined {
		const state = this.sessions.get(sessionId);
		if (state === undefined) return undefined;
		return {
			agent: state.agent,
			contextUsage: state.runner?.capabilities.contextUsage ?? false,
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
			if (state.agent !== null) waiting.push(state.agent.cancel());
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

	private async startTurn(
		state: SessionState,
		request: TurnRequest,
		signal?: AbortSignal,
	): Promise<boolean> {
		this.deps.interactions.withdrawAll(state.sessionId);
		await this.replaceAgentIfKindChanged(state, request.config);
		if (state.agent !== null) {
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
			return false;
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
			return false;
		}

		const { agent, lease } = claimed.value;
		if (signal?.aborted) {
			lease.release();
			state.duplicates.forget(request.messageId);
			return false;
		}
		const turn = this.createTurn(this.turnDeps(state, agent), request);
		state.duplicates.markRunning(request.messageId);
		state.duplicates.rememberDelivery(request.messageId, "new_turn");
		state.activeTurn = { turn, messageId: request.messageId };
		try {
			await turn.start();
			return true;
		} catch (cause) {
			if (state.activeTurn?.turn === turn) state.activeTurn = null;
			state.duplicates.forget(request.messageId);
			this.deps.logger.warn("A turn could not be started", {
				sessionId: state.sessionId,
				reason: messageOf(cause),
			});
			return false;
		} finally {
			lease.release();
		}
	}

	private async deliverSteer(
		state: SessionState,
		request: TurnRequest,
		signal: AbortSignal,
	): Promise<AppToSidecarHandlerValue<"sendMessage">> {
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
			lease.release();
		}
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
				if (started) return ok({ deliveredAs: "new_turn" });
				return err(appError("send_failed", "The message could not start a turn."));
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
		const agent = state.agent;
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
			...(resume === undefined ? {} : { resume }),
		});
		state.agent = agent;
		state.agentConfig = config;
		state.runner = runner;
		if (state.autoApproveEdits) agent.setAutoApproveEdits?.(true);
		return agent;
	}

	private async claimAgent(
		state: SessionState,
		runner: Runner,
		config: SessionConfig,
		workspace: WorkspaceContext,
	): Promise<Result<{ agent: AgentSession; lease: { release(): void } }, AppError>> {
		const env = await this.deps.shellEnv.get(workspace.workspacePath);
		if (!env.ok) return err(env.error);
		const key = processKey(config.agent, config.acpAgent, state.sessionId);
		const start = (): Promise<AgentSession> =>
			this.startAgent(state, runner, config, workspace, env.value.env);

		try {
			const lease = await this.deps.processes.claimActive(key, start);
			state.agent = lease.agent;
			state.agentConfig = config;
			state.runner = runner;
			return ok({ agent: lease.agent, lease });
		} catch (cause) {
			const message = messageOf(cause);
			return err(appError("agent_start_failed", message, cause));
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
		};
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
			if (started) return;
		}
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

	private async warmConfig(runner: Runner, config: SessionConfig): Promise<SessionConfig> {
		const models = await runner.listModels();
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
