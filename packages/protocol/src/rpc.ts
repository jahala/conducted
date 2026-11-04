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
import { zInteractionAnswer, zInteractionRequest } from "./interactions.ts";
import { zLiveState } from "./live-state.ts";
import { zEffort, zSessionConfig, zWorkspaceContext } from "./session-config.ts";

/**
 * The JSON-RPC contract between the desktop UI and the sidecar.
 * Transport: one JSON-RPC 2.0 message per line (NDJSON) over the sidecar's Unix socket,
 * relayed by the Rust shell (`rpc_to_sidecar` command, `rpc_from_sidecar` event).
 * Both sides parse every message with these schemas.
 * Research: frontend.md 3c, sessions.md section 10. Method names are ours.
 */

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
});

export const zModelInfo = z.object({
	id: z.string(),
	label: z.string(),
	efforts: z.array(zEffort),
	defaultEffort: zEffort,
	supportsFastMode: z.boolean(),
	contextWindowTokens: z.number().int().positive().optional(),
});

export type ModelInfo = z.infer<typeof zModelInfo>;
export type SlashCommand = z.infer<typeof zSlashCommand>;

export const zAgentInstall = z.object({
	agent: zAgentKind,
	acpAgent: zAcpAgent.optional(),
	installed: z.boolean(),
	path: z.string().optional(),
	version: z.string().optional(),
	authenticated: z.boolean().optional(),
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
			resume: zResume.optional(),
		}),
		z.object({ deliveredAs: z.enum(["new_turn", "steer", "queued"]) }),
	),
	/** Stop the running turn, take the end checkpoint, drop queued messages, withdraw interactions. */
	cancel: method(z.object({ sessionId: zSessionId }), z.object({ wasWorking: z.boolean() })),
	/** Start the agent process before the first message, to cut waiting time. */
	warmAgent: method(
		z.object({
			sessionId: zSessionId,
			config: zSessionConfig,
			workspace: zWorkspaceContext,
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
	/** Ask the sidecar what it knows. "known: false" means it restarted and has no state for this chat. */
	getSessionStatus: method(
		z.object({ sessionId: zSessionId }),
		z.object({ known: z.boolean(), liveState: zLiveState.optional() }),
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
			plan: z
				.object({
					fiveHourUsedPercent: z.number().optional(),
					sevenDayUsedPercent: z.number().optional(),
					resetsAt: z.number().optional(),
				})
				.optional(),
		}),
	),
	listSlashCommands: method(
		z.object({ agent: zAgentKind, acpAgent: zAcpAgent.optional(), workspacePath: z.string() }),
		z.object({ commands: z.array(zSlashCommand) }),
	),
	listMcpServers: method(
		z.object({ agent: zAgentKind, acpAgent: zAcpAgent.optional(), workspacePath: z.string() }),
		z.object({
			servers: z.array(
				z.object({
					name: z.string(),
					status: z.enum(["connected", "failed", "needs_auth", "pending", "disabled"]),
					toolCount: z.number().int().nonnegative().optional(),
				}),
			),
		}),
	),
	listModels: method(
		z.object({ agent: zAgentKind, acpAgent: zAcpAgent.optional() }),
		z.object({ models: z.array(zModelInfo) }),
	),
	/** Which agent programs are installed, their versions and whether they are signed in. */
	getAgentInstalls: method(empty, z.object({ agents: z.array(zAgentInstall) })),
	/** Start the agent's own sign-in flow (browser or device code). */
	startAgentLogin: method(
		z.object({ agent: zAgentKind, acpAgent: zAcpAgent.optional() }),
		z.object({ url: z.string().optional(), code: z.string().optional(), instructions: z.string() }),
	),
	/** The PATH and shell captured from the user's login shell. */
	getShellEnv: method(
		z.object({ workspacePath: z.string() }),
		z.object({ shell: z.string(), path: z.string() }),
	),
} as const;

export const appToSidecarNotifications = {
	/** The UI has stored this event. The sidecar may drop it from its write-ahead log. */
	eventPersisted: z.object({ sessionId: zSessionId, eventId: zEventId }),
	setLogLevel: z.object({ level: z.enum(["error", "warn", "info", "debug"]) }),
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
	progress: z.object({
		sessionId: zSessionId,
		title: z.string().optional(),
		steps: z.array(
			z.object({ label: z.string(), status: z.enum(["pending", "in_progress", "done", "failed"]) }),
		),
	}),
	agentInstallsChanged: z.object({ agents: z.array(zAgentInstall) }),
} as const;

export const sidecarToAppRequests = {
	/** Ask the user a question, a tool approval, a plan approval, or a permission. No timeout. */
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
