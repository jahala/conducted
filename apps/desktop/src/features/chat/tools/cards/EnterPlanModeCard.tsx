/**
 * @feature CHAT-12 Enter plan mode card
 * Owns: The card that marks the moment the agent switched to plan mode.
 * Behaviour: ui-map.md 3.3 ('Enter plan mode'), frontend.md 5 (enterPlanModeNotification records
 * permission_mode plan).
 * Must handle: The switch was refused (error in the frame); shown once per switch.
 * Test first: An enter_plan_mode call renders the title 'Enter plan mode'.
 */
import { notImplemented } from "@conducted/shared";
import type { ToolCardProps } from "../tool-card-props.ts";

export function EnterPlanModeCard(_props: ToolCardProps): never {
	return notImplemented("CHAT-12");
}
