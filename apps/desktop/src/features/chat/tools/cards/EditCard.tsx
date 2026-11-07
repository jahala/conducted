/**
 * @feature CHAT-08 Edit card
 * Owns: The card for one text replacement in a file: path and a small diff of old and new text.
 * Behaviour: ui-map.md 3.3 (Edit: 'Open in editor', diff body; a note when the agent retries an
 * edit because of a permissions bug). Conductor shows the note only when the failure is Claude
 * Code's "File has not been read yet" answer (renderApp @8750078).
 * Must handle: Replace-all edits; an edit that failed because the old text was not found (error in
 * the frame); an edit that was denied; very long lines scroll sideways.
 * Test first: An edit call renders removed and added lines with their markers.
 */
import {
	asRecord,
	boolField,
	DiffLines,
	FileBadge,
	FileLink,
	LineCounts,
	ToolCardFrame,
	textField,
	textLines,
	toolStatus,
} from "../ToolCardFrame.tsx";
import type { ToolCardProps } from "../tool-card-props.ts";

const RETRY_NOTE =
	"Claude Code has to retry the file edit because of a bug in its permissions logic. Just a moment!";

/** Claude Code's answer when it refuses an edit to a file it has not read in this chat. */
const NOT_READ_YET = "File has not been read yet. Read it first before writing to it.";

export function EditCard({ call, defaultExpanded }: ToolCardProps) {
	const input = asRecord(call.item.input);
	const path = textField(input, "file_path", "path") ?? "";
	const oldText = textField(input, "old_string", "oldText") ?? "";
	const newText = textField(input, "new_string", "newText") ?? "";
	const replaceAll = boolField(input, "replace_all");
	const mustRetry = call.result?.isError === true && call.result.output.includes(NOT_READ_YET);
	return (
		<ToolCardFrame
			title={replaceAll ? "Edit (replace all)" : "Edit"}
			summary={
				<span className="flex items-center gap-2">
					<FileBadge path={path} />
					<LineCounts added={textLines(newText).length} removed={textLines(oldText).length} />
				</span>
			}
			keepSummary
			status={toolStatus(call)}
			expandAll={defaultExpanded}
			body={
				<div className="flex flex-col gap-2">
					<DiffLines removed={oldText} added={newText} />
					{mustRetry ? <p className="text-xs text-fg-subtle">{RETRY_NOTE}</p> : null}
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
