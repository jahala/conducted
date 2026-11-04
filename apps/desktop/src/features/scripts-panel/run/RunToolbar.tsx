/**
 * @feature RUN-01 Run toolbar
 * Owns: the row above the run output. The action select, the Run or Stop button, the Open
 * button with its URL menu, and the Spotlight toggle where it applies.
 * Behaviour: ui-map.md 3.7, "Run" paragraph and "Preview and open buttons"; the button text comes
 * from run-button-label.ts.
 * Children: PreviewUrlMenu.
 * Must handle: one action only (select hidden), many actions (select scrolls, last used first),
 * the Open button disabled until a URL is known (with the reason), and the button text changing
 * without the layout jumping (fixed minimum width).
 * Test first: with a detected localhost URL the Open button is enabled and opens it.
 */
import { notImplemented } from "@conducted/shared";
import type { RunButtonModel } from "./run-button-label.ts";

export interface RunToolbarProps {
	actions: { id: string; label: string }[];
	selectedActionId: string;
	onSelectAction: (id: string) => void;
	button: RunButtonModel;
	onButtonClick: () => void;
	urls: { label: string; url: string }[];
	onOpenUrl: (url: string) => void;
}

export function RunToolbar(_props: RunToolbarProps): never {
	return notImplemented("RUN-01");
}
