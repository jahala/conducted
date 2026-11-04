/**
 * @feature CHAT-08 Grep card
 * Owns: The card for a content search: the pattern, filters and the matches.
 * Behaviour: frontend.md 5 (registry key 'grep').
 * Must handle: No matches; matches grouped by file; counts-only and files-only modes; a very large
 * result (cut).
 * Test first: A grep call renders its pattern and one group per matching file.
 */
import { notImplemented } from "@conducted/shared";
import type { ToolCardProps } from "../tool-card-props.ts";

export function GrepCard(_props: ToolCardProps): never {
	return notImplemented("CHAT-08");
}
