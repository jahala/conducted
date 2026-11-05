/**
 * @feature CHAT-09 Thinking block
 * Owns: The collapsible 'Thinking' card that shows the agent's reasoning.
 * Behaviour: ui-map.md 3.3 (Thinking: collapsible 'Thinking' card), frontend.md 5.
 * Our design choice: Collapsed by default. When the agent sent only a summary (`summarized`),
 * the card says so.
 * Must handle: Empty thinking text (renders nothing); very long text scrolls inside the card;
 * summarised text is labelled.
 * Test first: A finished turn's thinking block is collapsed; clicking the header shows the text.
 */
import { useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../ui/Collapsible.tsx";
import { ChevronDownIcon, ChevronRightIcon } from "../../ui/icons.tsx";

export interface ThinkingBlockProps {
	text: string;
	summarized: boolean;
}

export function ThinkingBlock({ text, summarized }: ThinkingBlockProps) {
	const [open, setOpen] = useState(false);
	if (text.length === 0) {
		return null;
	}
	return (
		<div className="rounded-lg border border-border bg-surface">
			<Collapsible open={open} onOpenChange={setOpen}>
				<CollapsibleTrigger className="flex h-9 w-full items-center gap-2 rounded-lg px-3 text-left">
					{open ? <ChevronDownIcon /> : <ChevronRightIcon />}
					<span className="text-sm font-medium text-fg">Thinking</span>
					{summarized ? <span className="text-xs text-fg-subtle">Summary</span> : null}
				</CollapsibleTrigger>
				<CollapsibleContent>
					<div className="max-h-64 overflow-auto border-t border-border p-3">
						<p className="whitespace-pre-wrap break-words text-sm text-fg-muted">{text}</p>
					</div>
				</CollapsibleContent>
			</Collapsible>
		</div>
	);
}
