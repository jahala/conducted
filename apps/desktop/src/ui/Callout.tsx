/**
 * @feature APP-10 Callout (dismissible hint)
 * Owns: a small hint box, "coach mark", that explains a control or a feature and goes away for good when the
 * user dismisses it.
 * Behaviour: ui-map.md 7.1 (callouts exist: the settings page offers "Reset callout dismissals"; one example
 * is a tooltip-style hint on the send button), 8 (shared UI kit).
 * Our design choice: the component is controlled. The caller reads `dismissed` from the stored list of
 * dismissed callout ids and writes the id back in `onDismiss`, so the kit holds no state and no storage.
 * The list is one user setting (a new key in core/registries/settings.ts, added when this is built), so
 * "Reset callout dismissals" (features/settings/ResetCalloutDismissals.tsx) clears one value. This is not
 * the Markdown callout in chat text (Note, Tip, Important, Warning, Caution), which is part of AssistantText.
 * Must handle: a dismissed callout (renders nothing and takes no space); the dismiss button named
 * "Dismiss" with a visible focus ring; Escape dismissing when focus is inside; a callout that holds a
 * link or button (they stay reachable by keyboard); the callout appearing while the user types (no focus
 * steal); light and dark theme with text at AA contrast; two callouts with the same id (both hide at once).
 * Test first: with dismissed false the callout shows its text; clicking "Dismiss" calls onDismiss with its
 * id; with dismissed true it renders nothing.
 */
import { notImplemented } from "@conducted/shared";
import type { ReactNode } from "react";

export interface CalloutProps {
	/** Stable and unique, for example "send-button-hint". Stored when dismissed. */
	id: string;
	dismissed: boolean;
	onDismiss: (id: string) => void;
	title?: string;
	children: ReactNode;
}

export function Callout(_props: CalloutProps): never {
	return notImplemented("APP-10");
}
