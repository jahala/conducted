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
import { TerminalView } from "../../terminal/TerminalView.tsx";

export interface TerminalTabBodyProps {
	workspaceId: WorkspaceId;
	terminalId: TerminalId;
	visible: boolean;
	onClose: () => void;
	onNewTerminal?: () => void;
	canStartNew?: boolean;
	terminalLimit?: number;
}

/**
 * The tab that becomes active when `closingId` closes: the one after it, or the one before it when
 * it was last. Null when no terminal is left.
 */
export function nextTerminalAfterClose(
	ids: readonly TerminalId[],
	closingId: TerminalId,
): TerminalId | null {
	const index = ids.indexOf(closingId);
	const remaining = ids.filter((id) => id !== closingId);
	if (remaining.length === 0) return null;
	if (index === -1) return remaining[0] ?? null;
	return remaining[Math.min(index, remaining.length - 1)] ?? null;
}

export function TerminalTabBody({
	workspaceId,
	terminalId,
	visible,
	onClose,
	onNewTerminal,
	canStartNew,
	terminalLimit,
}: TerminalTabBodyProps) {
	return (
		<div
			data-terminal-tab={terminalId}
			data-workspace={workspaceId}
			aria-hidden={visible ? undefined : true}
			className={visible ? "h-full min-h-0 w-full" : "hidden"}
		>
			<TerminalView
				terminalId={terminalId}
				visible={visible}
				focusOnMount={visible}
				onClose={onClose}
				onNewTerminal={onNewTerminal}
				canStartNew={canStartNew}
				terminalLimit={terminalLimit}
			/>
		</div>
	);
}
