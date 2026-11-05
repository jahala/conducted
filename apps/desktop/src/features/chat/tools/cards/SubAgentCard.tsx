/**
 * @feature CHAT-08 Sub-agent card
 * Owns: The card for a task the agent handed to a sub-agent: its description, its own tool calls
 * grouped inside, and its final answer.
 * Behaviour: frontend.md 5 (sub-agent messages are bucketed under their parent Task call),
 * ui-map.md 3.3 ('Subagent').
 * Must handle: Many nested calls (collapsed to a count, expandable); a running sub-agent (live
 * count); a sub-agent that failed; a nested sub-agent; the children render through the same
 * registry so every kind of card works inside.
 * Test first: A call with two children shows 'Subagent', the description, and two nested cards.
 */
import { NotBuiltYet } from "../../../../ui/not-built-yet.tsx";
import { toolCardFor } from "../registry.ts";
import { ToolCardFrame, textField, toolStatus } from "../ToolCardFrame.tsx";
import type { ToolCardProps } from "../tool-card-props.ts";

export function SubAgentCard({ call, sessionId, defaultExpanded }: ToolCardProps) {
	const input = call.item.input;
	const description = textField(input, "description", "prompt", "task") ?? "Sub-agent task";
	const count = call.children.length;
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
							<NotBuiltYet
								key={child.toolUseId}
								area={`Tool: ${child.item.rawName}`}
								variant="inline"
								resetKey={child.toolUseId}
							>
								<Card call={child} sessionId={sessionId} defaultExpanded={defaultExpanded} />
							</NotBuiltYet>
						);
					})}
				</div>
			}
		/>
	);
}
