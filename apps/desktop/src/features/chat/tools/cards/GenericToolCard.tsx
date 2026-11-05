/**
 * @feature CHAT-08 Generic tool card
 * Owns: The fallback card for any tool without its own card: the agent's own tool name, the input
 * and the output.
 * Behaviour: ui-map.md 3.3 ('Unknown tools fall back to a generic card'), frontend.md 5.
 * Must handle: Input that is not an object; output that is empty; a very large input (cut); the raw
 * name is always shown so the user knows what ran.
 * Test first: A call with tool 'unknown' and raw name 'FooTool' renders 'FooTool' and its input as
 * JSON.
 */
import { formatJson, ToolCardFrame, toolStatus } from "../ToolCardFrame.tsx";
import type { ToolCardProps } from "../tool-card-props.ts";

export function GenericToolCard({ call, defaultExpanded }: ToolCardProps) {
	const output = call.result?.output ?? "";
	return (
		<ToolCardFrame
			title={call.item.rawName}
			status={toolStatus(call)}
			expandAll={defaultExpanded}
			body={
				<div className="flex flex-col gap-2">
					<pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-sm bg-surface p-2 font-mono text-xs text-fg-muted">
						{formatJson(call.item.input)}
					</pre>
					{output.length > 0 ? (
						<pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono text-xs text-fg">
							{output}
						</pre>
					) : null}
				</div>
			}
		/>
	);
}
