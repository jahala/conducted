/**
 * @feature CHAT-08 Sub-agent card
 * Owns: The card for a task the agent handed to a sub-agent: its description, its own tool calls
 * grouped inside, and its final answer.
 * Behaviour: frontend.md 5 (sub-agent messages are bucketed under their parent Task call),
 * ui-map.md 3.3 ('Subagent').
 * Must handle: Many nested calls (a count above the list; the card itself collapses); a running
 * sub-agent (the count grows); a sub-agent that failed; a nested sub-agent; the children render through the
 * same registry, each in its own error boundary, so every kind of card works inside and one broken card
 * does not hide its siblings.
 * Test first: A call with two children shows 'Subagent', the description, and two nested cards.
 */
import { toolCardFor } from "../registry.ts";
import { ToolCardBoundary } from "../ToolCard.tsx";
import { ToolCardFrame, textField, toolStatus } from "../ToolCardFrame.tsx";
import type { ToolCardProps } from "../tool-card-props.ts";

export function SubAgentCard({ call, sessionId, defaultExpanded }: ToolCardProps) {
	const input = call.item.input;
	const description = textField(input, "description", "prompt", "task") ?? "Sub-agent task";
	const count = call.children.length;
	const answer = call.result?.output ?? "";
	return (
		<ToolCardFrame
			title="Subagent"
			summary={description}
			status={toolStatus(call)}
			expandAll={defaultExpanded}
			body={
				<div className="flex flex-col gap-2">
					<p className="text-xs text-fg-subtle">
						{count} {count === 1 ? "tool call" : "tool calls"}
					</p>
					{call.children.map((child) => {
						const Card = toolCardFor(child.item.tool);
						return (
							<ToolCardBoundary key={child.toolUseId} call={child}>
								<Card call={child} sessionId={sessionId} defaultExpanded={defaultExpanded} />
							</ToolCardBoundary>
						);
					})}
					{answer.length > 0 ? (
						<pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono text-xs text-fg">
							{answer}
						</pre>
					) : null}
				</div>
			}
		/>
	);
}
