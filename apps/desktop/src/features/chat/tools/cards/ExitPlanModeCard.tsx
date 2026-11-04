/**
 * @feature CHAT-12 Propose plan card
 * Owns: The card in the history for the plan the agent proposed, with its text and what the user
 * decided.
 * Behaviour: ui-map.md 3.3 ('Propose plan'), claude-runner.md 3.5.
 * Must handle: Plan not yet decided (the PlanReviewBar in the dock is live); approved, rejected
 * with feedback, handed off; a long plan collapses.
 * Test first: A proposed plan renders its text; after approval the footer says Approved.
 */
import { notImplemented } from "@conducted/shared";
import type { ToolCardProps } from "../tool-card-props.ts";

export function ExitPlanModeCard(_props: ToolCardProps): never {
	return notImplemented("CHAT-12");
}
