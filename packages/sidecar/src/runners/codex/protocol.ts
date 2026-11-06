/**
 * @feature AGENT-06 Codex: `codex app-server` JSON-RPC
 * Owns: the method names and the parts of the request and notification shapes the Codex runner
 * uses. We talk to `codex app-server --listen stdio://` directly and do not use a Codex SDK.
 * Behaviour: research/conductor/other-runners.md section 2.1. The shapes below were checked
 * against the TypeScript bindings that `codex app-server generate-ts` writes for codex-cli 0.154.0
 * (the installed version on the development Mac; Conductor pins a newer one). Only fields we read
 * or write are listed; the real types have many more. Re-generate the bindings and compare when
 * the Codex version changes.
 * Must handle: unknown fields in server messages (ignored), unknown thread item types (kept as
 * `unknown` and logged by the translator), and a server that is newer or older than the one the
 * shapes were checked against (the client reports the version from the `initialize` reply).
 * Test first: protocol.test.ts pins every method name to the name in the JSON schema that `codex
 * app-server generate-json-schema` writes, and feeds the notification names to the translator.
 */

/** Requests we send to the app server. */
export const CODEX_CLIENT_METHODS = {
	initialize: "initialize",
	threadStart: "thread/start",
	threadResume: "thread/resume",
	threadFork: "thread/fork",
	threadRollback: "thread/rollback",
	threadCompactStart: "thread/compact/start",
	turnStart: "turn/start",
	turnSteer: "turn/steer",
	turnInterrupt: "turn/interrupt",
	modelList: "model/list",
	accountRead: "account/read",
	accountLoginStart: "account/login/start",
	accountLoginCancel: "account/login/cancel",
	mcpServerStatusList: "mcpServerStatus/list",
	skillsList: "skills/list",
} as const;

/** The one notification we send after the initialize reply. */
export const CODEX_INITIALIZED_NOTIFICATION = "initialized";

/** Requests the server sends to us. Each one needs an answer. */
export const CODEX_SERVER_REQUESTS = {
	commandApproval: "item/commandExecution/requestApproval",
	fileChangeApproval: "item/fileChange/requestApproval",
	toolUserInput: "item/tool/requestUserInput",
	mcpElicitation: "mcpServer/elicitation/request",
	permissionsApproval: "item/permissions/requestApproval",
} as const;

/** Notifications the server sends to us that the runner reacts to. */
export const CODEX_SERVER_NOTIFICATIONS = {
	threadStarted: "thread/started",
	turnStarted: "turn/started",
	turnCompleted: "turn/completed",
	itemStarted: "item/started",
	itemCompleted: "item/completed",
	tokenUsageUpdated: "thread/tokenUsage/updated",
	threadCompacted: "thread/compacted",
	error: "error",
	accountLoginCompleted: "account/login/completed",
} as const;

export interface CodexUserInputText {
	type: "text";
	text: string;
	text_elements: unknown[];
}

export interface CodexLocalImageInput {
	type: "localImage";
	path: string;
}

export type CodexUserInput = CodexUserInputText | CodexLocalImageInput;

export type CodexApprovalPolicy = "untrusted" | "on-failure" | "on-request" | "never";
export type CodexSandboxMode = "read-only" | "workspace-write" | "danger-full-access";
/** The tone Codex uses. "none" leaves the model's own tone alone. */
export type CodexPersonality = "none" | "friendly" | "pragmatic";

export interface CodexThreadStartParams {
	model?: string | null;
	cwd?: string | null;
	approvalPolicy?: CodexApprovalPolicy | null;
	sandbox?: CodexSandboxMode | null;
	personality?: CodexPersonality | null;
	/** Config overrides, for example the MCP server entry for the app tools. */
	config?: Record<string, unknown> | null;
}

export interface CodexThreadResumeParams extends CodexThreadStartParams {
	threadId: string;
}

export interface CodexThread {
	id: string;
}

export interface CodexThreadStartResult {
	thread: CodexThread;
	model: string;
}

export interface CodexTurnStartParams {
	threadId: string;
	input: CodexUserInput[];
	model?: string | null;
	effort?: string | null;
	approvalPolicy?: CodexApprovalPolicy | null;
	personality?: CodexPersonality | null;
}

export type CodexTurnStatus = "completed" | "interrupted" | "failed" | "inProgress";

export interface CodexTurn {
	id: string;
	status: CodexTurnStatus;
	error: { message: string } | null;
}

export interface CodexTurnSteerParams {
	threadId: string;
	input: CodexUserInput[];
	/** The request fails when this is not the active turn. */
	expectedTurnId: string;
}

export interface CodexTurnInterruptParams {
	threadId: string;
	turnId: string;
}

export interface CodexTokenUsageBreakdown {
	totalTokens: number;
	inputTokens: number;
	cachedInputTokens: number;
	cacheWriteInputTokens: number;
	outputTokens: number;
	reasoningOutputTokens: number;
}

export interface CodexThreadTokenUsage {
	total: CodexTokenUsageBreakdown;
	last: CodexTokenUsageBreakdown;
	modelContextWindow: number | null;
}

export interface CodexModel {
	id: string;
	model: string;
	displayName: string;
	hidden: boolean;
	supportedReasoningEfforts: { reasoningEffort: string }[];
	defaultReasoningEffort: string;
	isDefault: boolean;
}

export interface CodexModelListResult {
	data: CodexModel[];
	nextCursor: string | null;
}
