/**
 * @feature CHAT-06 Folded run of tool calls
 * Owns: the one quiet row a finished turn shows in place of a run of tool calls and messages ("› 6 tool
 * calls, 4 messages" with the tools' icons), and the run itself once the row is opened.
 * Behaviour: measured from Conductor 0.92.1 (renderApp @9592138): a full-width button in muted text that
 * turns to the body colour on hover; a 12px chevron (right when closed, down when open) with 4px after it;
 * the label in text-sm with 2px before it, then the run's tool icons 4px apart, 8px after the label. Closed
 * by default, open by default when the run generated an image.
 * Must handle: a run with only messages (no icons); opening and closing keeps the blocks' own state; the
 * button names what it does for screen readers ("Expand 6 tool calls, 4 messages").
 * Test first: clicking the row shows the folded blocks and sets aria-expanded.
 */
import { type ReactNode, useState } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "../../ui/icons.tsx";
import { type FoldSummary, summaryLabel } from "./fold-turn.ts";
import { SubAgentIcon, TOOL_ICONS } from "./tools/tool-icons.tsx";

export function FoldedRun({ summary, children }: { summary: FoldSummary; children: ReactNode }) {
	const [open, setOpen] = useState(summary.tools.includes("image_generation"));
	const label = summaryLabel(summary);
	return (
		<>
			<button
				type="button"
				aria-expanded={open}
				aria-label={`${open ? "Collapse" : "Expand"} ${label}`}
				onClick={() => setOpen(!open)}
				className="group flex w-full items-center text-fg-muted hover:text-fg"
			>
				{open ? (
					<ChevronDownIcon className="mr-1 size-3" />
				) : (
					<ChevronRightIcon className="mr-1 size-3" />
				)}
				<span className="flex items-center gap-2">
					<span className="ml-0.5 text-sm">{label}</span>
					{summary.tools.length > 0 ? (
						<span className="flex items-center gap-1">
							{summary.tools.map((tool) => {
								const Icon = tool === "sub_agent" ? SubAgentIcon : TOOL_ICONS[tool];
								return <Icon key={tool} className="size-3 text-fg-muted group-hover:text-fg" />;
							})}
						</span>
					) : null}
				</span>
			</button>
			{open ? children : null}
		</>
	);
}
