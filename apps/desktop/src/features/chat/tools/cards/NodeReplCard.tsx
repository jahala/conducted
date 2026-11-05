/**
 * @feature CHAT-20 Node REPL card
 * Owns: The card for JavaScript the agent ran in a Node REPL.
 * Behaviour: ui-map.md 3.3 ('Node REPL').
 * Must handle: Long output (collapsed); an error result.
 * Test first: A node_repl call renders 'Node REPL' with the code and its output.
 */
import { notImplemented } from "@conducted/shared";
import type { ToolCardProps } from "../tool-card-props.ts";

export function NodeReplCard(_props: ToolCardProps): never {
	return notImplemented("CHAT-20");
}
