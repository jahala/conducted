/**
 * @feature CHAT-09 Thinking block
 * Owns: the "Thinking" row that shows the agent's reasoning.
 * Behaviour: ui-map.md 3.3 (Thinking: collapsible), frontend.md 5; measured from Conductor 0.92.1
 * (renderApp @8798768): the same quiet row as a tool call, with a brain icon, the word "Thinking" and the
 * reasoning's start in a sans-serif chip; opened, the reasoning shows as muted text under the row.
 * Our design choice: when the agent sent only a summary (`summarized`), the row says so.
 * Must handle: empty thinking text (renders nothing); very long text scrolls; summarised text is labelled.
 * Test first: a finished turn's thinking row is collapsed; clicking it shows the full text.
 */
import { SummaryChip, ToolCardFrame } from "./tools/ToolCardFrame.tsx";
import { ThinkingIcon } from "./tools/tool-icons.tsx";

export interface ThinkingBlockProps {
	text: string;
	summarized: boolean;
}

export function ThinkingBlock({ text, summarized }: ThinkingBlockProps) {
	const trimmed = text.trim();
	if (trimmed.length === 0) {
		return null;
	}
	return (
		<ToolCardFrame
			title={summarized ? "Thinking (summary)" : "Thinking"}
			icon={<ThinkingIcon className="size-3" />}
			status="done"
			summary={<SummaryChip sans>{trimmed}</SummaryChip>}
			plainBody
			body={
				<div data-region="thinking" className="max-h-96 overflow-auto">
					<p className="whitespace-pre-wrap break-words text-sm text-fg-muted">{trimmed}</p>
				</div>
			}
		/>
	);
}
