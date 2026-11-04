/**
 * @feature APP-05 Popover
 * Owns: floating panels anchored to a button (model picker, context hover card, forward ports), built on
 * the radix Popover.
 * Behaviour: ui-map.md 5.2 (popovers), 8 (HoverCard, Popover).
 * Must handle: focus moves in on open and back on close, Escape closes, flips at window edges, a hover
 * variant that opens on pointer hover and on keyboard focus (context wheel).
 * Test first: clicking the trigger shows the content; Escape hides it and returns focus to the trigger.
 */
import { notImplemented } from "@conducted/shared";
import type { ReactNode } from "react";

export interface PopoverProps {
	trigger: ReactNode;
	children: ReactNode;
	side?: "top" | "right" | "bottom" | "left";
	/** Opens on hover and focus instead of click. */
	hover?: boolean;
}

export function Popover(_props: PopoverProps): never {
	return notImplemented("APP-05");
}
