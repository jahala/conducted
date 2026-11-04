/**
 * @feature CHAT-08 Web search card
 * Owns: The card for a web search: the query and the result titles with links.
 * Behaviour: frontend.md 5 (registry key 'web'), ui-map.md 3.3 (approval title 'do this search').
 * Must handle: No results; results without titles (show the address); many results (first 8).
 * Test first: A web_search call shows the query and one row per result.
 */
import { notImplemented } from "@conducted/shared";
import type { ToolCardProps } from "../tool-card-props.ts";

export function WebSearchCard(_props: ToolCardProps): never {
	return notImplemented("CHAT-08");
}
