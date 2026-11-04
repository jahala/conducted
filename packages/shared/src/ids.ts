/**
 * Branded ids, so a session id can never be passed where a workspace id is expected.
 * All ids are UUID v4 strings made by an injected IdSource (see clock.ts), which keeps
 * tests deterministic.
 */
declare const brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type RepoId = Brand<string, "RepoId">;
export type WorkspaceId = Brand<string, "WorkspaceId">;
export type SessionId = Brand<string, "SessionId">;
export type TurnId = Brand<string, "TurnId">;
export type MessageId = Brand<string, "MessageId">;
export type EventId = Brand<string, "EventId">;
export type ToolUseId = Brand<string, "ToolUseId">;
export type InteractionId = Brand<string, "InteractionId">;
export type CheckpointId = Brand<string, "CheckpointId">;
export type TerminalId = Brand<string, "TerminalId">;
export type CommentId = Brand<string, "CommentId">;
export type AttachmentId = Brand<string, "AttachmentId">;
export type SectionId = Brand<string, "SectionId">;
/** A saved prompt snippet (COMP-09). */
export type SnippetId = Brand<string, "SnippetId">;

/** Agent families the app can drive. ACP covers OpenCode and Pi. */
export const AGENT_KINDS = ["claude", "codex", "cursor", "acp"] as const;
export type AgentKind = (typeof AGENT_KINDS)[number];

/** ACP agents the app knows how to launch. */
export const ACP_AGENTS = ["opencode", "pi"] as const;
export type AcpAgent = (typeof ACP_AGENTS)[number];

/**
 * Programs the app downloads, verifies, updates and prunes for the user (D021, D024). The user may
 * choose a copy of their own instead in settings. ACP adapters (OpenCode, Pi) are not in this list:
 * the sidecar installs those.
 */
export const MANAGED_PROGRAMS = ["claude", "codex", "gh", "watchexec"] as const;
export type ManagedProgram = (typeof MANAGED_PROGRAMS)[number];
