/**
 * @feature CHAT-08 Write card
 * Owns: The card for a file write: path and the new content as an added-lines diff.
 * Behaviour: ui-map.md 3.3 (Edit and Write: 'Open in editor', 'Edit', diff body).
 * Must handle: New file versus overwrite; huge content (first lines plus 'Show all'); a write that
 * was denied or failed; 'Open in editor' opens the file tab in edit mode.
 * Test first: A write call renders the path and its content lines; 'Open in editor' sets
 * fileMode=edit.
 */
import { notImplemented } from "@conducted/shared";
import type { ToolCardProps } from "../tool-card-props.ts";

export function WriteCard(_props: ToolCardProps): never {
	return notImplemented("CHAT-08");
}
