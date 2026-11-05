/**
 * @feature CHAT-08 Notebook edit card
 * Owns: The card for an edit to a Jupyter notebook cell.
 * Behaviour: other-runners.md 3 (canonical notebook_edit tool).
 * Must handle: Insert, replace and delete modes; cell index and cell type shown; a notebook that is
 * not valid JSON (error from the agent shown as is).
 * Test first: A replace call shows the cell number and the new source.
 */
import { asRecord, ToolCardFrame, textField, toolStatus } from "../ToolCardFrame.tsx";
import type { ToolCardProps } from "../tool-card-props.ts";

const MODES: Record<string, string> = {
	replace: "Replace cell",
	insert: "Insert cell",
	delete: "Delete cell",
};

export function NotebookEditCard({ call, defaultExpanded }: ToolCardProps) {
	const input = asRecord(call.item.input);
	const path = textField(input, "notebook_path", "path") ?? "";
	const cell = textField(input, "cell_number", "cell_id", "cell_index") ?? "";
	const mode = textField(input, "edit_mode", "mode") ?? "replace";
	const source = textField(input, "new_source", "source") ?? "";
	const label = MODES[mode] ?? mode;
	return (
		<ToolCardFrame
			title="Notebook edit"
			summary={cell.length > 0 ? `${path} · ${label} ${cell}` : `${path} · ${label}`}
			status={toolStatus(call)}
			expandAll={defaultExpanded}
			body={
				mode === "delete" ? (
					<p className="text-xs text-fg-subtle">Cell {cell} was removed.</p>
				) : (
					<div className="flex flex-col gap-1">
						<span className="text-xs font-medium text-fg-subtle">
							{label} {cell}
						</span>
						<pre className="overflow-auto whitespace-pre rounded-sm bg-surface p-2 font-mono text-xs text-fg">
							{source}
						</pre>
					</div>
				)
			}
		/>
	);
}
