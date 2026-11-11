/**
 * @feature CHAT-08 Tool card props
 * Owns: the one prop shape every tool card takes.
 * Behaviour: frontend.md 5 (tool cards), ui-map.md 3.3 (tool cards).
 * Must handle: `call.result` is null while the tool runs; `call.blocks` holds everything a sub-agent showed inside it.
 * Test first: not needed, this is a type only.
 */
import type { SessionId } from "@conducted/shared";
import type { ToolCallView } from "../../../core/model.ts";

export interface ToolCardProps {
	call: ToolCallView;
	sessionId: SessionId;
	/** Garry mode, passed down so a nested sub-agent card expands the same way. */
	defaultExpanded?: boolean;
}
