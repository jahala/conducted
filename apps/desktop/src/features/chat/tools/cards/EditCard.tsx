/**
 * @feature CHAT-08 Edit card
 * Owns: The card for one text replacement in a file: path and a small diff of old and new text.
 * Behaviour: ui-map.md 3.3 (Edit: 'Open in editor', diff body; a note when the agent retries an
 * edit because of a permissions bug).
 * Must handle: Replace-all edits; an edit that failed because the old text was not found (error in
 * the frame); an edit that was denied; very long lines scroll sideways.
 * Test first: An edit call renders removed and added lines with their markers.
 */
import {
	asRecord,
	boolField,
	DiffLines,
	FileLink,
	ToolCardFrame,
	textField,
	toolStatus,
} from "../ToolCardFrame.tsx";
import type { ToolCardProps } from "../tool-card-props.ts";

const RETRY_NOTE =
	"Claude Code has to retry the file edit because of a bug in its permissions logic. Just a moment!";

export function EditCard({ call, defaultExpanded }: ToolCardProps) {
	const input = asRecord(call.item.input);
	const path = textField(input, "file_path", "path") ?? "";
	const oldText = textField(input, "old_string", "oldText") ?? "";
	const newText = textField(input, "new_string", "newText") ?? "";
	const replaceAll = boolField(input, "replace_all");
	const failed = call.result?.isError === true;
	return (
		<ToolCardFrame
			title="Edit"
			summary={`${path}${replaceAll ? " · replace all" : ""}`}
			status={toolStatus(call)}
			expandAll={defaultExpanded}
			body={
				<div className="flex flex-col gap-2">
					<DiffLines removed={oldText} added={newText} />
					{failed ? <p className="text-xs text-fg-subtle">{RETRY_NOTE}</p> : null}
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
