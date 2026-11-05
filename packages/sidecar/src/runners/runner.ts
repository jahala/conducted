/**
 * @feature AGENT-01 The runner contract
 * Owns: the interface every agent adapter implements (Claude, Codex, Cursor, ACP).
 * Behaviour: research/conductor/other-runners.md sections 1 and 7. A runner only starts the
 * agent, runs one turn at a time, streams translated messages, relays interactions and stops.
 * Queueing, status, checkpoints, events and the write-ahead log live once in session/, above
 * the runners.
 * Our design choices: messages arrive already translated into the neutral AgentMessage format,
 * and capabilities are declared up front instead of discovered by catching "not supported".
 */
import type {
	AgentMessage,
	Interaction,
	InteractionAnswer,
	ModelInfo,
	SessionConfig,
	WorkspaceContext,
} from "@conducted/protocol";
import type { AgentKind, SessionId } from "@conducted/shared";

/** What a runner can do. The session manager checks this before calling optional methods. */
export interface RunnerCapabilities {
	/** Push a message into a running turn. False: steers become queued follow-ups. */
	steer: boolean;
	/** Stop a turn without killing the agent process. False: cancel stops the process. */
	interrupt: boolean;
	/** Resume from a point in history (fork or rewind). */
	resumeAt: boolean;
	/** Change model or permission mode without restarting the agent. */
	liveConfig: boolean;
	slashCommands: boolean;
	mcpServers: boolean;
	contextUsage: boolean;
}

/** Callbacks a runner uses to talk back. The session manager provides them per turn. */
export interface TurnCallbacks {
	/** One translated message. Called in order. */
	onMessage(message: AgentMessage): void;
	/** The agent waits for the user. Resolves with the answer, or "withdrawn" on cancel. */
	requestInteraction(interaction: Interaction): Promise<InteractionAnswer>;
	/** The agent's own session id became known. Stored for resume. */
	onAgentSessionId(agentSessionId: string): void;
	/**
	 * Background work (sub-agents, shells) started or ended. `waitingSince` is the epoch
	 * millisecond when a blocking read of a background task's output began, or undefined when no
	 * such wait is running.
	 */
	onBackgroundTasks(
		tasks: { id: string; kind: "sub_agent" | "shell" | "other"; description: string }[],
		waitingSince?: number,
	): void;
	/**
	 * Called before the first tool that can change files. Resolves once the start checkpoint
	 * exists, so the snapshot never delays the first reply but always precedes the first write.
	 */
	beforeFirstWrite(): Promise<void>;
	/** The provider refused fast mode for this account. */
	onFastModeUnavailable(): void;
}

export interface StartOptions {
	sessionId: SessionId;
	config: SessionConfig;
	workspace: WorkspaceContext;
	/** Captured login-shell environment with provider secrets removed. */
	env: Readonly<Record<string, string>>;
	resume?: { agentSessionId: string; atNativeMessageId?: string };
}

export interface TurnInput {
	/** The final text sent to the agent, after prompt assembly (prompt/). */
	text: string;
	attachmentPaths: string[];
	config: SessionConfig;
}

export type TurnOutcome =
	| { kind: "success" }
	| { kind: "error"; message: string; retryable: boolean }
	| { kind: "cancelled" };

/** A live agent for one chat. Created by a Runner, owned by the process manager. */
export interface AgentSession {
	readonly sessionId: SessionId;
	/** Runs one turn. Resolves when the agent finishes the turn. */
	runTurn(input: TurnInput, callbacks: TurnCallbacks): Promise<TurnOutcome>;
	/**
	 * Pushes a message into the running turn (only when capabilities.steer).
	 * `consumed` resolves when the agent has actually read it.
	 */
	steer(input: TurnInput): Promise<{ consumed: Promise<void> }>;
	/** Stops the running turn. Uses an in-protocol interrupt when available, else stops the process. */
	cancel(): Promise<void>;
	/** Applies config between or during turns. Returns "restart" when the agent must restart with resume. */
	applyConfig(config: SessionConfig): Promise<"applied" | "restart">;
	/**
	 * Claude only: accept file edits without asking for the rest of the chat, set by the app's
	 * auto-accept edits control (AGENT-04). Other runners omit it.
	 */
	setAutoApproveEdits?(enabled: boolean): void;
	contextUsage(): Promise<{ usedTokens: number; windowTokens: number } | null>;
	/** Ends the agent process and releases everything it holds. */
	dispose(): Promise<void>;
}

/** The factory for one agent kind. */
export interface Runner {
	readonly agent: AgentKind;
	readonly capabilities: RunnerCapabilities;
	/** Finds the agent program on the user's PATH and reports its version. */
	detect(env: Readonly<Record<string, string>>): Promise<{ path: string; version: string } | null>;
	start(options: StartOptions): Promise<AgentSession>;
	listModels(): Promise<ModelInfo[]>;
	listSlashCommands(
		workspacePath: string,
	): Promise<{ name: string; description: string; argumentHint?: string }[]>;
}
