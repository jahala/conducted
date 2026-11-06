/**
 * @feature CHAT-20 Search tools card
 * Owns: The card for the agent searching for tools to load.
 * Behaviour: ui-map.md 3.3 ('Search tools').
 * Must handle: No tools found; many tools found (the result scrolls); a search that returned no
 * text.
 * Test first: A tool_search call renders 'Search tools' and the query.
 */
import {
	asRecord,
	ToolCardFrame,
	ToolOutput,
	textField,
	textLines,
	toolStatus,
} from "../ToolCardFrame.tsx";
import type { ToolCardProps } from "../tool-card-props.ts";

export function ToolSearchCard({ call, defaultExpanded }: ToolCardProps) {
	const input = asRecord(call.item.input);
	const query = textField(input, "query", "search", "q");
	const output = call.result?.output ?? "";
	const found = textLines(output);
	return (
		<ToolCardFrame
			title="Search tools"
			summary={query ?? undefined}
			status={toolStatus(call)}
			expandAll={defaultExpanded}
			body={
				call.result === null ? (
					<p className="text-xs text-fg-subtle">Searching for tools.</p>
				) : found.length === 0 ? (
					<p className="text-xs text-fg-subtle">No tools found</p>
				) : (
					<ToolOutput>{output}</ToolOutput>
				)
			}
		/>
	);
}
