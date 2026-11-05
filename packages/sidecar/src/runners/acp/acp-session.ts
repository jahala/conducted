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
 * use session/set_config_option on the option with category "model".
 * Must handle:
 *  - steer(): SteerNotSupportedError("acp"); the manager queues the message
 *  - the stop reason decides the outcome (permission.ts outcomeFromStopReason)
 *  - permission requests: with approvals off answer allow_once at once; with approvals on open a
 *    tool_approval interaction; a question-like request opens a question interaction whose labels
 *    are the option names
 *  - elicitation/create is a form question; URL and other modes are declined
 *  - config changes while a turn runs are deferred to the next turn; model and options are live
 *    between turns, while a change of additional folders needs a restart
 *  - OpenCode: after session/new wait up to adapter.waitForModelCatalogMs for the model option
 *    before the first prompt, else the turn fails with a sign-in hint
 *  - the first prompt of a resumed session whose resume fell back to a new session is flagged to the
 *    user with a notice item ("history was not restored")
 *  - the child dies mid-turn: error outcome naming the adapter; the next turn starts a new child
 *  - a turn that ends with a stop reason and no visible content is an error naming the adapter and
 *    its command
 *  - contextUsage from the last usage_update
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
	AgentMessage,
	Interaction,
	InteractionAnswer,
	SessionConfig,
} from "@conducted/protocol";
import { type AppError, appError, type SessionId } from "@conducted/shared";
import type { Logger } from "../../logging/logger.ts";
import { AsyncQueue } from "../../util/async-queue.ts";
import { messageOf } from "../../util/errors.ts";
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
}

type SessionEvent =
	| { type: "update"; notification: SessionNotification }
	| { type: "promptEnd"; result: { stopReason: StopReason } | { error: AppError } }
	| { type: "closed"; reason: string };

interface ActiveTurn {
	callbacks: TurnCallbacks;
	sawVisibleContent: boolean;
	cancelled: boolean;
	settle(outcome: TurnOutcome): void;
}

interface Deferred<T> {
	promise: Promise<T>;
	resolve(value: T): void;
}

function createDeferred<T>(): Deferred<T> {
	let resolve: (value: T) => void = () => {};
	const promise = new Promise<T>((settle) => {
		resolve = settle;
	});
	return { promise, resolve };
}

export class AcpSession implements AgentSession {
	readonly sessionId: SessionId;

	private client: AcpClient | null = null;
	private opened: OpenedAcpSession | null = null;
	private config: SessionConfig;
	private configOptions: SessionConfigOption[] = [];
	private activeTurn: ActiveTurn | null = null;
	private readonly events = new AsyncQueue<SessionEvent>();
	private stopGeneration = 0;
	private resumeWarningPending = false;
	private usage: { usedTokens: number; windowTokens: number } | null = null;
	private lastText = "";
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
		this.translator = deps.translator;
		void this.consume().catch((cause: unknown) => {
			this.deps.logger.warn("The ACP session event loop stopped", {
				adapter: this.deps.adapter.id,
				reason: messageOf(cause),
			});
		});
	}

	async runTurn(input: TurnInput, callbacks: TurnCallbacks): Promise<TurnOutcome> {
		if (this.activeTurn !== null) {
			return {
				kind: "error",
				message: `A ${this.deps.adapter.displayName} turn is already running.`,
				retryable: false,
			};
		}
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

		const deferred = createDeferred<TurnOutcome>();
		const turn: ActiveTurn = {
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
							? { type: "promptEnd", result: { stopReason: result.value } }
							: { type: "promptEnd", result: { error: result.error } },
					);
				})
				.catch((cause: unknown) => {
					this.events.push({
						type: "promptEnd",
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
		if (client !== null) await client.close();
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
		if (fields.length === 0) return Promise.resolve({ action: "accept", content: {} });
		const interaction: Interaction = {
			kind: "question",
			questions: fields.map((field) => ({
				header: field.key,
				question: field.question,
				options: field.options.map((label) => ({ label })),
				multiSelect: field.multiSelect,
			})),
		};
		return this.ask(turn, interaction).then((answer) => {
			if (answer.kind !== "question") return { action: "cancel" as const };
			const content: Record<string, string | number | boolean | string[]> = {};
			for (let index = 0; index < fields.length; index += 1) {
				const field = fields[index];
				if (field === undefined) continue;
				const values = answer.answers[index] ?? [];
				content[field.key] = coerceField(field.type, field.multiSelect, values);
			}
			return { action: "accept" as const, content };
		});
	}

	private ask(turn: ActiveTurn, interaction: Interaction): Promise<InteractionAnswer> {
		const cancelled = createDeferred<InteractionAnswer>();
		const cancel = () => cancelled.resolve({ kind: "withdrawn" });
		this.pendingCancels.add(cancel);
		const asked = turn.callbacks.requestInteraction(interaction).catch((cause: unknown) => {
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
				this.finishTurn(event.result);
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
		let messages: AgentMessage[];
		try {
			messages = this.translator.push(update as SessionUpdate);
		} catch (cause) {
			this.deps.logger.error("Could not translate an ACP update", {
				adapter: this.deps.adapter.id,
				reason: messageOf(cause),
			});
			messages = [];
		}
		if (messages.length > 0) {
			turn.sawVisibleContent = true;
			this.emit(
				turn.callbacks,
				messages.flatMap((message) => message.items),
			);
		}
	}

	private finishTurn(result: { stopReason: StopReason } | { error: AppError }): void {
		const turn = this.activeTurn;
		if (turn === null) return;
		this.activeTurn = null;
		const flushed = this.safeFlush();
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
		try {
			const messages = this.translator.flush();
			return messages.flatMap((message) => message.items);
		} catch (cause) {
			this.deps.logger.warn("Could not flush the ACP translation buffer", {
				adapter: this.deps.adapter.id,
				reason: messageOf(cause),
			});
			return [];
		}
	}

	private async ensureSession(
		callbacks: TurnCallbacks,
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
		client.onClose((reason) => {
			this.events.push({ type: "closed", reason });
		});
		const resumeId = this.start.resume?.agentSessionId;
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
			if (option === undefined || option.currentValue === value) continue;
			const changed = await client.setConfigOption(opened.acpSessionId, optionId, value);
			if (!changed.ok) return { ok: false, error: changed.error };
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
}

function elicitationFields(request: CreateElicitationRequest): ElicitationField[] {
	if (!("requestedSchema" in request)) return [];
	const schema = request.requestedSchema as
		| {
				properties?: Record<string, unknown>;
		  }
		| null
		| undefined;
	const properties = schema?.properties ?? {};
	return Object.entries(properties).map(([key, schema]) => {
		const record = schema as {
			type?: string;
			title?: string | null;
			description?: string | null;
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
		};
	});
}

function coerceField(
	type: ElicitationField["type"],
	multiSelect: boolean,
	values: readonly string[],
): string | number | boolean | string[] {
	if (multiSelect) return [...values];
	const first = values[0] ?? "";
	if (type === "boolean") return first === "true" || first === "yes" || first === "1";
	if (type === "number" || type === "integer") {
		const parsed = Number(first);
		return Number.isFinite(parsed) ? parsed : 0;
	}
	return first;
}

function modelValues(option: SessionConfigOption): string[] {
	if (!("options" in option)) return [];
	return option.options.flatMap((entry) =>
		"group" in entry ? entry.options.map((choice) => choice.value) : [entry.value],
	);
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
	if (left.length !== right.length) return false;
	const a = [...left].sort();
	const b = [...right].sort();
	return a.every((value, index) => value === b[index]);
}
