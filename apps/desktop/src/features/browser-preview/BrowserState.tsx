/**
 * @feature RUN-04 Browser tab states
 * Owns: the designed full-tab states: starting, failed to load, server not running, preview turned
 * off, and archived.
 * Behaviour: ui-map.md 3.2 ("Starting preview..."), 3.2 archived text, and 7.2 ("No local servers
 * running. Start your dev server and it'll show up here.").
 * Must handle: one action per state (Retry, Start the Run action, Open in system browser,
 * Unarchive), and the refused connection wording naming the port.
 * Test first: kind "server_not_running" shows an action that calls onAction.
 */
import { notImplemented } from "@conducted/shared";

export type BrowserStateKind =
	| "starting"
	| "load_failed"
	| "server_not_running"
	| "preview_off"
	| "archived";

export interface BrowserStateProps {
	kind: BrowserStateKind;
	detail: string | null;
	onAction: () => void;
}

export function BrowserState(_props: BrowserStateProps): never {
	return notImplemented("RUN-04");
}
