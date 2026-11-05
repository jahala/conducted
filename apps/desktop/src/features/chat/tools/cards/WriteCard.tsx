/**
 * @feature CHAT-08 Write card
 * Owns: The card for a file write: path and the new content as an added-lines diff.
 * Behaviour: ui-map.md 3.3 (Edit and Write: 'Open in editor', 'Edit', diff body).
 * Must handle: New file versus overwrite; huge content (first lines plus 'Show all'); a write that
 * was denied or failed; 'Open in editor' opens the file tab in edit mode.
 * Test first: A write call renders the path and its content lines; 'Open in editor' sets
 * fileMode=edit.
 */
import { useState } from "react";
import {
	asRecord,
	DiffLines,
	FileLink,
	ToolCardFrame,
	textField,
	textLines,
	toolStatus,
} from "../ToolCardFrame.tsx";
import type { ToolCardProps } from "../tool-card-props.ts";

const MAX_LINES = 60;

export function WriteCard({ call, defaultExpanded }: ToolCardProps) {
	const [showAll, setShowAll] = useState(false);
	const input = asRecord(call.item.input);
	const path = textField(input, "file_path", "path") ?? "";
	const content = textField(input, "content", "file_text") ?? "";
	const lines = textLines(content);
	const shown = showAll ? lines : lines.slice(0, MAX_LINES);
	return (
		<ToolCardFrame
			title="Write"
			summary={path}
			status={toolStatus(call)}
			expandAll={defaultExpanded}
			body={
				<div className="flex flex-col gap-2">
					<DiffLines removed="" added={shown.join("\n")} />
					{lines.length > MAX_LINES && !showAll ? (
						<button
							type="button"
							onClick={() => setShowAll(true)}
							className="self-start text-xs font-medium text-link hover:underline"
						>
							Show all {lines.length} lines
						</button>
					) : null}
				</div>
			}
			footer={
				<div className="flex items-center gap-3">
					<FileLink path={path} mode="edit">
						Open in editor
					</FileLink>
					<FileLink path={path} mode="diff">
						Edit
					</FileLink>
				</div>
			}
		/>
	);
}
