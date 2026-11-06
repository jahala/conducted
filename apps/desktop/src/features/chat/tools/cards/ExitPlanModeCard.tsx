/**
 * @feature CHAT-12 Propose plan card
 * Owns: The card in the history for the plan the agent proposed, with its text and what the user
 * decided.
 * Behaviour: ui-map.md 3.3 ('Propose plan', and the plan right-click menu 'Copy plan'), ui-map.md
 * 5.3 (ContextMenu), claude-runner.md 3.5.
 * Our design choice: The footer reads the tool result: no result yet waits for the review, an
 * error result is a rejection and shows the feedback the agent received, and any other result is
 * an approval. A long plan shows the first lines with 'Show all'.
 * Must handle: Plan not yet decided (the PlanReviewBar in the dock is live); approved; rejected
 * with feedback; a long plan collapses; a plan with no text.
 * Test first: A proposed plan renders its text; after approval the footer says Approved.
 */
import { useState } from "react";
import { useActions } from "../../../../core/hooks.ts";
import { ContextMenu, ContextMenuItem } from "../../../../ui/ContextMenu.tsx";
import { reportFailure } from "../../report-failure.ts";
import { asRecord, ToolCardFrame, textField, textLines, toolStatus } from "../ToolCardFrame.tsx";
import type { ToolCardProps } from "../tool-card-props.ts";

/** How many plan lines show before 'Show all'. */
const COLLAPSED_LINES = 40;

export function ExitPlanModeCard({ call, defaultExpanded }: ToolCardProps) {
	const actions = useActions();
	const [showAll, setShowAll] = useState(false);
	const input = asRecord(call.item.input);
	const plan = textField(input, "plan") ?? "";
	const lines = textLines(plan);
	const shown = showAll ? plan : lines.slice(0, COLLAPSED_LINES).join("\n");
	const hasMore = lines.length > COLLAPSED_LINES;
	const result = call.result;
	const decision =
		result === null
			? "Waiting for you to review the plan"
			: result.isError
				? "Rejected"
				: "Approved";
	const feedback = result?.isError === true ? result.output.trim() : "";

	function copy(): void {
		void reportFailure(actions.app.copyText(plan), "Couldn't copy the plan");
	}

	return (
		<ContextMenu items={<ContextMenuItem onSelect={copy}>Copy plan</ContextMenuItem>}>
			<div>
				<ToolCardFrame
					title="Propose plan"
					status={toolStatus(call)}
					expandAll={defaultExpanded}
					body={
						plan.length === 0 ? (
							<p className="text-xs text-fg-muted">The agent did not include the plan text.</p>
						) : (
							<div className="flex flex-col gap-2">
								<pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-canvas p-2 font-mono text-code text-fg">
									{shown}
								</pre>
								{hasMore ? (
									<button
										type="button"
										onClick={() => setShowAll(!showAll)}
										className="self-start text-xs font-medium text-link hover:underline"
									>
										{showAll ? "Show less" : `Show all ${lines.length} lines`}
									</button>
								) : null}
								{feedback.length === 0 ? null : (
									<p className="whitespace-pre-wrap text-xs text-fg-muted">{feedback}</p>
								)}
							</div>
						)
					}
					footer={decision}
				/>
			</div>
		</ContextMenu>
	);
}
