/**
 * @feature REV-03 Gutter comment button
 * Owns: the small "add a comment" button that appears in the diff gutter beside the hovered line.
 * Behaviour: ui-map.md 3.6 (inline comment box). Renderer reference: `renderGutterUtility` of the
 * diff components in "@pierre/diffs/react" gives a function that returns the hovered line
 * ({ lineNumber, side }).
 * Must handle: no hovered line (renders nothing), a drag across lines selecting a range, the
 * button not stealing the click that selects text, and keyboard access (a focusable control in the
 * line's row).
 * Test first: hovering additions line 5 and clicking calls onAdd with side "additions", line 5.
 */
import { notImplemented } from "@conducted/shared";
import type { DiffSide } from "./diff-types.ts";

export interface GutterCommentButtonProps {
	getHoveredLine: () => { lineNumber: number; side: DiffSide } | undefined;
	onAdd: (line: { lineNumber: number; side: DiffSide }) => void;
}

export function GutterCommentButton(_props: GutterCommentButtonProps): never {
	return notImplemented("REV-03");
}
