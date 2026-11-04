/**
 * @feature CHAT-08 Glob card
 * Owns: The card for a file-name search: the pattern and the matching paths.
 * Behaviour: ui-map.md 3.3 (Glob), frontend.md 5.
 * Must handle: No matches ('No files found'); more than 50 matches (first 50 and 'and N more');
 * each path opens the file tab.
 * Test first: A glob call with three results lists three paths.
 */
import { notImplemented } from "@conducted/shared";
import type { ToolCardProps } from "../tool-card-props.ts";

export function GlobCard(_props: ToolCardProps): never {
	return notImplemented("CHAT-08");
}
