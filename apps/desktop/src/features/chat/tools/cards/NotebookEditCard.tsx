/**
 * @feature CHAT-08 Notebook edit card
 * Owns: The card for an edit to a Jupyter notebook cell.
 * Behaviour: other-runners.md 3 (canonical notebook_edit tool).
 * Must handle: Insert, replace and delete modes; cell index and cell type shown; a notebook that is
 * not valid JSON (error from the agent shown as is).
 * Test first: A replace call shows the cell number and the new source.
 */
import { notImplemented } from "@conducted/shared";
import type { ToolCardProps } from "../tool-card-props.ts";

export function NotebookEditCard(_props: ToolCardProps): never {
	return notImplemented("CHAT-08");
}
