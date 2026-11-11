/**
 * @feature CHAT-08 Sub-agent card
 * Owns: The card for a task the agent handed to a sub-agent: its description, everything the
 * sub-agent showed inside it (its text, thinking, todo list and tool calls, in order), and its
 * final answer.
 * Behaviour: frontend.md 5 (a sub-agent's messages are bucketed under the parent Task call),
 * ui-map.md 3.3 ('Subagent'; its prompt under a 'Prompt' label, renderApp @9502437).
 * Must handle: a prompt the agent handed over ('Prompt' opens it); many nested blocks (a count
 * above the list; the card itself collapses); a running sub-agent (the count grows); a background
 * sub-agent whose work arrives in later turns (the turn builder puts it in this card, D129); a
 * sub-agent that failed; a nested sub-agent; the blocks render
 * through the same views as a turn, each in its own error boundary, so every kind works inside
 * and one broken card does not hide its siblings.
 * Test first: A call with two child tool calls shows 'Subagent', the description, and two nested cards.
 */
import { useState } from "react";
import { ChatBlockView } from "../../ChatBlockView.tsx";
import { ToolCardFrame, ToolOutput, textField, toolStatus } from "../ToolCardFrame.tsx";
import type { ToolCardProps } from "../tool-card-props.ts";

export function SubAgentCard({ call, sessionId, defaultExpanded }: ToolCardProps) {
	const input = call.item.input;
	const description = textField(input, "description", "prompt", "task") ?? "Sub-agent task";
	const prompt = textField(input, "prompt");
	const count = call.blocks.filter((block) => block.kind === "tool").length;
	const answer = call.result?.output ?? "";
	const [showPrompt, setShowPrompt] = useState(false);
	return (
		<ToolCardFrame
			title="Subagent"
			summary={description}
			status={toolStatus(call)}
			expandAll={defaultExpanded}
			body={
				<div className="flex flex-col gap-2">
					{prompt === null ? null : (
						<div>
							<button
								type="button"
								onClick={() => setShowPrompt((shown) => !shown)}
								className="inline-flex items-center gap-2 py-1 text-sm text-fg-muted hover:text-fg"
							>
								Prompt
							</button>
							{showPrompt ? (
								<pre className="mt-2 whitespace-pre-wrap break-words rounded-md border border-border bg-accent p-3 font-mono text-xs text-accent-fg">
									{prompt}
								</pre>
							) : null}
						</div>
					)}
					<p className="text-xs text-fg-subtle">
						{count} {count === 1 ? "tool call" : "tool calls"}
					</p>
					{call.blocks.map((block, index) => (
						<ChatBlockView
							// Blocks of another kind carry no id; the list only grows at its end.
							key={block.kind === "tool" ? block.call.toolUseId : `${block.kind}-${index}`}
							block={block}
							sessionId={sessionId}
						/>
					))}
					{answer.length > 0 ? <ToolOutput>{answer}</ToolOutput> : null}
				</div>
			}
		/>
	);
}
