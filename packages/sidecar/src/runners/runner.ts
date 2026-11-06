/**
 * @feature AGENT-01 The runner contract
 * Owns: the interface every agent adapter implements (Claude, Codex, Cursor, ACP).
 * Behaviour: research/conductor/other-runners.md sections 1 and 7. A runner only starts the
 * agent, runs one turn at a time, streams translated messages, relays interactions and stops.
 * Queueing, status, checkpoints, events and the write-ahead log live once in session/, above
 * the runners.
 * AGENT-17 adds two ACP-only optional methods for a chat's config options beyond the model.
 * AGENT-13 adds a Codex-only optional goal accessor and a goal-change callback.
 * SIDE-21 adds the program the user chose (`StartOptions.executablePath`), which each runner starts
 * through `findAgentProgram` in launch-env.ts.
 * Our design choices: messages arrive already translated into the neutral AgentMessage format,
 * and capabilities are declared up front instead of discovered by catching "not supported".
 */
import type {
	AcpConfigOption,
	AgentMessage,
	appToSidecarRequests,
	Interaction,
	InteractionAnswer,
	ModelInfo,
	ResultOf,
	SessionConfig,
	WorkspaceContext,
} from "@conducted/protocol";
import type { AgentKind, AppError, Result, SessionId } from "@conducted/shared";
import type { CodexGoalClient } from "./codex/goals.ts";

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
	/**
	 * The agent waits for the user. Resolves with the answer, or "withdrawn" on cancel. A runner that
	 * stops waiting by itself (a timeout, an abort from the agent) aborts `signal`, which closes the
	 * interaction in the app too.
	 */
	requestInteraction(interaction: Interaction, signal?: AbortSignal): Promise<InteractionAnswer>;
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

export type AgentConfigChangeReason = "entered_plan_mode" | "left_plan_mode";

export interface StartOptions {
	sessionId: SessionId;
	config: SessionConfig;
	workspace: WorkspaceContext;
	/** Captured login-shell environment with provider secrets removed. */
	env: Readonly<Record<string, string>>;
	/**
	 * The program the user chose in Settings, from the chat's launch (SIDE-21). Missing: the user
	 * chose none, so the runner takes the managed copy, then the login-shell PATH copy
	 * (`findAgentProgram` in launch-env.ts).
	 */
	executablePath?: string;
	resume?: { agentSessionId: string; atNativeMessageId?: string };
	/**
	 * The agent changed the chat's own settings, for example by entering plan mode. The session
	 * manager stores the config and tells the app. Our design choice: one callback with a reason,
	 * not a separate onEnterPlanMode callback.
	 */
	onConfigChanged?: (config: SessionConfig, reason: AgentConfigChangeReason) => void;
	/** Codex only: a goal changed by the agent or by a `/goal` steer (AGENT-13). */
	onGoalEvent?: (event: unknown) => void;
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
	/**
	 * ACP only: the agent's own chat options beyond the model, applied from the saved config first
	 * (AGENT-17). Other runners omit it.
	 */
	listAcpConfigOptions?(
		config: SessionConfig,
		onAgentSessionId?: (agentSessionId: string) => void,
	): Promise<Result<AcpConfigOption[], AppError>>;
	/** ACP only: set one chat option between turns and return every option (AGENT-17). */
	setAcpConfigOption?(
		optionId: string,
		value: string | boolean,
		config: SessionConfig,
		onAgentSessionId?: (agentSessionId: string) => void,
	): Promise<Result<AcpConfigOption[], AppError>>;
	/**
	 * Codex only: the chat's thread and its goal calls, starting or resuming the thread first
	 * (AGENT-13). Other runners omit it.
	 */
	goalClient?(
		onAgentSessionId?: (agentSessionId: string) => void,
	): Promise<Result<{ threadId: string; goals: CodexGoalClient }, AppError>>;
	contextUsage(): Promise<{ usedTokens: number; windowTokens: number } | null>;
	/** Ends the agent process and releases everything it holds. */
	dispose(): Promise<void>;
}

/** One command or skill an agent offers, as the agent reports it. */
export interface RunnerSlashCommand {
	name: string;
	description: string;
	argumentHint?: string;
	/** Where the command comes from, when the agent reports it. */
	source?: "builtin" | "project" | "user" | "plugin" | "mcp";
	/** command: a slash command. skill: an agent skill. Defaults to command. */
	kind?: "command" | "skill";
}

/** The factory for one agent kind. */
export interface Runner {
	readonly agent: AgentKind;
	readonly capabilities: RunnerCapabilities;
	/** Finds the agent program on the user's PATH and reports its version. */
	detect(env: Readonly<Record<string, string>>): Promise<{ path: string; version: string } | null>;
	start(options: StartOptions): Promise<AgentSession>;
	listModels(): Promise<ModelInfo[]>;
	listSlashCommands(workspacePath: string): Promise<RunnerSlashCommand[]>;
	/**
	 * The agent's MCP servers and their status. Only runners whose capabilities.mcpServers is
	 * true need it; the models/slash-and-mcp.ts lister calls it when it is present.
	 */
	listMcpServers?(workspacePath: string): Promise<McpServerView[]>;
}

/** One MCP server's status: the protocol's own listMcpServers server shape. */
export type McpServerView = ResultOf<typeof appToSidecarRequests.listMcpServers>["servers"][number];
