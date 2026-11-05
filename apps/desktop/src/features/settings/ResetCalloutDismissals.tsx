/**
 * @feature APP-10 Reset callout dismissals
 * Owns: the settings row with the "Reset callout dismissals" button, which brings back every hint the user
 * dismissed.
 * Behaviour: ui-map.md 7.1 ("Reset callout dismissals" exists, so callouts exist; in Conductor it sits under
 * the internal settings); settings-states-kit.md (callout dismissals and the reset action).
 * Our design choice: unlike Conductor, the action is on a user page, so a person who dismissed a hint by
 * accident can get it back. It sits on the General page. It clears the one stored list through
 * `Actions.settings.set`; it does not need a confirm because nothing is lost.
 * Must handle: no dismissed hints (the button is disabled and says "No dismissed hints"); the write failing
 * (a short error beside the button, the list unchanged); a second click while the write runs (ignored);
 * the result announced to screen readers; keyboard focus staying on the button.
 * Test first: with two dismissed ids, clicking the button writes an empty list once and the row then shows
 * "No dismissed hints".
 */
import { notImplemented } from "@conducted/shared";

export interface ResetCalloutDismissalsProps {
	/** The ids stored as dismissed. */
	dismissedIds: readonly string[];
	onReset: () => Promise<boolean>;
}

export function ResetCalloutDismissals(_props: ResetCalloutDismissalsProps): never {
	return notImplemented("APP-10");
}
