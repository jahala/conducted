/**
 * @feature CHAT-08 Web fetch card
 * Owns: The card for fetching a web page: the address and a short excerpt of what came back.
 * Behaviour: frontend.md 5 (registry key 'web'), ui-map.md 3.3 (approval title 'fetch this page').
 * Must handle: Blocked or failed fetch (error in the frame); the address opens outside the app only
 * on click; redirects (final address shown); a very long page (cut).
 * Test first: A web_fetch call shows the host prominently and the full address on hover.
 */
import { notImplemented } from "@conducted/shared";
import type { ToolCardProps } from "../tool-card-props.ts";

export function WebFetchCard(_props: ToolCardProps): never {
	return notImplemented("CHAT-08");
}
