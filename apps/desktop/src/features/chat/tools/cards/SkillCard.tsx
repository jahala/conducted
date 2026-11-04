/**
 * @feature CHAT-08 Skill card
 * Owns: The card for the agent activating a skill.
 * Behaviour: ui-map.md 3.3 ('Skill activated').
 * Must handle: Skill name only; the skill failed to load (error in the frame).
 * Test first: A skill call renders 'Skill activated' and the skill name.
 */
import { notImplemented } from "@conducted/shared";
import type { ToolCardProps } from "../tool-card-props.ts";

export function SkillCard(_props: ToolCardProps): never {
	return notImplemented("CHAT-08");
}
