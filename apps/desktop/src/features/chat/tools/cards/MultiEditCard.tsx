/**
 * @feature CHAT-08 Multi-edit card
 * Owns: The card for several edits to one file in one call.
 * Behaviour: frontend.md 5 (registry key 'multi-edit').
 * Must handle: One failed edit among many (which one failed is named); a long list (collapsed after
 * the first three); the edits apply in order and the card shows them in order.
 * Test first: Three edits render three diff parts in call order.
 */
import {
	arrayField,
	asRecord,
	boolField,
	DiffLines,
	FileBadge,
	ToolCardFrame,
	textField,
	toolStatus,
	withKeys,
} from "../ToolCardFrame.tsx";
import type { ToolCardProps } from "../tool-card-props.ts";

export function MultiEditCard({ call, defaultExpanded }: ToolCardProps) {
	const input = asRecord(call.item.input);
	const path = textField(input, "file_path", "path") ?? "";
	const edits = arrayField(input, "edits");
	const clear = call.result?.isError !== true;
	return (
		<ToolCardFrame
			title={edits.length > 0 ? `Multi-edit (${edits.length} edits)` : "Multi-edit"}
			summary={<FileBadge path={path} />}
			keepSummary
			status={toolStatus(call)}
			expandAll={defaultExpanded}
			body={
				edits.length === 0 ? (
					<p className="text-xs text-fg-subtle">No edits</p>
				) : (
					<div className="flex flex-col gap-2">
						{withKeys(
							edits,
							(edit) => {
								const record = asRecord(edit);
								return `${textField(record, "old_string") ?? ""}-${textField(record, "new_string") ?? ""}`;
							},
							"edit",
						).map(({ key, item: edit }, position) => {
							const record = asRecord(edit);
							return (
								<div key={key} className="flex flex-col gap-1">
									<span className="text-xs font-medium text-fg-subtle">
										Edit {position + 1}
										{boolField(record, "replace_all") ? " (replace all)" : ""}
									</span>
									<DiffLines
										removed={textField(record, "old_string", "oldText") ?? ""}
										added={textField(record, "new_string", "newText") ?? ""}
									/>
								</div>
							);
						})}
					</div>
				)
			}
			footer={clear ? undefined : "Not every edit was applied."}
		/>
	);
}
