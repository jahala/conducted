/**
 * @feature CHAT-20 Schedule wake-up card
 * Owns: The card for the agent asking to be woken up later.
 * Behaviour: ui-map.md 3.3 (schedule wakeup).
 * Must handle: A wake-up time in the past; a cancelled wake-up.
 * Test first: A schedule_wakeup call shows when the agent will wake up.
 */
import { notImplemented } from "@conducted/shared";
import type { ToolCardProps } from "../tool-card-props.ts";

export function ScheduleWakeupCard(_props: ToolCardProps): never {
	return notImplemented("CHAT-20");
}
