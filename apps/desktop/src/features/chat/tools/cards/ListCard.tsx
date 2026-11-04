/**
 * @feature CHAT-08 List card
 * Owns: The card for a directory listing.
 * Behaviour: ui-map.md 3.3 ('List files'), frontend.md 5 (registry key 'ls').
 * Must handle: Empty directory; a long listing (first 50); directories are marked with a trailing
 * slash and a different weight, not a colour.
 * Test first: A list call renders the directory path and its entries.
 */
import { notImplemented } from "@conducted/shared";
import type { ToolCardProps } from "../tool-card-props.ts";

export function ListCard(_props: ToolCardProps): never {
	return notImplemented("CHAT-08");
}
