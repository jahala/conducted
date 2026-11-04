/**
 * @feature CHAT-08 Sub-agent card
 * Owns: The card for a task the agent handed to a sub-agent: its description, its own tool calls
 * grouped inside, and its final answer.
 * Behaviour: frontend.md 5 (sub-agent messages are bucketed under their parent Task call),
 * ui-map.md 3.3 ('Subagent').
 * Must handle: Many nested calls (collapsed to a count, expandable); a running sub-agent (live
 * count); a sub-agent that failed; a nested sub-agent; the children render through ToolCard so
 * every kind of card works inside.
 * Test first: A call with two children shows 'Subagent', the description, and two nested cards.
 */
import { notImplemented } from "@conducted/shared";
import type { ToolCardProps } from "../tool-card-props.ts";

export function SubAgentCard(_props: ToolCardProps): never {
	return notImplemented("CHAT-08");
}
