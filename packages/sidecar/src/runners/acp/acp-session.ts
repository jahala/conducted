/**
 * @feature AGENT-11 ACP client and runner: the session
 * Owns: one chat's ACP agent: it opens the ACP session, runs prompts, consumes the update queue,
 * answers permission and elicitation requests, and implements AgentSession.
 * Behaviour: research/conductor/other-runners.md section 2.2 and 4: a per-session async queue of
 * typed events is consumed by a loop; runTurn sets the active turn (refused when one exists),
 * waits for pending config writes, reconciles model and config options, calls session/prompt
 * without awaiting it, and settles when the loop sees the end of the turn; steering is not
 * supported; cancel sends session/cancel, sets a flag and resolves every open permission and
 * question as cancelled; the ACP session id is stored as the agent session id; model changes
 * use session/set_config_option on the option with category "model". AGENT-17 adds the chat's
 * other config options: list them, apply saved values, and set one between turns. Telling the
 * agent which model a reloaded chat uses is part of the same reconcile step, which runs before the
 * options are listed and before the first prompt.
 * Must handle:
 *  - steer(): SteerNotSupportedError("acp"); the manager queues the message
 *  - each prompt carries a turn token; an answer to an earlier prompt is dropped, so a late reply
 *    after cancel cannot settle the new turn
 *  - the stop reason decides the outcome (permission.ts outcomeFromStopReason)
 *  - permission requests: with approvals off answer allow_once at once; with approvals on open a
 *    tool_approval interaction; a question-like request opens a question interaction whose labels
 *    are the option names
 *  - elicitation/create is a form question that shows the form message; URL and other modes are
 *    declined, a form with no readable fields is declined, and a required or invalid answer is
 *    declined (a withdrawn form is cancelled)
 *  - config changes while a turn runs are deferred to the next turn; model and options are live
 *    between turns, while a change of additional folders needs a restart
 *  - a saved option the agent no longer offers, or one the agent refuses to set, is skipped with a
 *    log line and the chat still opens; the option keeps the agent's own value, so the listed
 *    options show the app which saved choices did not load (the model is not skipped: a model the
 *    agent refuses fails the turn)
 *  - OpenCode: after session/new wait up to adapter.waitForModelCatalogMs for the model option
 *    before the first prompt, else the turn fails with a sign-in hint
 *  - the first prompt of a resumed session whose resume fell back to a new session is flagged to the
 *    user with a notice item ("history was not restored")
 *  - the child dies mid-turn: error outcome naming the adapter; the next turn starts a new child
 *    and resumes the session id that child reported
 *  - a turn that ends with a stop reason and no visible content is an error naming the adapter and
 *    its command
 *  - an error from the translator ends the turn with an error that names it, and later turns fail
 *    instead of hanging
 *  - contextUsage from the last usage_update
 *  - dispose runs the runner's onDispose once, which gives the app tools token back (SIDE-13)
 * Test first: with an in-memory client, runTurn buffers two text chunks, then a stop reason of
 * end_turn flushes one text message and resolves success.
 */
import type {
	CreateElicitationRequest,
	CreateElicitationResponse,
	PermissionOption,
	RequestPermissionRequest,
	RequestPermissionResponse,
	SessionConfigOption,
	SessionNotification,
	SessionUpdate,
	StopReason,
} from "@agentclientprotocol/sdk";
import type {
	AcpConfigOption,
	AgentMessage,
	Interaction,
	InteractionAnswer,
	SessionConfig,
} from "@conducted/protocol";
import {
	type AppError,
	appError,
	err,
	messageOf,
	ok,
	type Result,
	type SessionId,
} from "@conducted/shared";
import type { Logger } from "../../logging/logger.ts";
import { AsyncQueue } from "../../util/async-queue.ts";
import { createDeferred } from "../../util/deferred.ts";
import { sameStrings } from "../../util/string-set.ts";
import { SteerNotSupportedError } from "../errors.ts";
import type {
	AgentSession,
	StartOptions,
	TurnCallbacks,
	TurnInput,
	TurnOutcome,
} from "../runner.ts";
import type { AcpClient, OpenedAcpSession } from "./acp-client.ts";
import { isRetryableAcpCode } from "./acp-client.ts";
import type { AcpAdapter } from "./adapters/adapter.ts";
import {
	autoApproveOption,
	isQuestionLike,
	outcomeFromStopReason,
	permissionResponseFor,
} from "./permission.ts";
import { type AcpTranslator, usageFromUpdate } from "./translate.ts";

export interface AcpSessionDeps {
	adapter: AcpAdapter;
	/** Makes a connected client. Called again when the child died between turns. */
	connectClient(): Promise<AcpClient>;
	translator: AcpTranslator;
	/** The app tools MCP servers to pass to session/new. */
	mcpServers: readonly unknown[];
	logger: Logger;
	/** Runs once when the session is disposed: the runner gives the app tools token back. */
	onDispose?: () => void;
}

type SessionEvent =
	/** A prompt answer, tagged with the turn that sent the prompt. */
	| {
			type: "promptEnd";
			token: number;
			result: { stopReason: StopReason } | { error: AppError };
	  }
	| { type: "update"; notification: SessionNotification }
	| { type: "closed"; reason: string };

interface ActiveTurn {
	/** Identifies the prompt this turn sent, so an older prompt answer is dropped. */
	token: number;
	callbacks: TurnCallbacks;
	sawVisibleContent: boolean;
	cancelled: boolean;
	settle(outcome: TurnOutcome): void;
}

export class AcpSession implements AgentSession {
	readonly sessionId: SessionId;

	private client: AcpClient | null = null;
	private opened: OpenedAcpSession | null = null;
	private config: SessionConfig;
	private configOptions: SessionConfigOption[] = [];
	private activeTurn: ActiveTurn | null = null;
	/** Set synchronously so two overlapping runTurn calls cannot both pass the guard. */
	private starting = false;
	private nextTurnToken = 0;
	private resumeSessionId: string | undefined;
	private readonly events = new AsyncQueue<SessionEvent>();
	private stopGeneration = 0;
	/** True once onDispose ran, so a second dispose does not run it again. */
	private released = false;
	private resumeWarningPending = false;
	private usage: { usedTokens: number; windowTokens: number } | null = null;
	private lastText = "";
	/** The output error that stopped the event loop, so later turns fail instead of hanging. */
	private loopError: string | null = null;
	private pendingCancels = new Set<() => void>();
	private modelWaiters = new Set<() => void>();
	private writeChain: Promise<void> = Promise.resolve();
	private readonly translator: AcpTranslator;

	constructor(
		protected readonly deps: AcpSessionDeps,
		protected readonly start: StartOptions,
	) {
		this.sessionId = start.sessionId;
		this.config = start.config;
		this.resumeSessionId = start.resume?.agentSessionId;
		this.translator = deps.translator;
		void this.consume().catch((cause: unknown) => {
			// A translator bug or a placeholder is surfaced as the turn's error, never as an empty
			// answer and never as a turn that waits forever.
			const reason = messageOf(cause);
			this.loopError = reason;
			this.deps.logger.error("The ACP session event loop stopped", {
				adapter: this.deps.adapter.id,
				reason,
			});
			this.events.close();
			const turn = this.activeTurn;
			if (turn === null) return;
			this.activeTurn = null;
			turn.settle({
				kind: "error",
				message: `The ${this.deps.adapter.displayName} agent's output could not be read: ${reason}`,
				retryable: false,
			});
		});
	}

	async runTurn(input: TurnInput, callbacks: TurnCallbacks): Promise<TurnOutcome> {
		if (this.loopError !== null) {
			return {
				kind: "error",
				message: `The ${this.deps.adapter.displayName} session stopped after an output error: ${this.loopError}`,
				retryable: false,
			};
		}
		if (this.starting || this.activeTurn !== null) {
			return {
				kind: "error",
				message: `A ${this.deps.adapter.displayName} turn is already running.`,
				retryable: false,
			};
		}
		this.starting = true;
		try {
			const generation = this.stopGeneration;
			this.config = input.config;
			await this.writeChain;

			const opened = await this.ensureSession(callbacks);
			if (!opened.ok) return opened.outcome;
			if (generation !== this.stopGeneration) return { kind: "cancelled" };

			const reconciled = await this.reconcileConfig(input.config, generation);
			if (!reconciled.ok) {
				if (generation !== this.stopGeneration) return { kind: "cancelled" };
				return { kind: "error", message: reconciled.error.message, retryable: false };
			}
			if (generation !== this.stopGeneration) return { kind: "cancelled" };

			this.nextTurnToken += 1;
			const token = this.nextTurnToken;
			this.lastText = "";
			const deferred = createDeferred<TurnOutcome>();
			const turn: ActiveTurn = {
				token,
				callbacks,
				sawVisibleContent: false,
				cancelled: false,
				settle: (outcome) => deferred.resolve(outcome),
			};
			this.activeTurn = turn;

			if (this.resumeWarningPending) {
				this.resumeWarningPending = false;
				this.emit(callbacks, [
					{
						kind: "notice",
						notice: "info",
						text: `The ${this.deps.adapter.displayName} history was not restored. This chat starts a new agent session.`,
					},
				]);
			}
			this.emit(callbacks, [
				{
					kind: "notice",
					notice: "session_started",
					text: `${this.deps.adapter.displayName} started.`,
				},
			]);

			const client = this.client;
			const openedSession = this.opened;
			if (client === null || openedSession === null) {
				this.activeTurn = null;
				return {
					kind: "error",
					message: `The ${this.deps.adapter.displayName} agent is not connected.`,
					retryable: false,
				};
			}

			try {
				void client
					.prompt(openedSession.acpSessionId, [{ type: "text", text: input.text }])
					.then((result) => {
						this.events.push(
							result.ok
								? { type: "promptEnd", token, result: { stopReason: result.value } }
								: { type: "promptEnd", token, result: { error: result.error } },
						);
					})
					.catch((cause: unknown) => {
						this.events.push({
							type: "promptEnd",
							token,
							result: {
								error: appError(
									"acp_prompt_failed",
									`The ${this.deps.adapter.displayName} agent could not run the turn: ${messageOf(cause)}`,
									cause,
								),
							},
						});
					});
			} catch (cause) {
				this.activeTurn = null;
				return {
					kind: "error",
					message: `The ${this.deps.adapter.displayName} agent could not run the turn: ${messageOf(cause)}`,
					retryable: false,
				};
			}

			return deferred.promise;
		} finally {
			this.starting = false;
		}
	}

	async steer(_input: TurnInput): Promise<{ consumed: Promise<void> }> {
		throw new SteerNotSupportedError("acp");
	}

	async cancel(): Promise<void> {
		this.stopGeneration += 1;
		const turn = this.activeTurn;
		if (turn !== null) turn.cancelled = true;
		for (const cancel of [...this.pendingCancels]) cancel();
		this.pendingCancels.clear();
		const client = this.client;
		const opened = this.opened;
		if (client !== null && opened !== null) client.cancel(opened.acpSessionId);
		if (turn !== null) {
			this.activeTurn = null;
			turn.settle({ kind: "cancelled" });
		}
	}

	async applyConfig(config: SessionConfig): Promise<"applied" | "restart"> {
		const restart = !sameStrings(this.config.additionalDirectories, config.additionalDirectories);
		const appToolsChanged =
			JSON.stringify(this.config.appTools) !== JSON.stringify(config.appTools);
		if (appToolsChanged && this.opened !== null) {
			this.deps.logger.info(
				"ACP keeps the app tools it opened with; a change applies to the next chat",
				{ adapter: this.deps.adapter.id, sessionId: this.sessionId },
			);
		}
		this.config = config;
		if (!restart && this.opened !== null && this.activeTurn === null) {
			this.writeChain = this.writeChain
				.then(async () => {
					const applied = await this.reconcileConfig(config);
					if (!applied.ok) {
						this.deps.logger.warn("Could not apply an ACP config change before the next turn", {
							adapter: this.deps.adapter.id,
							reason: applied.error.message,
						});
					}
				})
				.catch((cause: unknown) => {
					this.deps.logger.warn("Could not apply an ACP config change", {
						adapter: this.deps.adapter.id,
						reason: messageOf(cause),
					});
				});
		}
		return restart ? "restart" : "applied";
	}

	async contextUsage(): Promise<{ usedTokens: number; windowTokens: number } | null> {
		return this.usage;
	}

	/**
	 * Fetches the agent's chat options beyond the model (AGENT-17). The saved model and options are
	 * applied first, so a saved chat shows the choices it was left with.
	 */
	async listAcpConfigOptions(
		config: SessionConfig,
		onAgentSessionId?: (agentSessionId: string) => void,
	): Promise<Result<AcpConfigOption[], AppError>> {
		const ready = await this.openForConfig(config, onAgentSessionId);
		if (!ready.ok) return ready;
		return ok(this.publicConfigOptions());
	}

	/** Sets one option between turns and returns every option, since one choice can change others. */
	async setAcpConfigOption(
		optionId: string,
		value: string | boolean,
		config: SessionConfig,
		onAgentSessionId?: (agentSessionId: string) => void,
	): Promise<Result<AcpConfigOption[], AppError>> {
		if (this.activeTurn !== null || this.starting) {
			return err(
				appError("acp_turn_running", "Chat options cannot change while a reply is running."),
			);
		}
		const ready = await this.openForConfig(config, onAgentSessionId);
		if (!ready.ok) return ready;
		const client = this.client;
		const opened = this.opened;
		if (client === null || opened === null) {
			return err(appError("acp_session_not_ready", "The ACP agent has not opened its session."));
		}
		const option = this.configOptions.find((entry) => entry.id === optionId);
		if (option === undefined) {
			return err(appError("acp_option_unknown", "The agent no longer offers that option."));
		}
		if (isModelOption(option)) {
			return err(appError("acp_option_is_model", "The model is chosen in the model picker."));
		}
		if (!optionAcceptsValue(option, value)) {
			return err(
				appError(
					"acp_option_value_invalid",
					`The ${this.deps.adapter.displayName} agent does not accept that value for ${option.name}.`,
				),
			);
		}
		if (option.currentValue === value) return ok(this.publicConfigOptions());
		const changed = await client.setConfigOption(opened.acpSessionId, optionId, value);
		if (!changed.ok) return err(changed.error);
		this.refreshOptions(client, optionId, value);
		return ok(this.publicConfigOptions());
	}

	/** Opens the session when needed, then applies the saved model and options. */
	private async openForConfig(
		config: SessionConfig,
		onAgentSessionId?: (agentSessionId: string) => void,
	): Promise<{ ok: true } | { ok: false; error: AppError }> {
		if (this.activeTurn !== null || this.starting) {
			return {
				ok: false,
				error: appError("acp_turn_running", "Chat options cannot change while a reply is running."),
			};
		}
		await this.writeChain;
		const opened = await this.ensureSession({
			onAgentSessionId: (agentSessionId) => {
				this.resumeSessionId = agentSessionId;
				onAgentSessionId?.(agentSessionId);
			},
		});
		if (!opened.ok) {
			return {
				ok: false,
				error: appError(
					"acp_session_failed",
					opened.outcome.kind === "error"
						? opened.outcome.message
						: "The ACP agent could not open its session.",
				),
			};
		}
		return this.reconcileConfig(config);
	}

	private publicConfigOptions(): AcpConfigOption[] {
		return this.configOptions
			.filter((option) => !isModelOption(option))
			.map((option) => ({
				id: option.id,
				name: option.name,
				...(option.description === null || option.description === undefined
					? {}
					: { description: option.description }),
				...(option.category === null || option.category === undefined
					? {}
					: { category: option.category }),
				value:
					option.type === "boolean"
						? { kind: "switch" as const, current: option.currentValue }
						: {
								kind: "select" as const,
								current: option.currentValue,
								choices: optionValues(option).map((choice) => ({
									value: choice.value,
									name: choice.name,
									...(choice.description === null || choice.description === undefined
										? {}
										: { description: choice.description }),
								})),
							},
			}));
	}

	async dispose(): Promise<void> {
		this.stopGeneration += 1;
		const turn = this.activeTurn;
		this.activeTurn = null;
		for (const cancel of [...this.pendingCancels]) cancel();
		this.pendingCancels.clear();
		for (const wake of [...this.modelWaiters]) wake();
		this.modelWaiters.clear();
		if (turn !== null) turn.settle({ kind: "cancelled" });
		const client = this.client;
		this.client = null;
		this.opened = null;
		this.events.close();
		try {
			if (client !== null) await client.close();
		} finally {
			if (!this.released) {
				this.released = true;
				this.deps.onDispose?.();
			}
		}
	}

	/** Runs before a file write so the start checkpoint exists. */
	beforeWrite(): Promise<void> {
		return this.activeTurn?.callbacks.beforeFirstWrite() ?? Promise.resolve();
	}

	/** The client hands each session/update notification here, in arrival order. */
	handleUpdate(notification: SessionNotification): void {
		this.events.push({ type: "update", notification });
	}

	/** The client asks us for a permission decision. */
	requestPermission(request: RequestPermissionRequest): Promise<RequestPermissionResponse> {
		const cancelled: RequestPermissionResponse = { outcome: { outcome: "cancelled" } };
		if (!this.config.requireToolApproval) {
			const chosen = autoApproveOption(request.options);
			return Promise.resolve(
				chosen === undefined
					? cancelled
					: { outcome: { outcome: "selected", optionId: chosen.optionId } },
			);
		}
		const turn = this.activeTurn;
		if (turn === null) return Promise.resolve(cancelled);
		const interaction = this.permissionInteraction(request);
		return this.ask(turn, interaction).then((answer) => {
			if (answer.kind === "question") return this.questionPermission(request.options, answer);
			return permissionResponseFor(request.options, answer);
		});
	}

	/** The client asks us to fill a form for an MCP server. Only form mode is supported. */
	requestElicitation(request: CreateElicitationRequest): Promise<CreateElicitationResponse> {
		if (request.mode !== "form") return Promise.resolve({ action: "decline" });
		const turn = this.activeTurn;
		if (turn === null) return Promise.resolve({ action: "cancel" });
		const fields = elicitationFields(request);
		// A form we cannot render is declined, never accepted with an invented empty answer.
		if (fields.length === 0) return Promise.resolve({ action: "decline" });
		const interaction: Interaction = {
			kind: "question",
			questions: fields.map((field, index) => ({
				header: field.key,
				question:
					index === 0 && request.message !== ""
						? `${request.message}\n\n${field.question}`
						: field.question,
				options: field.options.map((label) => ({ label })),
				multiSelect: field.multiSelect,
			})),
		};
		return this.ask(turn, interaction).then((answer) => {
			// A withdrawn form is cancelled so the agent stops instead of waiting for an answer.
			if (answer.kind === "withdrawn") return { action: "cancel" as const };
			if (answer.kind !== "question") return { action: "decline" as const };
			const content: Record<string, string | number | boolean | string[]> = {};
			for (let index = 0; index < fields.length; index += 1) {
				const field = fields[index];
				if (field === undefined) continue;
				const read = readElicitationField(field, answer.answers[index] ?? []);
				if (!read.ok) return { action: "decline" as const };
				if (read.omit === true) continue;
				content[field.key] = read.value;
			}
			return { action: "accept" as const, content };
		});
	}

	private ask(turn: ActiveTurn, interaction: Interaction): Promise<InteractionAnswer> {
		const cancelled = createDeferred<InteractionAnswer>();
		// A cancel or dispose stops waiting here and also withdraws the card at the broker.
		const asking = new AbortController();
		const cancel = () => {
			asking.abort();
			cancelled.resolve({ kind: "withdrawn" });
		};
		this.pendingCancels.add(cancel);
		const asked = turn.callbacks
			.requestInteraction(interaction, asking.signal)
			.catch((cause: unknown) => {
				this.deps.logger.warn("Could not deliver an ACP interaction", {
					adapter: this.deps.adapter.id,
					reason: messageOf(cause),
				});
				return { kind: "withdrawn" } as const;
			});
		return Promise.race([asked, cancelled.promise]).finally(() => {
			this.pendingCancels.delete(cancel);
		});
	}

	private async consume(): Promise<void> {
		for await (const event of this.events) {
			if (event.type === "update") {
				this.consumeUpdate(event.notification);
			} else if (event.type === "promptEnd") {
				this.finishTurn(event.token, event.result);
			} else {
				this.handleClosed(event.reason);
			}
		}
	}

	private consumeUpdate(notification: SessionNotification): void {
		const update = notification.update;
		if (update.sessionUpdate === "config_option_update") {
			this.configOptions = update.configOptions;
			for (const wake of [...this.modelWaiters]) wake();
		}
		if (update.sessionUpdate === "usage_update") {
			const usage = usageFromUpdate(update);
			if (usage.windowTokens !== undefined) {
				this.usage = { usedTokens: usage.usedTokens, windowTokens: usage.windowTokens };
			}
		}
		const turn = this.activeTurn;
		if (turn === null) return;
		// A translation failure is a bug in the translator, not an empty answer. Let it propagate
		// so the placeholder or programmer error is visible instead of ending the turn as empty.
		const messages = this.translator.push(update as SessionUpdate);
		this.rememberText(messages);
		if (messages.length > 0) {
			turn.sawVisibleContent = true;
			this.emit(
				turn.callbacks,
				messages.flatMap((message) => message.items),
			);
		}
	}

	private finishTurn(
		token: number,
		result: { stopReason: StopReason } | { error: AppError },
	): void {
		const turn = this.activeTurn;
		// The answer belongs to an earlier prompt, which cancel already settled. Drop it instead of
		// settling the new turn with it.
		if (turn === null || turn.token !== token) return;
		this.activeTurn = null;
		const flushed = this.safeFlush();
		this.rememberItems(flushed);
		if (flushed.length > 0) {
			turn.sawVisibleContent = true;
			this.emit(turn.callbacks, flushed);
		}
		if ("error" in result) {
			const internal = result.error.code === "acp_internal";
			turn.settle({
				kind: "error",
				message: internal && this.lastText !== "" ? this.lastText : result.error.message,
				retryable: isRetryableAcpCode(result.error.code),
			});
			return;
		}
		if (result.stopReason !== "cancelled" && !turn.sawVisibleContent) {
			turn.settle({
				kind: "error",
				message: `The ${this.deps.adapter.displayName} agent ended the turn without any visible output (${this.deps.adapter.command.executable}).`,
				retryable: false,
			});
			return;
		}
		turn.settle(outcomeFromStopReason(result.stopReason));
	}

	private handleClosed(reason: string): void {
		for (const wake of [...this.modelWaiters]) wake();
		this.modelWaiters.clear();
		this.client = null;
		this.opened = null;
		const turn = this.activeTurn;
		if (turn === null) return;
		this.activeTurn = null;
		const flushed = this.safeFlush();
		if (flushed.length > 0) this.emit(turn.callbacks, flushed);
		turn.settle({
			kind: "error",
			message: `${reason} The ${this.deps.adapter.displayName} agent may need to be restarted.`,
			retryable: false,
		});
	}

	private safeFlush(): AgentMessage["items"] {
		// A failure here is a translator bug. Let it propagate instead of dropping buffered agent
		// output and reporting an empty turn.
		return this.translator.flush().flatMap((message) => message.items);
	}

	/** The last text the agent produced, used when it fails with a bare internal error. */
	lastOutput(): string {
		return this.lastText;
	}

	private rememberText(messages: readonly AgentMessage[]): void {
		this.rememberItems(messages.flatMap((message) => message.items));
	}

	private rememberItems(items: AgentMessage["items"]): void {
		const texts = items.filter((item) => item.kind === "text").map((item) => item.text);
		if (texts.length > 0) this.lastText = texts.join("\n");
	}

	private async ensureSession(
		callbacks: Pick<TurnCallbacks, "onAgentSessionId">,
	): Promise<{ ok: true } | { ok: false; outcome: TurnOutcome }> {
		if (this.client !== null && this.opened !== null) return { ok: true };
		let client: AcpClient;
		try {
			client = await this.deps.connectClient();
		} catch (cause) {
			return {
				ok: false,
				outcome: {
					kind: "error",
					message: `The ${this.deps.adapter.displayName} agent could not start: ${messageOf(cause)}`,
					retryable: false,
				},
			};
		}
		this.client = client;
		const connectingClient = client;
		client.onClose((reason) => {
			// A child that died before the reconnect must not close the new one.
			if (this.client !== connectingClient) return;
			this.events.push({ type: "closed", reason });
		});
		// Use the session id from the child that just died. A fresh chat has no start id, but its
		// first turn reported one, and that is the id the next child can resume.
		const resumeId = this.resumeSessionId;
		let session: Awaited<ReturnType<AcpClient["openSession"]>>;
		try {
			session = await client.openSession({
				cwd: this.start.workspace.workspacePath,
				additionalDirectories: this.config.additionalDirectories,
				mcpServers: this.deps.mcpServers,
				...(resumeId === undefined ? {} : { resumeSessionId: resumeId }),
			});
		} catch (cause) {
			this.client = null;
			await client.close();
			return {
				ok: false,
				outcome: {
					kind: "error",
					message: `The ${this.deps.adapter.displayName} agent could not open a session: ${messageOf(cause)}`,
					retryable: false,
				},
			};
		}
		if (!session.ok) {
			this.client = null;
			await client.close();
			return {
				ok: false,
				outcome: { kind: "error", message: session.error.message, retryable: false },
			};
		}
		this.opened = session.value;
		this.configOptions = session.value.configOptions;
		this.resumeSessionId = session.value.acpSessionId;
		callbacks.onAgentSessionId(session.value.acpSessionId);
		if (resumeId !== undefined && resumeId !== "" && session.value.how === "new") {
			this.resumeWarningPending = true;
			this.deps.logger.warn("The ACP session could not be resumed; starting a new one", {
				adapter: this.deps.adapter.id,
			});
		}
		return { ok: true };
	}

	private async reconcileConfig(
		config: SessionConfig,
		generation?: number,
	): Promise<{ ok: true } | { ok: false; error: AppError }> {
		this.config = config;
		const client = this.client;
		const opened = this.opened;
		if (client === null || opened === null) return { ok: true };

		let modelOption = this.configOptions.find((option) => option.category === "model");
		if (
			modelOption === undefined &&
			config.model !== "" &&
			this.deps.adapter.waitForModelCatalogMs > 0
		) {
			await this.waitForModel(this.deps.adapter.waitForModelCatalogMs);
			if (
				(generation !== undefined && generation !== this.stopGeneration) ||
				this.client === null
			) {
				return { ok: false, error: appError("acp_cancelled", "The turn was cancelled.") };
			}
			modelOption = this.configOptions.find((option) => option.category === "model");
			if (modelOption === undefined) {
				return {
					ok: false,
					error: appError(
						"acp_model_not_loaded",
						`The ${this.deps.adapter.displayName} agent did not load its model list. The provider may need sign-in.`,
					),
				};
			}
		}

		if (modelOption !== undefined && config.model !== "") {
			const allowed = modelValues(modelOption);
			if (!allowed.includes(config.model)) {
				return {
					ok: false,
					error: appError(
						"acp_model_not_loaded",
						`The ${this.deps.adapter.displayName} agent did not load the chosen model (${config.model}). The provider may need sign-in.`,
					),
				};
			}
			if (modelOption.currentValue !== config.model) {
				const changed = await client.setConfigOption(
					opened.acpSessionId,
					modelOption.id,
					config.model,
				);
				if (!changed.ok) return { ok: false, error: changed.error };
				this.refreshOptions(client, modelOption.id, config.model);
			}
		}

		for (const [optionId, value] of Object.entries(config.acpConfig ?? {})) {
			const option = this.configOptions.find((entry) => entry.id === optionId);
			if (option !== undefined && isModelOption(option)) continue;
			// A saved value the agent no longer offers is not sent, and one the agent refuses is
			// skipped too. Either way the option keeps the agent's value, which is how the app sees
			// that the saved choice did not load and asks the user to choose again.
			if (option === undefined || !optionAcceptsValue(option, value)) {
				this.deps.logger.warn("A saved ACP option is no longer offered; skipped", {
					adapter: this.deps.adapter.id,
					optionId,
				});
				continue;
			}
			if (option.currentValue === value) continue;
			const changed = await client.setConfigOption(opened.acpSessionId, optionId, value);
			if (!changed.ok) {
				this.deps.logger.warn("The ACP agent refused a saved option; skipped", {
					adapter: this.deps.adapter.id,
					optionId,
					code: changed.error.code,
					message: changed.error.message,
				});
				continue;
			}
			this.refreshOptions(client, optionId, value);
		}
		return { ok: true };
	}

	private refreshOptions(client: AcpClient, optionId: string, value: string | boolean): void {
		const option = this.configOptions.find((entry) => entry.id === optionId);
		if (option === undefined) return;
		this.configOptions = this.configOptions.map((entry) => {
			if (entry.id !== optionId) return entry;
			if (entry.type === "boolean" && typeof value === "boolean") {
				return { ...entry, currentValue: value };
			}
			if (entry.type === "select" && typeof value === "string") {
				return { ...entry, currentValue: value };
			}
			return entry;
		});
		client.setConfigOptions?.(this.configOptions);
	}

	private waitForModel(timeoutMs: number): Promise<void> {
		return new Promise((resolveWait) => {
			let settled = false;
			const finish = () => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				this.modelWaiters.delete(finish);
				resolveWait();
			};
			const timer = setTimeout(finish, timeoutMs);
			this.modelWaiters.add(finish);
		});
	}

	private permissionInteraction(request: RequestPermissionRequest): Interaction {
		const toolCall = request.toolCall;
		const toolName = toolCall.name ?? toolCall.title ?? "tool";
		if (isQuestionLike(request.options)) {
			return {
				kind: "question",
				questions: [
					{
						header: toolName,
						question: toolCall.title ?? toolName,
						options: request.options.map((option) => ({ label: option.name })),
						multiSelect: false,
					},
				],
			};
		}
		return {
			kind: "tool_approval",
			toolUseId: toolCall.toolCallId as never,
			toolName,
			input: toolCall.rawInput,
		};
	}

	private questionPermission(
		options: readonly PermissionOption[],
		answer: Extract<InteractionAnswer, { kind: "question" }>,
	): RequestPermissionResponse {
		const labels = answer.answers[0] ?? [];
		const chosen = options.find((option) => labels.includes(option.name));
		return chosen === undefined
			? { outcome: { outcome: "cancelled" } }
			: { outcome: { outcome: "selected", optionId: chosen.optionId } };
	}

	private emit(callbacks: TurnCallbacks, items: AgentMessage["items"]): void {
		if (items.length === 0) return;
		callbacks.onMessage({ agent: "acp", items });
	}
}

interface ElicitationField {
	key: string;
	question: string;
	type: "string" | "number" | "integer" | "boolean" | "array";
	multiSelect: boolean;
	options: string[];
	required: boolean;
	default?: string | number | boolean | string[];
}

function elicitationFields(request: CreateElicitationRequest): ElicitationField[] {
	if (!("requestedSchema" in request)) return [];
	const schema = request.requestedSchema as
		| {
				properties?: Record<string, unknown>;
				required?: string[] | null;
		  }
		| null
		| undefined;
	const properties = schema?.properties ?? {};
	const required = new Set(schema?.required ?? []);
	return Object.entries(properties).map(([key, schema]) => {
		const record = schema as {
			type?: string;
			title?: string | null;
			description?: string | null;
			default?: string | number | boolean | string[] | null;
			enum?: string[] | null;
			oneOf?: { const: string; title?: string | null }[] | null;
			items?: { enum?: string[] | null; anyOf?: { const: string; title?: string | null }[] | null };
		};
		const type = record.type === "array" ? "array" : (record.type ?? "string");
		const options =
			record.enum ??
			record.oneOf?.map((choice) => choice.const) ??
			record.items?.enum ??
			record.items?.anyOf?.map((choice) => choice.const) ??
			[];
		return {
			key,
			question: record.title ?? record.description ?? key,
			type:
				type === "number" || type === "integer" || type === "boolean" || type === "array"
					? type
					: "string",
			multiSelect: type === "array",
			options,
			required: required.has(key),
			...(record.default === null || record.default === undefined
				? {}
				: { default: record.default }),
		};
	});
}

type FieldRead =
	| { ok: true; omit?: false; value: string | number | boolean | string[] }
	| { ok: true; omit: true }
	| { ok: false };

/** Reads one answer, using the field's default and refusing values it cannot represent. */
function readElicitationField(field: ElicitationField, values: readonly string[]): FieldRead {
	if (field.multiSelect) {
		if (values.length === 0) {
			if (field.default !== undefined) {
				return { ok: true, value: Array.isArray(field.default) ? field.default : [] };
			}
			return field.required ? { ok: false } : { ok: true, omit: true };
		}
		if (field.options.length > 0 && values.some((value) => !field.options.includes(value))) {
			return { ok: false };
		}
		return { ok: true, value: [...values] };
	}
	const raw = values[0];
	if (raw === undefined || raw === "") {
		if (field.default !== undefined) return { ok: true, value: field.default };
		return field.required ? { ok: false } : { ok: true, omit: true };
	}
	if (field.type === "boolean") {
		const lower = raw.toLowerCase();
		if (lower === "true" || lower === "yes" || lower === "1") return { ok: true, value: true };
		if (lower === "false" || lower === "no" || lower === "0") return { ok: true, value: false };
		return { ok: false };
	}
	if (field.type === "number" || field.type === "integer") {
		const parsed = Number(raw);
		if (raw.trim() === "" || !Number.isFinite(parsed)) return { ok: false };
		if (field.type === "integer" && !Number.isInteger(parsed)) return { ok: false };
		return { ok: true, value: parsed };
	}
	if (field.options.length > 0 && !field.options.includes(raw)) return { ok: false };
	return { ok: true, value: raw };
}

function optionValues(
	option: SessionConfigOption,
): { value: string; name: string; description?: string | null }[] {
	if (option.type !== "select" || option.options.length === 0) return [];
	const first = option.options[0];
	if (first !== undefined && "group" in first) {
		return option.options.flatMap((entry) => ("group" in entry ? entry.options : []));
	}
	return option.options as { value: string; name: string; description?: string | null }[];
}

function isModelOption(option: SessionConfigOption): boolean {
	return option.category === "model" || option.id === "model";
}

function optionAcceptsValue(option: SessionConfigOption, value: string | boolean): boolean {
	if (option.type === "boolean") return typeof value === "boolean";
	return typeof value === "string" && optionValues(option).some((choice) => choice.value === value);
}

function modelValues(option: SessionConfigOption): string[] {
	return optionValues(option).map((choice) => choice.value);
}
