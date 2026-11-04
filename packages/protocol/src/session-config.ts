import { z } from "zod";
import { zAcpAgent, zAgentKind } from "./ids.ts";

/**
 * The settings a chat runs with. Sent with every message; the sidecar applies changes live
 * when the agent allows it and restarts the agent with resume when it does not.
 * Research: sessions.md section 2 step 3, claude-runner.md section 1.5.
 */
export const zEffort = z.enum(["low", "medium", "high", "xhigh", "max"]);
export type Effort = z.infer<typeof zEffort>;

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
	/** Absolute paths the agent may also read and edit (linked workspaces and folders). */
	additionalDirectories: z.array(z.string()),
	/** Which app tools to expose. */
	appTools: z.object({
		diffComments: z.boolean(),
		progressUpdates: z.boolean(),
	}),
});
export type SessionConfig = z.infer<typeof zSessionConfig>;

/** Everything the sidecar needs to place a chat on disk. */
export const zWorkspaceContext = z.object({
	/** The worktree folder the agent works in. */
	workspacePath: z.string(),
	/** The main clone of the repository. Agents must not write there. */
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
