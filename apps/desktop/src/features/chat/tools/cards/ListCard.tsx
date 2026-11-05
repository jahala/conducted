/**
 * @feature CHAT-08 List card
 * Owns: The card for a directory listing.
 * Behaviour: ui-map.md 3.3 ('List files'), frontend.md 5 (registry key 'ls').
 * Must handle: Empty directory; a long listing (first 50); directories are marked with a trailing
 * slash and a different weight, not a colour.
 * Test first: A list call renders the directory path and its entries.
 */
import {
	asRecord,
	ToolCardFrame,
	textField,
	textLines,
	toolStatus,
	withKeys,
} from "../ToolCardFrame.tsx";
import type { ToolCardProps } from "../tool-card-props.ts";

export function ListCard({ call, defaultExpanded }: ToolCardProps) {
	const input = asRecord(call.item.input);
	const path = textField(input, "path", "directory", "dir") ?? "";
	const entries = textLines(call.result?.output ?? "");
	const shown = entries.slice(0, 50);
	return (
		<ToolCardFrame
			title="List files"
			summary={path}
			status={toolStatus(call)}
			expandAll={defaultExpanded}
			body={
				shown.length === 0 ? (
					<p className="text-xs text-fg-subtle">Empty folder</p>
				) : (
					<div className="flex flex-col gap-0.5">
						{withKeys(shown, (entry) => entry, "entry").map(({ key, item: entry }) => (
							<span
								key={key}
								className={
									entry.endsWith("/")
										? "font-mono text-xs font-medium text-fg"
										: "font-mono text-xs text-fg-muted"
								}
							>
								{entry}
							</span>
						))}
						{entries.length > shown.length ? (
							<span className="text-xs text-fg-subtle">
								and {entries.length - shown.length} more
							</span>
						) : null}
					</div>
				)
			}
		/>
	);
}
