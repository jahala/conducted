/**
 * @feature CHAT-20 Swarm card
 * Owns: The card for Claude's Teammate tool, which starts or cleans up a team of agents (a "swarm").
 * Behaviour: renderApp @8823423 (VYo): "Spawn swarm" for the spawnTeam operation, else "Clean up
 * swarm", with the team's name beside it; a spawn that says what the team is for and which agent
 * leads it opens to "Purpose: " and "Lead type: ", each label beside its value.
 * Must handle: a cleanup (no details to open); a spawn without a purpose or a lead type (only
 * what it has, and nothing to open when it has neither); a call that names no team.
 * Test first: a team spawn shows Spawn swarm, the team, its Purpose and its Lead type.
 */
import { asRecord, ToolCardFrame, textField, toolStatus } from "../ToolCardFrame.tsx";
import type { ToolCardProps } from "../tool-card-props.ts";

export function TeammateCard({ call, defaultExpanded }: ToolCardProps) {
	const input = asRecord(call.item.input);
	const spawn = textField(input, "operation") === "spawnTeam";
	const team = textField(input, "team_name");
	const purpose = textField(input, "description");
	const lead = textField(input, "agent_type");
	const details = spawn && (purpose !== null || lead !== null);
	return (
		<ToolCardFrame
			title={spawn ? "Spawn swarm" : "Clean up swarm"}
			summary={team ?? undefined}
			status={toolStatus(call)}
			expandAll={defaultExpanded}
			body={
				details ? (
					<div className="flex flex-col gap-1.5 text-xs">
						{purpose === null ? null : (
							<p className="flex gap-1">
								<span className="shrink-0 text-fg-muted">Purpose:</span>
								<span className="font-medium text-fg">{purpose}</span>
							</p>
						)}
						{lead === null ? null : (
							<p className="flex gap-1">
								<span className="shrink-0 text-fg-muted">Lead type:</span>
								<span className="font-mono font-medium text-fg">{lead}</span>
							</p>
						)}
					</div>
				) : undefined
			}
		/>
	);
}
