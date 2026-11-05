/**
 * @feature CHAT-08 Glob card
 * Owns: The card for a file-name search: the pattern and the matching paths.
 * Behaviour: ui-map.md 3.3 (Glob), frontend.md 5.
 * Must handle: No matches ('No files found'); more than 50 matches (first 50 and 'and N more');
 * each path opens the file tab.
 * Test first: A glob call with three results lists three paths.
 */
import {
	asRecord,
	FileLink,
	ToolCardFrame,
	textField,
	textLines,
	toolStatus,
} from "../ToolCardFrame.tsx";
import type { ToolCardProps } from "../tool-card-props.ts";

const MAX_PATHS = 50;

export function GlobCard({ call, defaultExpanded }: ToolCardProps) {
	const input = asRecord(call.item.input);
	const pattern = textField(input, "pattern", "query") ?? "";
	const paths = textLines(call.result?.output ?? "");
	const shown = paths.slice(0, MAX_PATHS);
	return (
		<ToolCardFrame
			title="Glob"
			summary={pattern}
			status={toolStatus(call)}
			expandAll={defaultExpanded}
			body={
				shown.length === 0 ? (
					<p className="text-xs text-fg-subtle">No files found</p>
				) : (
					<div className="flex flex-col items-start gap-0.5">
						{shown.map((path) => (
							<FileLink key={path} path={path} />
						))}
						{paths.length > shown.length ? (
							<span className="text-xs text-fg-subtle">and {paths.length - shown.length} more</span>
						) : null}
					</div>
				)
			}
		/>
	);
}
