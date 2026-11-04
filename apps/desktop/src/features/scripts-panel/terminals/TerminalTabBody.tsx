/**
 * @feature RUN-06 Terminal tab body
 * Owns: the body of a terminal tab in the scripts panel: the terminal, its find bar, and the ended
 * banner. A thin wrapper that decides what to show around TerminalView.
 * Behaviour: ui-map.md 3.7 ("Terminal N" tabs; "New terminal" Cmd+T when focused; "Close terminal"
 * Cmd+W; "Find in terminal" Cmd+F).
 * Children: terminal/TerminalView, terminal/TerminalFindBar, terminal/TerminalEndedBanner.
 * Must handle: the terminal not found (it was closed elsewhere), switching tabs keeping each
 * terminal's scrollback and find state, and shortcuts acting only on the focused terminal.
 * Test first: closing the active terminal selects its neighbour and does not unmount the others.
 */
import type { TerminalId, WorkspaceId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";

export interface TerminalTabBodyProps {
	workspaceId: WorkspaceId;
	terminalId: TerminalId;
	visible: boolean;
	onClose: () => void;
}

export function TerminalTabBody(_props: TerminalTabBodyProps): never {
	return notImplemented("RUN-06");
}
