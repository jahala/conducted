/**
 * @feature CHAT-08 MCP tool card
 * Owns: The card for a tool from an MCP server: server name, tool name, input and output.
 * Behaviour: frontend.md 5 (context7-mcp, linear-mcp and similar kinds), ui-map.md 3.3.
 * Must handle: Raw name shaped 'mcp__server__tool' (split for the title); input and output as
 * formatted JSON with a Raw toggle; very large output (cut); an error result.
 * Test first: A call named mcp__linear__get_issue renders 'linear' and 'get_issue'.
 */
import { useState } from "react";
import { formatJson, ToolCardFrame, ToolOutput, toolStatus } from "../ToolCardFrame.tsx";
import type { ToolCardProps } from "../tool-card-props.ts";

function splitName(rawName: string): { server: string; tool: string } {
	const parts = rawName.split("__");
	if (parts.length >= 3 && parts[0] === "mcp") {
		return { server: parts[1] ?? rawName, tool: parts.slice(2).join("__") };
	}
	return { server: rawName, tool: "" };
}

export function McpCard({ call, defaultExpanded }: ToolCardProps) {
	const [raw, setRaw] = useState(false);
	const { server, tool } = splitName(call.item.rawName);
	const output = call.result?.output ?? "";
	return (
		<ToolCardFrame
			title={server}
			summary={tool}
			status={toolStatus(call)}
			expandAll={defaultExpanded}
			body={
				<div className="flex flex-col gap-2">
					<pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-sm bg-surface p-2 font-mono text-xs text-fg-muted">
						{raw
							? formatJson(call.item.input)
							: (JSON.stringify(call.item.input) ?? String(call.item.input))}
					</pre>
					{output.length > 0 ? <ToolOutput>{output}</ToolOutput> : null}
				</div>
			}
			footer={
				<button
					type="button"
					onClick={() => setRaw(!raw)}
					className="text-xs font-medium text-fg-muted hover:text-fg"
				>
					{raw ? "Formatted" : "Raw"}
				</button>
			}
		/>
	);
}
