/**
 * The JSON-RPC contract between the desktop UI and the sidecar.
 * Transport: one JSON-RPC 2.0 message per line (NDJSON) over the sidecar's Unix socket,
 * relayed by the Rust shell (`rpc_to_sidecar` command, `rpc_from_sidecar` event).
 * Both sides parse every message with these schemas.
 * Research: frontend.md 3c, sessions.md section 10, other-runners.md sections 2 and 5. Method
 * names are ours. There is no health method: a sidecar that is alive and connected counts as
 * healthy (D028).
 */
import { z } from "zod";
import { zSessionEvent } from "./events.ts";
import {
	zAcpAgent,
	zAgentKind,
	zEventId,
	zInteractionId,
	zMessageId,
	zSessionId,
	zTurnId,
} from "./ids.ts";
import {
	zInteractionAnswer,
	zInteractionClosedReason,
	zInteractionRequest,
} from "./interactions.ts";
import { zLiveState } from "./live-state.ts";
import { zProgress } from "./progress.ts";
import { zAgentLaunch, zEffort, zSessionConfig, zWorkspaceContext } from "./session-config.ts";

export interface MethodSpec<P extends z.ZodType, R extends z.ZodType> {
	params: P;
	result: R;
}
const method = <P extends z.ZodType, R extends z.ZodType>(
	params: P,
	result: R,
): MethodSpec<P, R> => ({
	params,
	result,
});
const empty = z.object({});

// ---------------------------------------------------------------- shared shapes

export const zResume = z.object({
	/** The agent's own session or thread id, stored after the first turn. */
	agentSessionId: z.string(),
	/** Fork or rewind: resume the agent's history only up to this message. */
	atNativeMessageId: z.string().optional(),
});

export const zSlashCommand = z.object({
	name: z.string(),
	description: z.string(),
	argumentHint: z.string().optional(),
	source: z.enum(["builtin", "project", "user", "plugin", "mcp"]),
	/** command: a slash command. skill: an agent skill, listed in the Skills group of the menu. */
	kind: z.enum(["command", "skill"]),
});

export const zModelInfo = z.object({
	id: z.string(),
	label: z.string(),
	/**
	 * A shorter label from the agent's model list. The app names a model by `label` everywhere, as
	 * Conductor's picker and composer do, so no screen reads this.
	 */
	shortLabel: z.string().optional(),
	/**
	 * picker: offered in the picker. gated: shown but needs a plan or sign-in that may be
	 * missing. hidden: accepted but not offered. deprecated: kept for old chats only.
	 */
	status: z.enum(["picker", "gated", "hidden", "deprecated"]),
	/** Shows a "New" badge in the picker. */
	isNew: z.boolean(),
	/** The model a new chat with this agent uses when the user has not chosen one. */
	isDefault: z.boolean(),
	efforts: z.array(zEffort),
	defaultEffort: zEffort,
	/** What the picker calls the effort axis for this model. */
	effortAxis: z.enum(["effort", "thinking"]),
	/** Labels for effort levels that differ from the standard ones, by level. */
	effortLabels: z.partialRecord(zEffort, z.string()).optional(),
	/** The effort can change during a live chat without restarting the agent. */
	liveEffortChange: z.boolean(),
	supportsFastMode: z.boolean(),
	/**
	 * Claude: the model supports adaptive thinking, as the Agent SDK reports it
	 * (`supportsAdaptiveThinking`). Missing when the agent does not say.
	 */
	adaptiveThinking: z.boolean().optional(),
	contextWindowTokens: z.number().int().positive().optional(),
});

export type ModelInfo = z.infer<typeof zModelInfo>;
export type SlashCommand = z.infer<typeof zSlashCommand>;

export const zAgentInstall = z.object({
	agent: zAgentKind,
	acpAgent: zAcpAgent.optional(),
	installed: z.boolean(),
	path: z.string().optional(),
	/** managed: the app's own copy (D021). user: the path chosen in settings. login_path: found on the login-shell PATH. */
	source: z.enum(["managed", "user", "login_path"]).optional(),
	version: z.string().optional(),
	authenticated: z.boolean().optional(),
	/** How the agent is signed in, for example "chatgpt", "api_key" or "bedrock", when it says. */
	authMethod: z.string().optional(),
	/**
	 * A problem worth showing on the Agents page in plain words, such as a version known to
	 * return empty turns or a program missing at its path. The page offers Update when one is set.
	 */
	warning: z.string().optional(),
});

export const zDiffCommentInput = z.object({
	file: z.string(),
	line: z.number().int().positive(),
	endLine: z.number().int().positive().optional(),
	body: z.string(),
});

export type AgentInstall = z.infer<typeof zAgentInstall>;

export const zDiffCommentView = zDiffCommentInput.extend({
	author: z.enum(["user", "agent", "github"]),
	resolved: z.boolean(),
});

/** A Codex thread goal. Only Codex has goals; a goal call on another agent's chat fails with invalidParams. */
export const zCodexGoal = z.object({
	objective: z.string(),
	status: z.enum(["active", "paused", "blocked", "usage_limited", "budget_limited", "complete"]),
	/** The most tokens Codex may spend on the goal, when the user set a budget. */
	tokenBudget: z.number().int().positive().optional(),
	tokensUsed: z.number().int().nonnegative().optional(),
});
export type CodexGoal = z.infer<typeof zCodexGoal>;

/** One of an ACP agent's own chat options, such as its thinking level or mode. */
export const zAcpConfigOption = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string().optional(),
	/** What the option is about, as the agent groups it, for example "model", "mode" or "thought_level". */
	category: z.string().optional(),
	value: z.discriminatedUnion("kind", [
		z.object({
			kind: z.literal("select"),
			current: z.string(),
			choices: z.array(
				z.object({ value: z.string(), name: z.string(), description: z.string().optional() }),
			),
		}),
		z.object({ kind: z.literal("switch"), current: z.boolean() }),
	]),
});
export type AcpConfigOption = z.infer<typeof zAcpConfigOption>;

/** One named usage limit, such as Claude's 5-hour window or Codex's primary window. */
export const zRateLimit = z.object({
	label: z.string(),
	usedPercent: z.number().nonnegative(),
	/** How long the window is, in minutes, when the agent says. */
	windowMinutes: z.number().positive().optional(),
	/** When the window resets, in milliseconds since the epoch. */
	resetsAt: z.number().optional(),
});
export type RateLimit = z.infer<typeof zRateLimit>;

/** One provider an agent can use and the variables that hold its key (OpenCode lists many). */
export const zAgentProvider = z.object({
	id: z.string(),
	label: z.string(),
	/** Environment variable names the provider reads its key from, for example OPENAI_API_KEY. */
	keyEnvVars: z.array(z.string()),
});
export type AgentProvider = z.infer<typeof zAgentProvider>;

/** A sign-in flow in progress. Finish or cancel it with its `loginId`. */
export const zAgentLogin = z.object({
	loginId: z.string(),
	/** A page to open in the browser. */
	url: z.string().optional(),
	/** A code the user types on the verification page (device-code sign-in). */
	userCode: z.string().optional(),
	verificationUrl: z.string().optional(),
	/** A terminal command the user can run instead, such as `claude setup-token`. */
	command: z.string().optional(),
	instructions: z.string(),
});
export type AgentLogin = z.infer<typeof zAgentLogin>;

/**
 * A Claude chat's Remote Control link (D019). off: not asked for, or the agent is not running.
 * connecting: asked for, with no answer yet. ready, connected, reconnecting, disconnected and
 * failed: the link's state as Claude reports it. unavailable: this chat cannot use Remote Control,
 * and `detail` says why (an API key, or a base URL away from Anthropic).
 */
export const zRemoteControlStatus = z.object({
	state: z.enum([
		"off",
		"connecting",
		"ready",
		"connected",
		"reconnecting",
		"disconnected",
		"failed",
		"unavailable",
	]),
	/** The page that opens the chat in claude.ai/code or the Claude app. */
	sessionUrl: z.string().optional(),
	/** Why it failed or cannot start, in plain words. */
	detail: z.string().optional(),
});
export type RemoteControlStatus = z.infer<typeof zRemoteControlStatus>;

const zAgentRef = { agent: zAgentKind, acpAgent: zAcpAgent.optional() };

// ---------------------------------------------------------------- UI -> sidecar

export const appToSidecarRequests = {
	/** Send a user message. Returns when the turn starts (or the message is queued or steered), not when it ends. */
	sendMessage: method(
		z.object({
			sessionId: zSessionId,
			messageId: zMessageId,
			turnId: zTurnId,
			text: z.string(),
			attachmentPaths: z.array(z.string()),
			delivery: z.enum(["new_turn", "steer"]),
			/** True for the chat's first message: the sidecar adds the workspace instruction block. */
			firstMessage: z.boolean(),
			config: zSessionConfig,
			workspace: zWorkspaceContext,
			launch: zAgentLaunch,
			resume: zResume.optional(),
		}),
		z.object({ deliveredAs: z.enum(["new_turn", "steer", "queued"]) }),
	),
	/**
	 * Stop the running turn, take the end checkpoint, drop queued messages, withdraw interactions.
	 * `droppedMessageIds` lists the messages the sidecar held in its queue and did not send; the UI
	 * puts them back in the composer with their attachments.
	 */
	cancel: method(
		z.object({ sessionId: zSessionId }),
		z.object({ wasWorking: z.boolean(), droppedMessageIds: z.array(zMessageId) }),
	),
	/** Start the agent process before the first message, to cut waiting time. */
	warmAgent: method(
		z.object({
			sessionId: zSessionId,
			config: zSessionConfig,
			workspace: zWorkspaceContext,
			launch: zAgentLaunch,
			resume: zResume.optional(),
		}),
		empty,
	),
	/** Stop the agent process and forget the session in memory. The next message starts fresh (with resume). */
	resetAgent: method(z.object({ sessionId: zSessionId }), empty),
	/** Change settings of a live chat. Some changes apply at once, some restart the agent between turns. */
	updateConfig: method(
		z.object({ sessionId: zSessionId, config: zSessionConfig }),
		z.object({ applied: z.enum(["live", "on_next_turn"]) }),
	),
	/** Claude only: turn auto-approval of file edits on or off for the live chat, without a restart. */
	setAutoApproveEdits: method(z.object({ sessionId: zSessionId, enabled: z.boolean() }), empty),
	/** Ask the sidecar what it knows. "known: false" means it restarted and has no state for this chat. */
	getSessionStatus: method(
		z.object({ sessionId: zSessionId }),
		z.object({
			known: z.boolean(),
			liveState: zLiveState.optional(),
			/** A Claude chat's Remote Control link, when the sidecar knows the chat (RC-02). */
			remoteControl: zRemoteControlStatus.optional(),
		}),
	),
	answerInteraction: method(
		z.object({ sessionId: zSessionId, interactionId: zInteractionId, answer: zInteractionAnswer }),
		/** superseded: the interaction was already withdrawn or replaced. */
		z.object({ accepted: z.boolean(), superseded: z.boolean() }),
	),
	getContextUsage: method(
		z.object({ sessionId: zSessionId }),
		z.object({
			usedTokens: z.number().int().nonnegative(),
			windowTokens: z.number().int().positive(),
			/** The account's usage limits, for the usage popover. Empty when the agent reports none. */
			rateLimits: z.array(zRateLimit),
			/**
			 * The signed-in account, for the usage popover's account rows (CHAT-28). `provider` is
			 * the API backend ("Anthropic API", "OpenAI"). A sign-in shows as `loginMethod` ("Claude
			 * account"); a key or outside credentials as `auth` ("API key", "ChatGPT login").
			 */
			account: z
				.object({
					provider: z.string().optional(),
					loginMethod: z.string().optional(),
					auth: z.string().optional(),
					organization: z.string().optional(),
					email: z.string().optional(),
					plan: z.string().optional(),
				})
				.optional(),
		}),
	),
	/**
	 * Without a workspace (the new-workspace composer), the sidecar answers from its saved list
	 * for the repository and agent, and `fromCache` is true (SIDE-22). With one, the agent lists
	 * them, started as `launch` says when it is given (SIDE-21).
	 */
	listSlashCommands: method(
		z.object({
			...zAgentRef,
			workspacePath: z.string().optional(),
			repoRootPath: z.string(),
			launch: zAgentLaunch.optional(),
		}),
		z.object({ commands: z.array(zSlashCommand), fromCache: z.boolean() }),
	),
	/** The agent's MCP servers in a workspace, started as `launch` says when it is given (SIDE-21). */
	listMcpServers: method(
		z.object({ ...zAgentRef, workspacePath: z.string(), launch: zAgentLaunch.optional() }),
		z.object({
			servers: z.array(
				z.object({
					name: z.string(),
					status: z.enum(["connected", "failed", "needs_auth", "pending", "disabled"]),
					toolCount: z.number().int().nonnegative().optional(),
					/** Where the server is configured. */
					scope: z.enum(["user", "project", "local", "plugin"]).optional(),
					transport: z.enum(["stdio", "http", "sse"]).optional(),
					/** Why the server failed, in the agent's words. */
					error: z.string().optional(),
					/** Names of the tools the server offers. */
					tools: z.array(z.string()).optional(),
				}),
			),
		}),
	),
	/**
	 * The agent's models. With `launch`, the list comes from the program and keys the user chose
	 * (SIDE-21); without it, from the managed or PATH program and the login shell's environment.
	 */
	listModels: method(
		z.object({ ...zAgentRef, launch: zAgentLaunch.optional() }),
		z.object({ models: z.array(zModelInfo) }),
	),
	/** Which agent programs are installed, their versions and whether they are signed in. */
	getAgentInstalls: method(empty, z.object({ agents: z.array(zAgentInstall) })),
	/** Start the agent's own sign-in flow (browser or device code). Only one per agent runs at a time. */
	startAgentLogin: method(z.object(zAgentRef), zAgentLogin),
	/**
	 * Wait for a sign-in flow to end. Codex's device-code flow waits up to 10 minutes. Cursor's
	 * hands back its API key in `apiKey`, which the app stores in the Keychain.
	 */
	finishAgentLogin: method(
		z.object({ loginId: z.string(), code: z.string().optional() }),
		z.object({
			outcome: z.enum(["signed_in", "failed", "cancelled"]),
			message: z.string().optional(),
			apiKey: z.string().optional(),
		}),
	),
	cancelAgentLogin: method(z.object({ loginId: z.string() }), empty),
	/** The providers an agent can use and the variables for their keys (SET-10). */
	listAgentProviders: method(z.object(zAgentRef), z.object({ providers: z.array(zAgentProvider) })),
	/** The PATH and shell captured from the user's login shell. */
	getShellEnv: method(
		z.object({ workspacePath: z.string() }),
		z.object({ shell: z.string(), path: z.string() }),
	),
	/**
	 * Run one short prompt through the user's own agent and return its text: chat titles and
	 * branch names (D030). Writes no events, takes no checkpoints, has its tools off.
	 */
	runUtilityPrompt: method(
		z.object({
			...zAgentRef,
			model: z.string(),
			prompt: z.string(),
			cwd: z.string(),
			fastMode: z.boolean().optional(),
			launch: zAgentLaunch,
		}),
		z.object({ text: z.string() }),
	),
	/** Codex only: the chat's goal, or null when it has none. */
	getGoal: method(z.object({ sessionId: zSessionId }), z.object({ goal: zCodexGoal.nullable() })),
	/** Codex only: set or replace the chat's goal. */
	setGoal: method(
		z.object({
			sessionId: zSessionId,
			objective: z.string().min(1),
			tokenBudget: z.number().int().positive().optional(),
		}),
		z.object({ goal: zCodexGoal }),
	),
	/** Codex only: pause, resume or clear the chat's goal. */
	changeGoal: method(
		z.object({ sessionId: zSessionId, action: z.enum(["pause", "resume", "clear"]) }),
		z.object({ goal: zCodexGoal.nullable() }),
	),
	/**
	 * Ask the agent to summarise its context now. Codex runs its compact call; agents that take
	 * "/compact" as message text (Claude) do not need this.
	 */
	compact: method(z.object({ sessionId: zSessionId }), z.object({ started: z.boolean() })),
	/** ACP only: the agent's own chat options beyond the model, with their current values. */
	listAcpConfigOptions: method(
		z.object({ sessionId: zSessionId }),
		z.object({ options: z.array(zAcpConfigOption) }),
	),
	/** ACP only: set one option. Returns every option, since one choice can change the others. */
	setAcpConfigOption: method(
		z.object({
			sessionId: zSessionId,
			optionId: z.string(),
			value: z.union([z.string(), z.boolean()]),
		}),
		z.object({ options: z.array(zAcpConfigOption) }),
	),
} as const;

export const appToSidecarNotifications = {
	/** The UI has stored this event. The sidecar may drop it from its write-ahead log. */
	eventPersisted: z.object({ sessionId: zSessionId, eventId: zEventId }),
	setLogLevel: z.object({ level: z.enum(["error", "warn", "info", "debug"]) }),
	/**
	 * The program paths chosen in Settings, every one at once; an agent missing from the list has
	 * none. Sent when the sidecar connects and whenever a path changes (SIDE-21). The agent list
	 * (`getAgentInstalls`, `agentInstallsChanged`) reports these programs. A chat's launch still
	 * names its own program.
	 */
	setAgentPrograms: z.object({
		programs: z.array(z.object({ ...zAgentRef, path: z.string().min(1) })),
	}),
} as const;

// ---------------------------------------------------------------- sidecar -> UI

export const zSessionEventEnvelope = z.object({
	sessionId: zSessionId,
	/** Strictly increasing per session. Gaps mean an event is still to come by replay. */
	sequence: z.number().int().nonnegative(),
	event: zSessionEvent,
});
export type SessionEventEnvelope = z.infer<typeof zSessionEventEnvelope>;

export const sidecarToAppNotifications = {
	sessionEvent: zSessionEventEnvelope,
	liveState: z.object({ sessionId: zSessionId, liveState: zLiveState }),
	/** The agent's own session id became known (first turn) or changed (fork). */
	agentSessionId: z.object({ sessionId: zSessionId, agentSessionId: z.string() }),
	/** The UpdateProgress tool was called. The UI shows it above the composer. */
	progress: z.object({ sessionId: zSessionId, progress: zProgress }),
	agentInstallsChanged: z.object({ agents: z.array(zAgentInstall) }),
	/**
	 * The agent changed the chat's settings by itself, for example it entered plan mode. The UI
	 * stores `config` as the chat's config.
	 */
	agentConfigChanged: z.object({
		sessionId: zSessionId,
		config: zSessionConfig,
		reason: z.enum(["entered_plan_mode", "left_plan_mode"]),
	}),
	/** An open interaction closed without the user's answer taking effect. */
	interactionClosed: z.object({
		sessionId: zSessionId,
		interactionId: zInteractionId,
		reason: zInteractionClosedReason,
	}),
	/** A Claude chat's Remote Control link changed: asked for, connected, lost or turned off (RC-02). */
	remoteControlState: z.object({ sessionId: zSessionId, status: zRemoteControlStatus }),
	/** Codex's goal for the chat changed or was cleared (null). */
	goalChanged: z.object({ sessionId: zSessionId, goal: zCodexGoal.nullable() }),
	/**
	 * The login-shell environment for a folder could not be captured. The UI shows a toast. A
	 * failure is not remembered, so the next capture tries again.
	 */
	shellEnvFailed: z.object({
		folder: z.string(),
		kind: z.enum(["timeout", "shell_not_found", "unknown"]),
		message: z.string(),
	}),
} as const;

export const sidecarToAppRequests = {
	/** Ask the user a question, a tool approval, a plan approval, or a permission. See `expiresAt` for limits. */
	requestInteraction: method(zInteractionRequest, zInteractionAnswer),
	/** Resend an event the UI has not acknowledged (after a reconnect). */
	deliverEvent: method(zSessionEventEnvelope, z.object({ persisted: z.boolean() })),
	/** Backs the GetWorkspaceDiff tool: the diff the user sees, against the merge base. */
	getWorkspaceDiff: method(
		z.object({ sessionId: zSessionId, file: z.string().optional(), statOnly: z.boolean() }),
		z.object({ diff: z.string() }),
	),
	getDiffComments: method(
		z.object({ sessionId: zSessionId, file: z.string().optional() }),
		z.object({ comments: z.array(zDiffCommentView) }),
	),
	addDiffComments: method(
		z.object({ sessionId: zSessionId, comments: z.array(zDiffCommentInput).min(1) }),
		z.object({ added: z.number().int().nonnegative() }),
	),
	getTerminalOutput: method(
		z.object({
			sessionId: zSessionId,
			source: z.enum(["auto", "run_script", "spotlight", "terminal"]),
			maxLines: z.number().int().positive(),
		}),
		z.object({ output: z.string(), source: z.string(), running: z.boolean() }),
	),
	/** Backs the SetTargetBranch tool. The UI checks the branch exists on origin and stores it. */
	setTargetBranch: method(
		z.object({ sessionId: zSessionId, branch: z.string() }),
		z.object({ ok: z.boolean(), message: z.string() }),
	),
} as const;

// ---------------------------------------------------------------- helper types

type Spec = MethodSpec<z.ZodType, z.ZodType>;
export type ParamsOf<T extends Spec> = z.infer<T["params"]>;
export type ResultOf<T extends Spec> = z.infer<T["result"]>;

export type AppToSidecarRequest = keyof typeof appToSidecarRequests;
export type SidecarToAppRequest = keyof typeof sidecarToAppRequests;
export type AppToSidecarNotification = keyof typeof appToSidecarNotifications;
export type SidecarToAppNotification = keyof typeof sidecarToAppNotifications;

/** JSON-RPC error codes used by both sides. -32000 to -32099 are ours. */
export const RPC_ERRORS = {
	parseError: -32700,
	invalidRequest: -32600,
	methodNotFound: -32601,
	invalidParams: -32602,
	internalError: -32603,
	notImplemented: -32001,
	sessionUnknown: -32002,
	agentNotInstalled: -32003,
	agentAuthRequired: -32004,
	cancelled: -32005,
} as const;
