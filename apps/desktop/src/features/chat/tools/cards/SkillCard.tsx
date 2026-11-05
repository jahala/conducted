/**
 * @feature CHAT-08 Skill card
 * Owns: The card for the agent activating a skill.
 * Behaviour: ui-map.md 3.3 ('Skill activated').
 * Must handle: Skill name only; the skill failed to load (error in the frame).
 * Test first: A skill call renders 'Skill activated' and the skill name.
 */
import { asRecord, ToolCardFrame, textField, toolStatus } from "../ToolCardFrame.tsx";
import type { ToolCardProps } from "../tool-card-props.ts";

export function SkillCard({ call, defaultExpanded }: ToolCardProps) {
	const input = asRecord(call.item.input);
	const name = textField(input, "skill", "name", "command") ?? call.item.rawName;
	const output = call.result?.output ?? "";
	return (
		<ToolCardFrame
			title="Skill activated"
			summary={name}
			status={toolStatus(call)}
			expandAll={defaultExpanded}
			body={
				output.length > 0 ? (
					<pre className="overflow-x-auto whitespace-pre-wrap font-mono text-xs text-fg-muted">
						{output}
					</pre>
				) : null
			}
		/>
	);
}
