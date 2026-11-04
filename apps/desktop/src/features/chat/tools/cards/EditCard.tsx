/**
 * @feature CHAT-08 Edit card
 * Owns: The card for one text replacement in a file: path and a small diff of old and new text.
 * Behaviour: ui-map.md 3.3 (Edit: 'Open in editor', diff body; a note when the agent retries an
 * edit because of a permissions bug).
 * Must handle: Replace-all edits; an edit that failed because the old text was not found (error in
 * the frame); an edit that was denied; very long lines scroll sideways.
 * Test first: An edit call renders removed and added lines with their markers.
 */
import { notImplemented } from "@conducted/shared";
import type { ToolCardProps } from "../tool-card-props.ts";

export function EditCard(_props: ToolCardProps): never {
	return notImplemented("CHAT-08");
}
