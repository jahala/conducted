/**
 * @feature CHAT-08 Bash card
 * Owns: The card for a shell command: the command, its output and whether it succeeded.
 * Behaviour: ui-map.md 3.3 (Bash with 'Clear output', 'Formatted' and 'Raw' JSON toggle, 'Input:').
 * Must handle: Running (output streams in); non-zero exit shown as failed; output truncated by the
 * runner (labelled); very long output scrolls inside a limited height; ANSI colour codes are
 * stripped or rendered, not shown raw; a background command (links to its BashOutputCard).
 * Test first: A bash call with output shows the command line and the output text; a result with
 * isError shows Failed.
 */
import { notImplemented } from "@conducted/shared";
import type { ToolCardProps } from "../tool-card-props.ts";

export function BashCard(_props: ToolCardProps): never {
	return notImplemented("CHAT-08");
}
