/**
 * The settings a chat runs with. Sent with every message; the sidecar applies changes live
 * when the agent allows it and restarts the agent with resume when it does not.
 * Research: sessions.md section 2 step 3, claude-runner.md sections 1.2 and 1.5, other-runners.md
 * sections 1 and 4 (Codex approval policy and sandbox).
 */
import { z } from "zod";
import { zAcpAgent, zAgentKind, zWorkspaceId } from "./ids.ts";

/**
 * How hard the agent thinks. Each model lists the levels it accepts (`ModelInfo.efforts`).
 * "none" turns thinking off (Codex). "ultra" is Codex's top level. "ultracode" is Claude's top
 * level, which Claude reads from its settings rather than its effort flag.
 */
export const zEffort = z.enum([
	"none",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
	"ultra",
	"ultracode",
]);
export type Effort = z.infer<typeof zEffort>;

/** Claude's output style. "default" is Claude's own style. */
export const zClaudeOutputStyle = z.enum([
	"default",
	"proactive",
	"concise",
	"explanatory",
	"learning",
]);
export type ClaudeOutputStyle = z.infer<typeof zClaudeOutputStyle>;

/** The tone Codex uses. "none" asks Codex for no particular tone. */
export const zCodexPersonality = z.enum(["pragmatic", "friendly", "none"]);
export type CodexPersonality = z.infer<typeof zCodexPersonality>;

/** When Codex asks before it runs a command, in Codex's own words. */
export const zCodexApprovalPolicy = z.enum(["untrusted", "on-failure", "on-request", "never"]);
export type CodexApprovalPolicy = z.infer<typeof zCodexApprovalPolicy>;

/** What Codex may touch without asking, in Codex's own words. */
export const zCodexSandboxMode = z.enum(["read-only", "workspace-write", "danger-full-access"]);
export type CodexSandboxMode = z.infer<typeof zCodexSandboxMode>;

export const zSessionConfig = z.object({
	agent: zAgentKind,
	/** Which ACP agent, when `agent` is "acp". */
	acpAgent: zAcpAgent.optional(),
	model: z.string(),
	effort: zEffort,
	fastMode: z.boolean(),
	/** Plan mode: the agent proposes a plan and waits for approval before editing. */
	planMode: z.boolean(),
	/** Ask the user before tools that change files or run commands. */
	requireToolApproval: z.boolean(),
	/**
	 * Claude only: let Claude decide by itself which tool calls are safe to run without asking.
	 * Missing means off.
	 */
	autoPermissionMode: z.boolean().optional(),
	/** Absolute paths the agent may also read and edit (linked workspaces and folders). */
	additionalDirectories: z.array(z.string()),
	/** Which app tools to expose. */
	appTools: z.object({
		diffComments: z.boolean(),
		progressUpdates: z.boolean(),
		/** The SetTargetBranch tool, which lets the agent change the branch this workspace merges into. */
		setTargetBranch: z.boolean(),
	}),
	/** Claude only. Missing means Claude's default style. A change restarts Claude with resume. */
	claudeOutputStyle: zClaudeOutputStyle.optional(),
	/** Claude only: start Claude with its Chrome browser tools. A change restarts Claude with resume. */
	claudeInChrome: z.boolean().optional(),
	/**
	 * Claude only: share the chat through Claude Remote Control (D019), so claude.ai/code and the
	 * Claude app can follow and steer it. Missing means off. A change applies to the live agent.
	 */
	remoteControl: z.boolean().optional(),
	/** Codex only. Missing means the model's default tone. */
	codexPersonality: zCodexPersonality.optional(),
	/**
	 * Codex only. Missing: the runner derives it from `requireToolApproval` ("on-request" when on,
	 * "never" when off).
	 */
	codexApprovalPolicy: zCodexApprovalPolicy.optional(),
	/** Codex only. Missing: the runner uses "danger-full-access", as Conductor does. */
	codexSandboxMode: zCodexSandboxMode.optional(),
	/**
	 * ACP only: the chat's choices for the agent's own options beyond the model, by option id
	 * (see `listAcpConfigOptions`). A select option holds the chosen value id, a switch a boolean.
	 */
	acpConfig: z.record(z.string(), z.union([z.string(), z.boolean()])).optional(),
});
export type SessionConfig = z.infer<typeof zSessionConfig>;

/** Everything the sidecar needs to place a chat on disk. */
export const zWorkspaceContext = z.object({
	/** The workspace this chat belongs to, exported to the agent as CONDUCTED_WORKSPACE_ID. */
	workspaceId: zWorkspaceId,
	/** The workspace's folder name (its place name), exported as CONDUCTED_WORKSPACE_NAME. */
	workspaceName: z.string(),
	/** The worktree folder the agent works in. */
	workspacePath: z.string(),
	/**
	 * The main clone of the repository: its main worktree, the `mainWorktreePath` of Conductor's
	 * query options (frontend.md 3c). Agents must not write there. Every runner gets it in
	 * `StartOptions.workspace`, and agents see it as CONDUCTED_ROOT_PATH.
	 */
	repoRootPath: z.string(),
	/** For example "origin/main". */
	targetBranch: z.string(),
	/** True while the branch still has its placeholder name. */
	placeholderBranch: z.boolean(),
	/** Port reserved for this workspace's run script, exported as CONDUCTED_PORT. */
	port: z.number().int().positive(),
	/** User preferences text appended to messages, from settings. */
	userPreferences: z.string().optional(),
});
export type WorkspaceContext = z.infer<typeof zWorkspaceContext>;

/** Where a provider key the agent gets came from (D033). */
export const zKeySource = z.enum(["entered", "this_mac"]);
export type KeySource = z.infer<typeof zKeySource>;

/**
 * How to start the agent program of a chat. Sent with `sendMessage`, `warmAgent` and
 * `runUtilityPrompt`. A change in any field restarts an idle chat's agent with resume; a working
 * chat restarts at its next turn (SIDE-21).
 * Values are secrets or close to them: the sidecar never writes them to its logs.
 */
export const zAgentLaunch = z.object({
	/**
	 * The program the user chose in settings. Missing: the app's managed copy (D021), and the
	 * copy on the login-shell PATH when there is no managed one.
	 */
	executablePath: z.string().optional(),
	/**
	 * Variables from the Environment page for this workspace, the repository's replacing the
	 * global ones of the same name. Values come from the Keychain.
	 */
	env: z.record(z.string(), z.string()),
	/**
	 * Provider keys for this agent only (D033), by environment variable name, for example
	 * ANTHROPIC_API_KEY or AWS_SECRET_ACCESS_KEY.
	 */
	providerKeys: z.record(z.string(), z.object({ value: z.string(), source: zKeySource })),
	/** The provider the agent signs in with, for example "bedrock" or "vertex". Missing: the standard sign-in. */
	provider: z.string().optional(),
	/** A base URL that replaces the provider's own, for example OPENAI_BASE_URL for Codex. */
	baseUrl: z.string().optional(),
});
export type AgentLaunch = z.infer<typeof zAgentLaunch>;
