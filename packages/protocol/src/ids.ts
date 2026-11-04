import type {
	CheckpointId,
	CommentId,
	EventId,
	InteractionId,
	MessageId,
	SessionId,
	ToolUseId,
	TurnId,
	WorkspaceId,
} from "@conducted/shared";
import { ACP_AGENTS, AGENT_KINDS } from "@conducted/shared";
import { z } from "zod";

/** Zod schema for a branded id: any non-empty string, typed as the brand. */
const brandedId = <T extends string>() =>
	z.custom<T>((value) => typeof value === "string" && value.length > 0, "Expected an id");

export const zSessionId = brandedId<SessionId>();
export const zWorkspaceId = brandedId<WorkspaceId>();
export const zTurnId = brandedId<TurnId>();
export const zMessageId = brandedId<MessageId>();
export const zEventId = brandedId<EventId>();
export const zToolUseId = brandedId<ToolUseId>();
export const zInteractionId = brandedId<InteractionId>();
export const zCheckpointId = brandedId<CheckpointId>();
export const zCommentId = brandedId<CommentId>();

export const zAgentKind = z.enum(AGENT_KINDS);
export const zAcpAgent = z.enum(ACP_AGENTS);
