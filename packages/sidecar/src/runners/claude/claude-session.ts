/**
 * @feature AGENT-02 Claude: Agent SDK in streaming-input mode, resume, fork
 * Owns: one chat's Claude process. It holds the SDK query object, the input queue that feeds it,
 * the translator, the turn tracker, the permission handler and the steer receipts, and implements
 * AgentSession on top of them.
 * Behaviour: research/conductor/claude-runner.md sections 1 to 3 and 6, sessions.md section 3
 * "Claude". One `claude` process lives for the whole chat. Each user message is pushed into the
 * same input stream (util/async-queue.ts). The query object yields SDK messages, which the
 * translator turns into AgentMessage values.
 * Must handle:
 *  - runTurn while another turn runs: refused with an error outcome (the manager prevents it)
 *  - cancel(): in-band interrupt first, wait INTERRUPT_GRACE_MS for the result, then stop the
 *    process (SIDE-04 takes the end checkpoint). Pending interactions are withdrawn by the manager
 *  - the process exits or the stream throws: the turn ends with an error outcome whose message
 *    carries the exit code, the signal and the stderr tail; the next runTurn respawns with resume
 *  - a respawn resumes the transcript of our own id, so history is never claimed twice
 *  - task_started, task_notification and task_updated messages update the background task list
 *    through TurnCallbacks.onBackgroundTasks; that list is reset when the process respawns
 *  - the first SDK message with a session id reports it through onAgentSessionId
 *  - the "Fast mode requires extra usage billing" stderr line calls onFastModeUnavailable
 *  - the PreToolUse hook awaits beforeFirstWrite() once per turn for tools that can write
 *  - a late message from a cancelled turn must not reach the next turn's callbacks
 *  - dispose(): close the input queue, abort, wait for exit (SIGTERM, SIGKILL after 5 s by the SDK)
 *  - AskUserQuestion, tool approval and ExitPlanMode go through TurnCallbacks.requestInteraction
 *  - applyConfig sends a plan or approvals change with setPermissionMode first, then a model change
 *    with setModel, then an effort change with applyFlagSettings when the model supports it (else a
 *    restart); a change during a turn waits for the next turn
 *  - a live config sync that fails before a turn ends that turn with an error the app sees, so it
 *    never runs in bypassPermissions; an effort change that needs a restart restarts the process
 *    before the message is sent
 *  - an approved plan records the permission mode the CLI switched to
 *  - a plan mode the agent chose (an EnterPlanMode call, or an init that reports "plan" when the app
 *    has not just asked for a non-plan mode) updates the session config and reports it through
 *    onConfigChanged; an approved plan reports leaving it; an init that reports plan after the app
 *    asked for a non-plan mode is ignored, so the app's choice wins
 *  - steer() pushes a fresh user message into the open turn and reports when the transcript mirror
 *    shows the agent read it (AGENT-05); with no open turn it throws NoActiveTurnError
 *  - planUsage() asks the SDK's experimental usage request without the behavior scan and converts
 *    the response with the SIDE-17 model; with no live process it reports no limits, and a refusal
 *    is passed to the caller
 * Test first: with a scripted query function that yields init, assistant text and a result for
 * the pushed uuid, runTurn emits the text message and resolves with success.
 * Our design choice: the SDK's query function is a constructor parameter (Conductor does this
 * too), so tests drive the session with a scripted stream and never start a real CLI. The
 * translator, the permission handler and the app tools server are injected as well, so this
 * feature can be built and tested before AGENT-03, AGENT-04 and SIDE-12 exist.
 */
import type {
	CanUseTool,
	Options,
	PermissionMode,
	Query,
	SDKMessage,
	SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { Effort, RateLimit, SessionConfig } from "@conducted/protocol";
import type { SessionId } from "@conducted/shared";
import type { Logger } from "../../logging/logger.ts";
import { rateLimitsFromSdk } from "../../models/usage.ts";
import type { AppToolBackend } from "../../tools/backend.ts";
import { AsyncQueue } from "../../util/async-queue.ts";
import { messageOf } from "../../util/errors.ts";
import { NoActiveTurnError } from "../errors.ts";
import type {
	AgentSession,
	StartOptions,
	TurnCallbacks,
	TurnInput,
	TurnOutcome,
} from "../runner.ts";
import { ClaudeBackgroundTasks } from "./background-tasks.ts";
import { type CheckpointGate, createCheckpointHook } from "./checkpoint-hook.ts";
import { classifyConfigChange } from "./config-change.ts";
import { INTERRUPT_GRACE_MS } from "./constants.ts";
import { claudeEffortOption } from "./launch-settings.ts";
import { buildClaudeOptions } from "./options.ts";
import type { PermissionHandlerDeps } from "./permission-handler.ts";
import { permissionModeFor } from "./permissions.ts";
import { createMirrorStore } from "./session-mirror.ts";
import { SteerReceipts } from "./steer-receipts.ts";
import type { ClaudeTranslator } from "./translate.ts";
import { ClaudeTurnTracker, type Scheduler } from "./turn-tracker.ts";

/** The SDK's query function, as a type. */
export type QueryFunction = (params: {
	prompt: AsyncIterable<SDKUserMessage>;
	options?: Options;
}) => Query;

export interface ClaudeSessionDeps {
	query: QueryFunction;
	executablePath: string;
	appTools: AppToolBackend;
	logger: Logger;
	/** Turns SDK messages into our neutral format (AGENT-03). */
	translator: ClaudeTranslator;
	/** Checks for a resumable transcript on disk. */
	hasTranscript(sessionId: SessionId, cwd: string): Promise<boolean>;
	/** Resolves symlinks for the edit-path check. Returns null when the path cannot be resolved. */
	realPath(path: string): Promise<string | null>;
	newUuid(): string;
	/** Timers for the settlement watchdog; tests pass a fake. */
	scheduler: Scheduler;
	/** Builds the SDK's canUseTool callback (AGENT-04). */
	createCanUseTool(deps: PermissionHandlerDeps): CanUseTool;
	/** Builds the app tools MCP server for this chat (SIDE-12). */
	createMcpServers(input: {
		sessionId: SessionId;
		appTools: SessionConfig["appTools"];
		backend: AppToolBackend;
		logger: Logger;
	}): NonNullable<Options["mcpServers"]>;
}

interface Deferred<T> {
	promise: Promise<T>;
	resolve(value: T): void;
}

/** A promise a later event resolves, such as the result message that ends a turn. */
function deferred<T>(): Deferred<T> {
	let resolve: (value: T) => void = () => {};
	const promise = new Promise<T>((settle) => {
		resolve = settle;
	});
	return { promise, resolve };
}

export class ClaudeSession implements AgentSession {
	readonly sessionId: SessionId;

	private readonly receipts = new SteerReceipts();
	private readonly tracker: ClaudeTurnTracker;
	private readonly backgroundTasks = new ClaudeBackgroundTasks();
	private config: SessionConfig;
	private input: AsyncQueue<SDKUserMessage> | null = null;
	private query: Query | null = null;
	private abortController: AbortController | null = null;
	private callbacks: TurnCallbacks | null = null;
	private currentGate: (() => Promise<void>) | undefined;
	private turnDeferred: Deferred<TurnOutcome> | null = null;
	private turnOpen = false;
	private turnSettled = true;
	private cancelling = false;
	/** Bumped by cancel and dispose so a start that raced them does not send its message. */
	private generation = 0;
	private disposed = false;
	private agentSessionId: string | null = null;
	private agentSessionIdReported = false;
	/** The app's auto-accept edits control: true or false wins over an answer based grant. */
	private autoApproveEditsOverride: boolean | undefined;
	/** The settings the live process is known to run with, for live reconfiguration. */
	private appliedModel: string | null = null;
	private appliedEffort: Effort | null = null;
	private appliedPermissionMode: PermissionMode | null = null;
	/**
	 * The plan mode the app last asked for, until the agent changes the mode itself. A stale CLI init
	 * must not undo a choice the user just made in the app.
	 */
	private appPlanModeChoice: boolean | null = null;
	private exited: Promise<void> = Promise.resolve();
	private startPending: Promise<void> | null = null;
	/** Resolves once the open turn's first user message is in the input stream. */
	private firstMessage: Deferred<void> | null = null;
	private readonly stderrTail: string[] = [];

	constructor(
		protected readonly deps: ClaudeSessionDeps,
		protected readonly start: StartOptions,
	) {
		this.sessionId = start.sessionId;
		this.config = start.config;
		this.tracker = new ClaudeTurnTracker({
			receipts: this.receipts,
			scheduler: deps.scheduler,
			onSettle: (outcome) => this.settleTurn(outcome),
		});
	}

	/** Spawns the process (query() with an open input stream) so the first message starts fast. */
	async warm(): Promise<void> {
		await this.ensureStarted();
	}

	async runTurn(input: TurnInput, callbacks: TurnCallbacks): Promise<TurnOutcome> {
		if (this.turnOpen) {
			return {
				kind: "error",
				message: "A turn is already in progress for this chat.",
				retryable: false,
			};
		}
		this.turnOpen = true;
		this.turnSettled = false;
		this.cancelling = false;
		this.callbacks = callbacks;
		const turn = deferred<TurnOutcome>();
		this.turnDeferred = turn;
		this.firstMessage = deferred<void>();
		this.currentGate = once(() => callbacks.beforeFirstWrite());
		this.config = input.config;
		if (this.agentSessionId !== null && !this.agentSessionIdReported) {
			this.agentSessionIdReported = true;
			callbacks.onAgentSessionId(this.agentSessionId);
		}

		const generation = this.generation;
		try {
			await this.ensureStarted();
		} catch (cause) {
			return this.failStart(cause);
		}

		// A cancel or dispose during the start settled the turn and must not send the message.
		if (generation !== this.generation || this.turnSettled) {
			const outcome = await turn.promise;
			this.finishTurn();
			return outcome;
		}

		// A config change deferred while the last turn ran is applied before this message. A
		// failure must end the turn: the process is still in bypassPermissions until the mode
		// switch succeeds.
		let restart: boolean;
		try {
			restart = await this.syncLiveConfig();
		} catch (cause) {
			return this.failConfigSync(cause);
		}
		// A cancel during the control requests settled the turn and must not send the message.
		if (generation !== this.generation || this.turnSettled) {
			const outcome = await turn.promise;
			this.finishTurn();
			return outcome;
		}
		if (restart) {
			// The new effort only takes effect in a new process. The next process starts with the
			// current model and effort, and the permission mode is applied live again below.
			this.stopProcess();
			try {
				await this.ensureStarted();
			} catch (cause) {
				return this.failStart(cause);
			}
			if (generation !== this.generation || this.turnSettled) {
				const outcome = await turn.promise;
				this.finishTurn();
				return outcome;
			}
			try {
				await this.syncLiveConfig();
			} catch (cause) {
				return this.failConfigSync(cause);
			}
		}

		const uuid = this.deps.newUuid();
		this.tracker.expectTurn(uuid);
		const queue = this.input;
		const pushed = queue?.push(this.userMessage(input.text, uuid)) ?? false;
		this.firstMessage?.resolve();
		if (!pushed) {
			this.finishTurn();
			return {
				kind: "error",
				message: "The Claude session ended before the message could be sent.",
				retryable: true,
			};
		}

		const outcome = await turn.promise;
		this.finishTurn();
		return outcome;
	}

	async steer(input: TurnInput): Promise<{ consumed: Promise<void> }> {
		if (!this.turnOpen || this.turnSettled) throw new NoActiveTurnError();
		// A steer can arrive while the turn is still starting. Wait for its first message so the
		// steer joins the stream after it, never before it.
		const first = this.firstMessage;
		if (first !== null) await first.promise;
		if (!this.turnOpen || this.turnSettled) throw new NoActiveTurnError();
		const queue = this.input;
		if (queue === null || queue.isClosed) throw new NoActiveTurnError();

		const uuid = this.deps.newUuid();
		const consumed = this.receipts.register(uuid);
		// The tracker must know this uuid: a result that answers the steer can end the turn, and a
		// result that arrives before the mirror shows it read is held back.
		this.tracker.expectTurn(uuid);
		if (!queue.push(this.userMessage(input.text, uuid))) {
			// The turn ended between the check and the push, so no receipt is left waiting.
			this.receipts.consume(uuid);
			throw new NoActiveTurnError();
		}
		return { consumed };
	}

	async cancel(): Promise<void> {
		if (!this.turnOpen) return;
		this.generation += 1;
		this.cancelling = true;
		const query = this.query;
		if (query === null) {
			this.settleCancelled();
			return;
		}
		try {
			await query.interrupt();
		} catch (cause) {
			this.deps.logger.debug("The Claude interrupt request failed", {
				sessionId: this.sessionId,
				message: messageOf(cause),
			});
		}
		const ended = await this.waitForTurn(INTERRUPT_GRACE_MS);
		if (ended) return;
		// The agent did not stop on the interrupt, so stop the process. The next turn resumes.
		this.settleCancelled();
		this.stopProcess();
	}

	async applyConfig(config: SessionConfig): Promise<"applied" | "restart"> {
		const change = classifyConfigChange(this.config, config);
		if (this.config.planMode !== config.planMode) this.appPlanModeChoice = config.planMode;
		this.config = config;
		if (change.kind === "restart") return "restart";
		// A live change waits while a turn runs; runTurn applies it before the next message.
		if (this.turnOpen) return "applied";
		if (this.query === null) return "applied";
		try {
			return (await this.syncLiveConfig()) ? "restart" : "applied";
		} catch (cause) {
			this.deps.logger.warn("Could not apply the Claude config live", {
				sessionId: this.sessionId,
				message: messageOf(cause),
			});
			return "restart";
		}
	}

	/** Turns the app's auto-accept edits control on or off for the live chat (AGENT-04). */
	setAutoApproveEdits(enabled: boolean): void {
		this.autoApproveEditsOverride = enabled;
	}

	async contextUsage(): Promise<{ usedTokens: number; windowTokens: number } | null> {
		const query = this.query;
		if (query === null) return null;
		try {
			const usage = await query.getContextUsage({ detail: "summary" });
			return { usedTokens: usage.totalTokens, windowTokens: usage.maxTokens };
		} catch (cause) {
			this.deps.logger.debug("Could not read the Claude context usage", {
				sessionId: this.sessionId,
				message: messageOf(cause),
			});
			return null;
		}
	}

	async planUsage(): Promise<RateLimit[]> {
		const query = this.query;
		if (query === null) return [];
		const usage = await query.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({
			skipBehaviors: true,
		});
		return rateLimitsFromSdk(usage);
	}

	async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		this.generation += 1;
		this.settleCancelled();
		const input = this.input;
		const abort = this.abortController;
		const exited = this.exited;
		this.input = null;
		this.query = null;
		this.abortController = null;
		input?.close();
		abort?.abort();
		await exited;
	}

	/** Starts the one process for this chat, unless one already runs or is starting. */
	private ensureStarted(): Promise<void> {
		if (this.disposed) return Promise.reject(new Error("The Claude session was disposed."));
		if (this.query !== null) return Promise.resolve();
		if (this.startPending !== null) return this.startPending;
		const started = this.startNow().finally(() => {
			if (this.startPending === started) this.startPending = null;
		});
		this.startPending = started;
		return started;
	}

	private async startNow(): Promise<void> {
		const hasTranscript = await this.deps.hasTranscript(
			this.sessionId,
			this.start.workspace.workspacePath,
		);
		if (this.disposed) throw new Error("The Claude session was disposed.");
		if (this.query !== null) return;

		const input = new AsyncQueue<SDKUserMessage>();
		const abort = new AbortController();
		const gate: CheckpointGate = { current: () => this.currentGate };
		// A respawn inherits no resume token, so name our own transcript explicitly.
		const start: StartOptions =
			hasTranscript && this.start.resume === undefined
				? {
						...this.start,
						resume: { agentSessionId: this.agentSessionId ?? this.sessionId },
					}
				: this.start;
		const options = buildClaudeOptions({
			start: { ...start, config: this.config },
			executablePath: this.deps.executablePath,
			hasTranscript,
			canUseTool: this.deps.createCanUseTool(this.permissionDeps()),
			hooks: { PreToolUse: [createCheckpointHook(gate)] },
			mcpServers: this.deps.createMcpServers({
				sessionId: this.sessionId,
				appTools: this.config.appTools,
				backend: this.deps.appTools,
				logger: this.deps.logger,
			}),
			sessionStore: createMirrorStore((uuid) => {
				this.receipts.consume(uuid);
			}, this.deps.logger),
			abortController: abort,
			onStderr: (line) => this.onStderr(line),
		});

		// The process starts bypassing checks, so the permission mode is applied live later.
		this.appliedModel = this.config.model;
		this.appliedEffort = this.config.effort;
		this.appliedPermissionMode = "bypassPermissions";
		this.stderrTail.length = 0;
		this.agentSessionIdReported = false;
		this.backgroundTasks.reset();
		this.input = input;
		this.abortController = abort;
		let resolveExit: () => void = () => {};
		this.exited = new Promise<void>((resolve) => {
			resolveExit = resolve;
		});
		const query = this.deps.query({ prompt: input, options });
		this.query = query;
		void this.consume(query, input, resolveExit);
	}

	/** Reads the SDK stream until the process ends, forwarding messages and settling turns. */
	private async consume(
		query: Query,
		input: AsyncQueue<SDKUserMessage>,
		resolveExit: () => void,
	): Promise<void> {
		try {
			for await (const message of query) {
				// A replaced process must not feed the turn that runs on its successor.
				if (this.query !== query) continue;
				this.handleMessage(message);
			}
			if (this.query === query) this.tracker.onStreamEnded(this.streamEndedError());
		} catch (cause) {
			const error = cause instanceof Error ? cause : new Error(String(cause));
			this.deps.logger.error(
				`Claude session ${this.sessionId} failed`,
				errorDetails(error, this.stderrTail),
			);
			if (this.query === query) {
				this.tracker.onStreamEnded(new Error(streamErrorMessage(error, this.stderrTail)));
			}
		} finally {
			input.close();
			if (this.query === query) {
				this.query = null;
				this.input = null;
				this.abortController = null;
			}
			// This process's exit, never the one a later process is still waiting on.
			resolveExit();
		}
	}

	private handleMessage(message: SDKMessage): void {
		this.noteSessionId(message);
		this.notePlanMode(message);
		const callbacks = this.callbacks;
		const tasks = this.backgroundTasks.handle(message);
		if (tasks !== null) callbacks?.onBackgroundTasks(tasks);
		const decision = this.tracker.onSdkMessage(message);
		if (decision.action === "hold_back" || callbacks === null) return;
		for (const agentMessage of this.deps.translator.translate(message)) {
			callbacks.onMessage(agentMessage);
		}
	}

	/**
	 * The agent can enter plan mode by itself. An init message that reports plan mode, or an
	 * EnterPlanMode call, tells the app so its stored config stays true.
	 */
	private notePlanMode(message: SDKMessage): void {
		if (
			message.type === "system" &&
			message.subtype === "init" &&
			message.permissionMode === "plan"
		) {
			// The app's newest choice wins over an init that still reports the mode it replaced.
			if (this.appPlanModeChoice === false) return;
			// The CLI is already in plan mode, so only the bookkeeping is updated.
			this.appliedPermissionMode = "plan";
			this.changePlanMode(true);
			return;
		}
		if (message.type !== "assistant" || message.parent_tool_use_id != null) return;
		for (const block of message.message.content) {
			if (block.type === "tool_use" && block.name === "EnterPlanMode") {
				this.appliedPermissionMode = "plan";
				this.changePlanMode(true);
			}
		}
	}

	/** Records a plan mode the agent chose and tells the app, once per change. */
	private changePlanMode(planMode: boolean): void {
		if (this.config.planMode === planMode) return;
		// The agent's own change is newer than any plan choice the app made before it.
		this.appPlanModeChoice = null;
		this.config = { ...this.config, planMode };
		this.start.onConfigChanged?.(this.config, planMode ? "entered_plan_mode" : "left_plan_mode");
	}

	/** Reports the agent's own session id once, so the app can store it for resume. */
	private noteSessionId(message: SDKMessage): void {
		const id = (message as { session_id?: unknown }).session_id;
		if (typeof id !== "string" || id === "") return;
		this.agentSessionId = id;
		if (this.agentSessionIdReported || this.callbacks === null) return;
		this.agentSessionIdReported = true;
		this.callbacks.onAgentSessionId(id);
	}

	private onStderr(line: string): void {
		// The CLI's own debug lines are noise.
		if (line.includes("[DEBUG]")) return;
		if (line.includes("Fast mode requires extra usage billing")) {
			this.callbacks?.onFastModeUnavailable();
			return;
		}
		this.stderrTail.push(line);
		if (this.stderrTail.length > 20) this.stderrTail.shift();
		this.deps.logger.debug("Claude stderr", { sessionId: this.sessionId, line });
	}

	/** Settles the current turn as cancelled, even when the tracker never saw a user message. */
	private settleCancelled(): void {
		this.tracker.cancel();
		this.settleTurn({ kind: "cancelled" });
	}

	private settleTurn(outcome: TurnOutcome): void {
		if (this.turnSettled) return;
		this.turnSettled = true;
		// A steer waiting for the turn's first message wakes up and sees the closed turn.
		this.firstMessage?.resolve();
		this.receipts.clear();
		this.currentGate = undefined;
		const final: TurnOutcome =
			this.cancelling && outcome.kind !== "cancelled" ? { kind: "cancelled" } : outcome;
		const turn = this.turnDeferred;
		this.turnDeferred = null;
		// The callbacks of this turn must not receive anything after it ends.
		this.callbacks = null;
		turn?.resolve(final);
	}

	/** Ends the turn because the process could not start, and gives the cause to the app. */
	private failStart(cause: unknown): TurnOutcome {
		const message = messageOf(cause);
		this.deps.logger.error("The Claude session could not start", {
			sessionId: this.sessionId,
			message,
		});
		this.finishTurn();
		return { kind: "error", message, retryable: false };
	}

	/**
	 * Ends the turn because its new settings could not be applied live. The process would still run
	 * in the old mode, so the message is not sent and the app sees the error.
	 */
	private failConfigSync(cause: unknown): TurnOutcome {
		const message = messageOf(cause);
		this.deps.logger.error("Could not apply the Claude config live", {
			sessionId: this.sessionId,
			message,
		});
		this.finishTurn();
		return {
			kind: "error",
			message: `Could not apply the Claude settings, so the message was not sent: ${message}`,
			retryable: false,
		};
	}

	private finishTurn(): void {
		this.turnOpen = false;
		this.firstMessage?.resolve();
		this.firstMessage = null;
		this.callbacks = null;
		this.currentGate = undefined;
		this.turnDeferred = null;
		this.cancelling = false;
	}

	/** True when the open turn ended within `ms`, so cancel need not stop the process. */
	private waitForTurn(ms: number): Promise<boolean> {
		const turn = this.turnDeferred;
		if (turn === null) return Promise.resolve(true);
		return new Promise<boolean>((resolve) => {
			let done = false;
			let cancelTimer: () => void = () => {};
			const finish = (ended: boolean) => {
				if (done) return;
				done = true;
				cancelTimer();
				resolve(ended);
			};
			cancelTimer = this.deps.scheduler.after(ms, () => finish(false));
			void turn.promise.then(() => finish(true));
		});
	}

	private stopProcess(): void {
		const input = this.input;
		const abort = this.abortController;
		this.input = null;
		this.query = null;
		this.abortController = null;
		input?.close();
		abort?.abort();
	}

	/**
	 * Sends the model, effort and permission-mode control requests the live process is missing.
	 * Returns true when the effort change needs a restart because the model cannot switch live.
	 */
	private async syncLiveConfig(): Promise<boolean> {
		const query = this.query;
		if (query === null) return false;
		const config = this.config;
		// The permission mode goes first: it is the setting that must never be left at the old
		// value, and an effort restart below still needs it applied to the new process.
		await this.applyPermissionMode(permissionModeFor(config));
		if (this.appliedModel !== config.model) {
			await query.setModel(config.model);
			this.appliedModel = config.model;
		}
		if (this.appliedEffort !== config.effort) {
			if (!(await this.effortAppliesLive(config.model, config.effort))) return true;
			await query.applyFlagSettings({ effortLevel: effortSetting(config.effort) });
			this.appliedEffort = config.effort;
		}
		return false;
	}

	/**
	 * Switches the live process's permission mode and records it, so a plan approval leaves the
	 * session knowing the mode the CLI is in. An approved plan leaves plan mode through here, a
	 * change the agent made, so the app is told. Leaving plan mode because the app asked for it is
	 * not reported: applyConfig already set this.config and the app made the change itself.
	 */
	private async applyPermissionMode(mode: PermissionMode): Promise<void> {
		if (mode !== "plan") this.changePlanMode(false);
		if (this.appliedPermissionMode === mode) return;
		const query = this.query;
		if (query === null) return;
		await query.setPermissionMode(mode);
		this.appliedPermissionMode = mode;
	}

	/** True when the model reports that it can change effort without a new process. */
	private async effortAppliesLive(model: string, effort: Effort): Promise<boolean> {
		if (effort === "none" || effort === "ultracode") return true;
		const query = this.query;
		if (query === null) return true;
		try {
			const models = await query.supportedModels();
			const info = models.find(
				(candidate) => candidate.value === model || candidate.resolvedModel === model,
			);
			if (info === undefined) return true;
			if (info.supportsEffort === false) return false;
			const level = effortSetting(effort);
			if (
				level !== null &&
				info.supportedEffortLevels !== undefined &&
				!info.supportedEffortLevels.includes(level)
			) {
				return false;
			}
			return true;
		} catch {
			// The list is advisory; a rejected control request falls back to a restart.
			return true;
		}
	}

	private permissionDeps(): PermissionHandlerDeps {
		return {
			config: () => this.config,
			allowedDirectories: () => [
				this.start.workspace.workspacePath,
				...this.config.additionalDirectories,
			],
			callbacks: () => this.callbacks ?? undefined,
			realPath: (path) => this.deps.realPath(path),
			isSessionLive: () => !this.disposed && this.query !== null,
			setPermissionMode: (mode) => this.applyPermissionMode(mode),
			autoApproveEditsOverride: () => this.autoApproveEditsOverride,
		};
	}

	/** A clean stream end still mid-turn carries the stderr tail when the CLI wrote one. */
	private streamEndedError(): Error | undefined {
		const tail = this.stderrTail.join("\n").trim();
		if (tail === "") return undefined;
		return new Error(`The Claude session ended unexpectedly.\n${tail}`);
	}

	private userMessage(text: string, uuid: string): SDKUserMessage {
		return {
			type: "user",
			message: { role: "user", content: text },
			parent_tool_use_id: null,
			session_id: this.agentSessionId ?? this.sessionId,
			uuid: uuid as SDKUserMessage["uuid"],
		};
	}
}

/** The SDK's effort setting for a chat effort; null clears it. */
function effortSetting(effort: Effort): "low" | "medium" | "high" | "xhigh" | "max" | null {
	const option = claudeEffortOption(effort);
	return typeof option === "string" ? option : null;
}

/** A function that runs once; later calls share the first promise. */
function once(fn: () => Promise<void>): () => Promise<void> {
	let started: Promise<void> | null = null;
	return () => {
		if (started === null) started = fn();
		return started;
	};
}

/** The message a failed turn shows: the error, its exit code or signal, and the stderr tail. */
function streamErrorMessage(error: Error, stderrTail: readonly string[]): string {
	const extra = error as Error & { exitCode?: unknown; signal?: unknown };
	let message = error.message;
	if (typeof extra.exitCode === "number") message += ` (exit code ${extra.exitCode})`;
	if (typeof extra.signal === "string") message += ` (signal ${extra.signal})`;
	const tail = stderrTail.join("\n").trim();
	if (tail !== "") message += `\n${tail}`;
	return message;
}

function errorDetails(error: Error, stderrTail: readonly string[]): Record<string, unknown> {
	const extra = error as Error & { code?: unknown; exitCode?: unknown; signal?: unknown };
	return {
		errorClass: error.constructor.name,
		code: extra.code,
		exitCode: extra.exitCode,
		signal: extra.signal,
		message: error.message,
		stderrTail: stderrTail.join("\n"),
	};
}
