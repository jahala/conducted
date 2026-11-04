/**
 * @feature CHAT-08 Generic tool card
 * Owns: The fallback card for any tool without its own card: the agent's own tool name, the input
 * and the output.
 * Behaviour: ui-map.md 3.3 ('Unknown tools fall back to a generic card'), frontend.md 5.
 * Must handle: Input that is not an object; output that is empty; a very large input (cut); the raw
 * name is always shown so the user knows what ran.
 * Test first: A call with tool 'unknown' and raw name 'FooTool' renders 'FooTool' and its input as
 * JSON.
 */
import { notImplemented } from "@conducted/shared";
import type { ToolCardProps } from "../tool-card-props.ts";

export function GenericToolCard(_props: ToolCardProps): never {
	return notImplemented("CHAT-08");
}
