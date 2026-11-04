/**
 * @feature RUN-06 TerminalView
 * Owns: One xterm.js terminal bound to a PTY, with find and fit-to-size.
 * Behaviour: ui-map.md 3.7
 * Entry point embedded by another part of the app. Keep the name and props stable.
 */

import type { TerminalId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";

export function TerminalView(_props: { terminalId: TerminalId }): never {
	return notImplemented("RUN-06");
}
