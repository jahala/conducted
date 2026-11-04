/**
 * @feature COMP-06 Terminal command bar
 * Owns: The bar that appears above the composer while a slash command runs in the embedded
 * terminal.
 * Behaviour: ui-map.md 3.5 ('Run /x in the embedded terminal', 'Complete /x below, then click
 * done', 'Terminal command finished. Refresh to use the updated config here').
 * Must handle: The terminal was closed early (the bar offers to reopen it); the command exits with
 * an error (shown); 'Done' restarts the agent so config changes apply; only one bar at a time.
 * Test first: While a command runs the bar shows its name and a Done button; clicking Done calls
 * onDone once.
 */
import { notImplemented } from "@conducted/shared";

export interface TerminalCommandBarProps {
	command: string;
	onDone: () => void;
}

export function TerminalCommandBar(_props: TerminalCommandBarProps): never {
	return notImplemented("COMP-06");
}
