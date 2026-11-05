/**
 * @feature REV-03 Gutter comment button
 * Owns: the small "add a comment" button that appears in the diff gutter beside the hovered line.
 * Behaviour: ui-map.md 3.6 (inline comment box). Renderer reference: `renderGutterUtility` of the
 * diff components in "@pierre/diffs/react" gives a function that returns the hovered line
 * ({ lineNumber, side }).
 * Must handle: no hovered line (renders nothing), the button not stealing the click that selects
 * text, and keyboard access (a focusable control in the line's row).
 * Test first: hovering additions line 5 and clicking calls onAdd with side "additions", line 5.
 */

import { IconButton } from "../../ui/IconButton.tsx";
import { ChatIcon } from "../../ui/icons.tsx";
import type { DiffSide } from "./diff-types.ts";

export interface GutterCommentButtonProps {
	getHoveredLine: () => { lineNumber: number; side: DiffSide } | undefined;
	onAdd: (line: { lineNumber: number; side: DiffSide }) => void;
}

export function GutterCommentButton({ getHoveredLine, onAdd }: GutterCommentButtonProps) {
	const line = getHoveredLine();
	if (line === undefined) return null;
	return (
		<IconButton
			size="xs"
			label="Add a comment for the AI"
			icon={<ChatIcon />}
			onMouseDown={(event) => {
				event.preventDefault();
			}}
			onClick={() => {
				const hovered = getHoveredLine();
				if (hovered !== undefined) onAdd(hovered);
			}}
		/>
	);
}
