/**
 * Moments where an agent waits for the user. The sidecar sends one request kind,
 * `requestInteraction`, and the UI answers it. Only one interaction per session is open at a
 * time. Cancelling or sending a new message withdraws it.
 * Research: sessions-and-chats.md "Questions, approvals and plans", claude-runner.md section 3.
 */
import { z } from "zod";
import { zInteractionId, zSessionId, zToolUseId } from "./ids.ts";

export const zQuestion = z.object({
	header: z.string().optional(),
	question: z.string(),
	options: z.array(z.object({ label: z.string(), description: z.string().optional() })).max(4),
	multiSelect: z.boolean(),
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
		scope: z.enum(["file_system", "network", "command"]),
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
		decision: z.enum(["allow", "allow_edits_for_session", "always_allow", "deny"]),
		message: z.string().optional(),
	}),
	z.object({
		kind: z.literal("plan_approval"),
		approved: z.boolean(),
		feedback: z.string().optional(),
	}),
	z.object({ kind: z.literal("permission_grant"), granted: z.boolean() }),
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
});
export type InteractionRequest = z.infer<typeof zInteractionRequest>;
