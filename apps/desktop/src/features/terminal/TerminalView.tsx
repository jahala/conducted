/**
 * @feature RUN-06 TerminalView
 * Owns: one xterm.js terminal bound to a PTY, with find and fit-to-size. Entry point embedded by
 * the scripts panel and by the center tab strip (big terminal mode).
 * Behaviour: ui-map.md 3.7 (Terminal N tabs: xterm.js, "Find in terminal" Cmd+F, "Close
 * terminal" Cmd+W) and 3.2 (terminals can sit in the center, setting "Big terminal mode").
 * Data: useTerminals(workspaceId) tells whether the terminal is live or ended;
 * useTerminalConnection(terminalId) gives the PTY stream, input, resize and saved history.
 * Children: TerminalSurface, TerminalFindBar, TerminalEndedBanner.
 * Our design choice: the xterm instance outlives React tab switches. The surface layer from
 * ui-map.md 8 ("long-lived DOM outside React tab content") is a platform concern; this component
 * must tolerate being unmounted and mounted again by replaying saved history, not by relying on
 * staying mounted.
 * Must handle: a terminal that has ended (history shown, banner with exit code), a terminal that
 * cannot be found, the PTY failing to spawn, output arriving before the view is ready (buffer it),
 * output faster than rendering (acknowledge bytes only after they are written, for flow control),
 * a resize while hidden (fit on show), find with no matches, paste of large text, and an archived
 * workspace (history only, no input).
 * Test first: output written to a connection before mount appears in the terminal buffer after
 * mount, and bytes are acknowledged once.
 */
import type { TerminalId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";

export function TerminalView(_props: { terminalId: TerminalId }): never {
	return notImplemented("RUN-06");
}
