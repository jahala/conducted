/**
 * Moments where an agent waits for the user. The sidecar sends one request kind,
 * `requestInteraction`, and the UI answers it. Only one interaction per session is open at a
 * time. Cancelling or sending a new message withdraws it. When the agent stops waiting by itself
 * (a timeout) or an answer cannot reach the agent, the sidecar sends `interactionClosed`.
 * Research: sessions-and-chats.md "Questions, approvals and plans", claude-runner.md section 3,
 * other-runners.md section 4 (Codex permission grants, MCP forms and their 300 s timeout).
 */
import { z } from "zod";
import { zInteractionId, zSessionId, zToolUseId } from "./ids.ts";

/**
 * How long Codex waits for an answer to a permission grant or an MCP form before it gives up:
 * 300 seconds. Questions, tool approvals and plan approvals wait without a limit.
 */
export const CODEX_INTERACTION_TIMEOUT_MS = 300_000;

export const zQuestion = z.object({
	header: z.string().optional(),
	question: z.string(),
	options: z
		.array(
			z.object({
				label: z.string(),
				description: z.string().optional(),
				/** Text or code shown on the card when the option is focused, such as a sample. */
				preview: z.string().optional(),
			}),
		)
		.max(4),
	multiSelect: z.boolean(),
	/** The answer is a secret, such as a password: the card masks what the user types. */
	secret: z.boolean().optional(),
});

/** One path in a Codex permission request, with the access Codex asks for. */
export const zPermissionPath = z.object({
	path: z.string(),
	/** path: one file or folder. glob: a pattern. special: a named location such as the temp folder. */
	pathKind: z.enum(["path", "glob", "special"]),
	access: z.enum(["read", "write", "deny"]),
});

export const zInteraction = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("question"),
		questions: z.array(zQuestion).min(1).max(4),
	}),
	z.object({
		kind: z.literal("tool_approval"),
		toolUseId: zToolUseId,
		toolName: z.string(),
		input: z.unknown(),
		/** Why the agent asks, when it says. */
		reason: z.string().optional(),
		/** A path outside the allowed folders, when that is the reason. */
		blockedPath: z.string().optional(),
		/**
		 * Permission rules the agent proposes, in plain words, such as "Allow npm test in this
		 * project". The card offers "allow with these rules" when there are any. The runner keeps
		 * the rules themselves.
		 */
		suggestedRules: z.array(z.string()).optional(),
		/** Set when a sub-agent asks. The card shows a Subagent badge. */
		subAgentId: z.string().optional(),
	}),
	z.object({
		kind: z.literal("plan_approval"),
		plan: z.string(),
		planFilePath: z.string().optional(),
	}),
	z.object({
		/** Codex asks for file-system or network access beyond its sandbox. */
		kind: z.literal("permission_grant"),
		description: z.string(),
		/** Why Codex asks, when it says. */
		reason: z.string().optional(),
		/** The paths Codex asks for, each with the access it wants. */
		paths: z.array(zPermissionPath),
		/** True when Codex also asks for network access. */
		network: z.boolean(),
	}),
	z.object({
		/** An MCP server asks the user to fill in a form. */
		kind: z.literal("mcp_form"),
		server: z.string(),
		message: z.string(),
		schema: z.unknown(),
	}),
]);
export type Interaction = z.infer<typeof zInteraction>;

export const zInteractionAnswer = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("question"),
		/** One entry per question: the chosen labels, or free text typed as "Other". */
		answers: z.array(z.array(z.string())),
	}),
	z.object({
		kind: z.literal("tool_approval"),
		/** allow_with_suggested_rules: allow, and add the rules the agent proposed (`suggestedRules`). */
		decision: z.enum([
			"allow",
			"allow_edits_for_session",
			"allow_with_suggested_rules",
			"always_allow",
			"deny",
		]),
		message: z.string().optional(),
	}),
	z.object({
		kind: z.literal("plan_approval"),
		approved: z.boolean(),
		feedback: z.string().optional(),
	}),
	z.object({
		kind: z.literal("permission_grant"),
		granted: z.boolean(),
		/** How long a grant lasts: this turn only, or the rest of the chat. Missing means the turn. */
		grantFor: z.enum(["turn", "session"]).optional(),
	}),
	z.object({
		kind: z.literal("mcp_form"),
		action: z.enum(["accept", "decline", "cancel"]),
		content: z.unknown().optional(),
	}),
	/** The interaction was withdrawn: the user cancelled, sent a new message, or closed the chat. */
	z.object({ kind: z.literal("withdrawn") }),
]);
export type InteractionAnswer = z.infer<typeof zInteractionAnswer>;

export const zInteractionRequest = z.object({
	sessionId: zSessionId,
	interactionId: zInteractionId,
	interaction: zInteraction,
	/**
	 * When the agent stops waiting, in milliseconds since the epoch. Set for Codex permission
	 * grants and MCP forms (CODEX_INTERACTION_TIMEOUT_MS after they open). Missing: no limit.
	 */
	expiresAt: z.number().optional(),
});
export type InteractionRequest = z.infer<typeof zInteractionRequest>;

/**
 * Why an open interaction closed without the user's answer taking effect. timed_out: the agent
 * stopped waiting; the card shows that it timed out. delivery_failed: the answer could not reach
 * the agent; the card comes back so the user can answer again.
 */
export const zInteractionClosedReason = z.enum(["timed_out", "delivery_failed"]);
export type InteractionClosedReason = z.infer<typeof zInteractionClosedReason>;
