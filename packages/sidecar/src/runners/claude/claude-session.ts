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
 *  - account() reads the SDK's account info for the usage popover's rows (CHAT-28)
 *  - planUsage() asks the SDK's experimental usage request without the behavior scan and converts
 *    the response with the SIDE-17 model; with no live process it reports no limits, and a refusal
 *    is passed to the caller
 *  - the bundled skill plugin folder is passed to the options when the build has one; a missing
 *    folder is logged, the chat starts without it, and the first turn after that start tells the
 *    user in a notice, once per chat (AGENT-18)
 *  - work the CLI starts by itself while no turn of ours is open (AGENT-15): every SDK message the
 *    turn tracker does not hold back goes to a SelfStartedTurnTracker over the same translator, which
 *    reports it through StartOptions.selfStartedTurns; a stream that ends or throws ends that work,
 *    and dispose stops the reports. A late result of a cancelled turn is held back, so it never
 *    looks like new work. cancel() with no turn of ours open stops such work as it stops a turn:
 *    interrupt, wait INTERRUPT_GRACE_MS for the work to end, then stop the process
 *  - Remote Control (RC-02, D019, path A of D074): `config.remoteControl` turns it on for each
 *    process this chat starts, and off again, through remote-control.ts; one change at a time, in
 *    order. A chat that cannot use it (an API key, a base URL away from Anthropic) reports
 *    unavailable with the reason and never asks the SDK. The link and every bridge_state go to
 *    StartOptions.remoteControl; a process that ends reports disconnected, and dispose reports off.
 *    setRemoteControl applies the switch at once, even during a turn
 *  - input from claude.ai (RC-03): with Remote Control on in this process, a frame naming a user
 *    message uuid this session did not push is a message typed on claude.ai. It is reported once,
 *    when first seen, with its text read from Claude's transcript (asked again every
 *    REMOTE_TEXT_RETRY_MS, REMOTE_TEXT_ATTEMPTS times). An approval asked while no turn of ours is
 *    open goes to the self-started callbacks, so a turn started on claude.ai can ask the app. An
 *    approval card still open when the SDK withdraws it while Remote Control is on was answered on
 *    claude.ai: the chat gets the notice ANSWERED_VIA_CLAUDE
 * Test first: with a scripted query function that yields init, assistant text and a result for
 * the pushed uuid, runTurn emits the text message and resolves with success.
 * Our design choice: the SDK's query function is a constructor parameter (Conductor does this
 * too), so tests drive the session with a scripted stream and never start a real CLI. The
 * translator, the permission handler and the app tools server are injected as well, so this
 * feature can be built and tested before AGENT-03, AGENT-04 and SIDE-12 exist.
 */
import { existsSync } from "node:fs";
import type {
	CanUseTool,
	Options,
	PermissionMode,
	Query,
	SDKMessage,
	SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type {
	AgentMessage,
	Effort,
	Interaction,
	InteractionAnswer,
	RateLimit,
	RemoteControlStatus,
	SessionConfig,
} from "@conducted/protocol";
import type { SessionId } from "@conducted/shared";
import { messageOf } from "@conducted/shared";
import type { Logger } from "../../logging/logger.ts";
import { accountFromSdk, rateLimitsFromSdk, type UsageAccountView } from "../../models/usage.ts";
import type { AppToolBackend } from "../../tools/backend.ts";
import { AsyncQueue } from "../../util/async-queue.ts";
import { createDeferred, type Deferred } from "../../util/deferred.ts";
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
import {
	ANSWERED_VIA_CLAUDE,
	bridgeStatusOf,
	REMOTE_TEXT_ATTEMPTS,
	REMOTE_TEXT_RETRY_MS,
	remoteControlBlocker,
	remoteUserMessageUuids,
	setRemoteControl,
} from "./remote-control.ts";
import { SelfStartedTurnTracker } from "./self-started-turns.ts";
import { createMirrorStore } from "./session-mirror.ts";
import { bundledSkillPlugins } from "./skill-plugin.ts";
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
	/** True when `executablePath` is a `.js` file that starts through node (SIDE-21). */
	viaRuntime?: boolean;
	appTools: AppToolBackend;
	logger: Logger;
	/** Turns SDK messages into our neutral format (AGENT-03). */
	translator: ClaudeTranslator;
	/** Checks for a resumable transcript on disk. */
	hasTranscript(sessionId: SessionId, cwd: string): Promise<boolean>;
	/**
	 * Reads the text of one user message from the chat's transcript by uuid, null when it is not
	 * there (yet). Gives the text of a message typed on claude.ai (RC-03).
	 */
	readUserMessageText(agentSessionId: string, cwd: string, uuid: string): Promise<string | null>;
	/** Folder of the app's bundled skill plugin, when the build has one (AGENT-18). */
	skillPluginDir?: string;
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

export class ClaudeSession implements AgentSession {
	readonly sessionId: SessionId;

	private readonly receipts = new SteerReceipts();
	private readonly tracker: ClaudeTurnTracker;
	private readonly backgroundTasks = new ClaudeBackgroundTasks();
	/** Work the CLI starts by itself. Null when the host passed no callbacks for it. */
	private readonly selfStarted: SelfStartedTurnTracker | null;
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
	/** Why the bundled skill was left out, until the user has been told once (AGENT-18). */
	private skillPluginProblem: string | null = null;
	private skillPluginToldUser = false;
	/** True once the live process answered that Remote Control is on (RC-02). */
	private remoteControlOn = false;
	private remoteControl: RemoteControlStatus = { state: "off" };
	/** Remote Control changes run one at a time, in order. */
	private remoteControlWork: Promise<void> = Promise.resolve();
	/** Uuids of the user messages this session pushed. Any other is a message from claude.ai. */
	private readonly ownUuids = new Set<string>();
	/** Uuids of messages from claude.ai already reported, so each is reported once. */
	private readonly remoteUuids = new Set<string>();

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
		const callbacks = start.selfStartedTurns;
		this.selfStarted =
			callbacks === undefined
				? null
				: new SelfStartedTurnTracker({
						callbacks,
						ownTurnOpen: () => this.turnOpen,
						translate: (message) => this.deps.translator.translate(message),
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
		const turn = createDeferred<TurnOutcome>();
		this.turnDeferred = turn;
		this.firstMessage = createDeferred<void>();
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
		this.tellSkillPluginProblem(callbacks);
		this.syncRemoteControl();

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
		this.ownUuids.add(uuid);
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
		this.ownUuids.add(uuid);
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
		if (!this.turnOpen) {
			await this.cancelSelfStarted();
			return;
		}
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

	/**
	 * Stops work the CLI started by itself the way a cancelled turn of ours stops: an in-band
	 * interrupt, then the process is stopped if the work goes on past the grace period.
	 */
	private async cancelSelfStarted(): Promise<void> {
		const work = this.selfStarted;
		if (work === null || !work.working) return;
		const query = this.query;
		if (query !== null) {
			try {
				await query.interrupt();
			} catch (cause) {
				this.deps.logger.debug("The Claude interrupt request failed", {
					sessionId: this.sessionId,
					message: messageOf(cause),
				});
			}
			if (await this.endsWithin(work.whenEnded(), INTERRUPT_GRACE_MS)) return;
		}
		this.stopProcess();
		// The stopped stream reports nothing more, so its work ends with the stop.
		work.onStreamEnded();
	}

	async applyConfig(config: SessionConfig): Promise<"applied" | "restart"> {
		const change = classifyConfigChange(this.config, config);
		if (this.config.planMode !== config.planMode) this.appPlanModeChoice = config.planMode;
		this.config = config;
		if (change.kind === "restart") return "restart";
		this.syncRemoteControl();
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

	/** Turns the chat's Remote Control switch on or off at once, even during a turn (RC-02). */
	setRemoteControl(enabled: boolean): void {
		this.config = { ...this.config, remoteControl: enabled };
		this.syncRemoteControl();
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

	/** Who the chat is signed in as, from the SDK's account info (CHAT-28). */
	async account(): Promise<UsageAccountView | undefined> {
		const query = this.query;
		if (query === null) return undefined;
		return accountFromSdk(await query.accountInfo());
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
		this.selfStarted?.dispose();
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
		this.remoteControlOn = false;
		if (this.remoteControl.state !== "off") this.reportRemoteControl({ state: "off" });
	}

	/**
	 * Tells the user once per chat that the app's bundled skill was left out, so a packaged build that
	 * lost its skill does not fail quietly. Our design choice: a notice in the chat; the research
	 * does not say what Conductor shows.
	 */
	private tellSkillPluginProblem(callbacks: TurnCallbacks): void {
		const problem = this.skillPluginProblem;
		if (problem === null || this.skillPluginToldUser) return;
		this.skillPluginToldUser = true;
		this.skillPluginProblem = null;
		callbacks.onMessage({
			agent: "claude",
			items: [
				{
					kind: "notice",
					notice: "info",
					text: `${problem} This chat runs without the app's bundled skill, so Claude may not know the app's settings files and scripts.`,
				},
			],
		});
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
		// A missing bundled skill starts the chat without it. The log names what was wrong, and the
		// next turn tells the user once (tellSkillPluginProblem).
		const plugins = bundledSkillPlugins(this.deps.skillPluginDir, existsSync);
		if (!plugins.ok) {
			this.deps.logger.warn("The bundled skill plugin was not loaded", {
				sessionId: this.sessionId,
				reason: plugins.error.message,
			});
			if (!this.skillPluginToldUser) this.skillPluginProblem = plugins.error.message;
		}
		const options = buildClaudeOptions({
			start: { ...start, config: this.config },
			executablePath: this.deps.executablePath,
			viaRuntime: this.deps.viaRuntime === true,
			hasTranscript,
			plugins: plugins.ok ? plugins.value : undefined,
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
		this.remoteControlOn = false;
		void this.consume(query, input, resolveExit);
		this.syncRemoteControl();
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
				this.debugTap("downstream", message);
				this.handleMessage(message);
			}
			if (this.query === query) {
				this.tracker.onStreamEnded(this.streamEndedError());
				// A clean end in the middle of work the CLI started is an interruption, not a failure.
				this.selfStarted?.onStreamEnded();
			}
		} catch (cause) {
			const error = cause instanceof Error ? cause : new Error(String(cause));
			this.deps.logger.error(
				`Claude session ${this.sessionId} failed`,
				errorDetails(error, this.stderrTail),
			);
			if (this.query === query) {
				const failed = new Error(streamErrorMessage(error, this.stderrTail));
				this.tracker.onStreamEnded(failed);
				this.selfStarted?.onStreamEnded(failed);
			}
		} finally {
			input.close();
			if (this.query === query) {
				this.query = null;
				this.input = null;
				this.abortController = null;
				this.remoteControlLost();
			}
			// This process's exit, never the one a later process is still waiting on.
			resolveExit();
		}
	}

	private handleMessage(message: SDKMessage): void {
		const bridge = bridgeStatusOf(message);
		if (bridge !== null) {
			// The link's own state; it is no part of any turn.
			// A new state replaces the last one's detail: a link that works again has no old error.
			const { detail: _previous, ...link } = this.remoteControl;
			this.reportRemoteControl({ ...link, ...bridge });
			return;
		}
		this.noteSessionId(message);
		this.notePlanMode(message);
		const callbacks = this.callbacks;
		const tasks = this.backgroundTasks.handle(message);
		if (tasks !== null) callbacks?.onBackgroundTasks(tasks);
		const decision = this.tracker.onSdkMessage(message);
		if (decision.action === "hold_back") return;
		// With no turn of ours open, the message belongs to work the CLI started by itself.
		this.selfStarted?.onSdkMessage(message);
		this.noteRemoteUserMessages(message);
		if (callbacks === null) return;
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
		return this.endsWithin(turn.promise, ms);
	}

	/** True when `ended` settles within `ms`. */
	private endsWithin(ended: Promise<unknown>, ms: number): Promise<boolean> {
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
			void ended.then(() => finish(true));
		});
	}

	private stopProcess(): void {
		const input = this.input;
		const abort = this.abortController;
		this.input = null;
		this.query = null;
		this.abortController = null;
		this.remoteControlLost();
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
			callbacks: () => this.interactionCallbacks(),
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

	/**
	 * Where an approval goes: the open turn, else the host's callbacks for work the CLI started by
	 * itself (a turn started on claude.ai). An approval the SDK withdraws while still open, with
	 * Remote Control on, was answered on claude.ai, so the chat says so where the card was.
	 */
	private interactionCallbacks(): Pick<TurnCallbacks, "requestInteraction"> | undefined {
		const turn = this.callbacks;
		const host = turn ?? this.start.selfStartedTurns;
		if (host === null || host === undefined) return undefined;
		const notify = (message: AgentMessage): void => {
			if (turn !== null) turn.onMessage(message);
			else this.start.selfStartedTurns?.onMessage(message);
		};
		return {
			requestInteraction: (interaction: Interaction, signal?: AbortSignal) => {
				const pending = host.requestInteraction(interaction, signal);
				if (signal === undefined) return pending;
				let settled = false;
				const onAbort = (): void => {
					if (settled || !this.remoteControlOn) return;
					notify({
						agent: "claude",
						items: [{ kind: "notice", notice: "info", text: ANSWERED_VIA_CLAUDE }],
					});
				};
				signal.addEventListener("abort", onAbort, { once: true });
				return pending.then(
					(answer: InteractionAnswer) => {
						settled = true;
						signal.removeEventListener("abort", onAbort);
						return answer;
					},
					(cause: unknown) => {
						settled = true;
						signal.removeEventListener("abort", onAbort);
						throw cause;
					},
				);
			},
		};
	}

	/** Applies the Remote Control switch to the live process, after any change still running. */
	private syncRemoteControl(): void {
		this.remoteControlWork = this.remoteControlWork
			.then(() => this.applyRemoteControl())
			.catch((cause: unknown) => {
				this.deps.logger.warn("Could not change Remote Control", {
					sessionId: this.sessionId,
					message: messageOf(cause),
				});
			});
	}

	private async applyRemoteControl(): Promise<void> {
		const query = this.query;
		if (query === null || this.disposed) return;
		const wanted = this.config.remoteControl === true;
		if (wanted === this.remoteControlOn) {
			if (!wanted && this.remoteControl.state === "unavailable")
				this.reportRemoteControl({ state: "off" });
			return;
		}
		if (wanted) {
			const blocker = remoteControlBlocker(this.start.env);
			if (blocker !== null) {
				if (this.remoteControl.state !== "unavailable" || this.remoteControl.detail !== blocker) {
					this.reportRemoteControl({ state: "unavailable", detail: blocker });
				}
				return;
			}
			this.reportRemoteControl({ state: "connecting" });
		}
		const answer = await setRemoteControl(query, wanted);
		// A process that ended or was replaced meanwhile has no link to report.
		if (this.query !== query) return;
		if (!answer.ok) {
			this.deps.logger.warn("Claude did not change Remote Control", {
				sessionId: this.sessionId,
				enabled: wanted,
				code: answer.error.code,
				message: answer.error.message,
			});
			this.reportRemoteControl(
				wanted
					? { state: "failed", detail: answer.error.message }
					: { ...this.remoteControl, detail: answer.error.message },
			);
			return;
		}
		this.remoteControlOn = wanted;
		if (!wanted) {
			this.reportRemoteControl({ state: "off" });
			return;
		}
		const sessionUrl = answer.value.sessionUrl;
		this.reportRemoteControl({
			...this.remoteControl,
			...(sessionUrl === undefined ? {} : { sessionUrl }),
		});
		// A change that arrived while Claude answered is applied next.
		if ((this.config.remoteControl === true) !== wanted) this.syncRemoteControl();
	}

	/** The process behind the link ended. The next process turns Remote Control on again. */
	private remoteControlLost(): void {
		const wasOn = this.remoteControlOn;
		this.remoteControlOn = false;
		if (!wasOn || this.disposed) return;
		this.reportRemoteControl({ state: "disconnected" });
	}

	private reportRemoteControl(status: RemoteControlStatus): void {
		this.remoteControl = status;
		this.start.remoteControl?.onStatus(status);
	}

	/**
	 * A frame that names a user message this session did not push, while Remote Control is on, is
	 * answering a message typed on claude.ai. It is reported once, with its text from the transcript.
	 */
	private noteRemoteUserMessages(message: SDKMessage): void {
		if (!this.remoteControlOn) return;
		const callbacks = this.start.remoteControl;
		if (callbacks === undefined) return;
		for (const uuid of remoteUserMessageUuids(message)) {
			if (this.ownUuids.has(uuid) || this.remoteUuids.has(uuid)) continue;
			this.remoteUuids.add(uuid);
			callbacks.onUserMessage({ uuid, text: this.readRemoteText(uuid) });
		}
	}

	/** The text of a message typed on claude.ai, asked of the transcript until it is there. */
	private async readRemoteText(uuid: string): Promise<string | null> {
		const agentSessionId = this.agentSessionId ?? this.sessionId;
		const cwd = this.start.workspace.workspacePath;
		for (let attempt = 1; attempt <= REMOTE_TEXT_ATTEMPTS; attempt += 1) {
			const text = await this.deps.readUserMessageText(agentSessionId, cwd, uuid);
			if (text !== null) return text;
			if (attempt === REMOTE_TEXT_ATTEMPTS || this.disposed) break;
			await new Promise<void>((resolve) => {
				this.deps.scheduler.after(REMOTE_TEXT_RETRY_MS, resolve);
			});
		}
		this.deps.logger.warn("A message sent from claude.ai was not found in Claude's transcript", {
			sessionId: this.sessionId,
			uuid,
		});
		return null;
	}

	private userMessage(text: string, uuid: string): SDKUserMessage {
		const message: SDKUserMessage = {
			type: "user",
			message: { role: "user", content: text },
			parent_tool_use_id: null,
			session_id: this.agentSessionId ?? this.sessionId,
			uuid: uuid as SDKUserMessage["uuid"],
		};
		this.debugTap("upstream", message);
		return message;
	}

	/** Logs one SDK message in either direction so a debug log shows the whole exchange (SIDE-18). */
	private debugTap(direction: "upstream" | "downstream", data: unknown): void {
		this.deps.logger.debug("workspace <> SDK", {
			direction,
			sessionId: this.sessionId,
			data,
		});
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
