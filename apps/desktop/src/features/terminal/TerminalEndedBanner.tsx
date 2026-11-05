/**
 * @feature RUN-06 Terminal ended banner
 * Owns: the strip under an ended terminal that says the process exited and offers a new terminal.
 * Behaviour: ui-map.md 3.7 (terminal tabs, "New terminal"); native-and-sidecar-map.md (saved
 * terminal history: ended terminals stay readable after a restart).
 * Must handle: an unknown exit code (killed), restarting the shell, and the action being
 * unavailable at the terminal limit ("Maximum N terminals allowed").
 * Test first: exit code 1 shows the code, and the New terminal action calls onNewTerminal.
 */
import { Button } from "../../ui/Button.tsx";

export interface TerminalEndedBannerProps {
	exitCode: number | null;
	canStartNew: boolean;
	/** The caller can start a terminal. Without it the action is not offered. */
	onNewTerminal?: () => void;
	onRestart?: () => void;
	/** Shown only when the terminal limit is why New terminal is unavailable. */
	terminalLimit?: number;
}

function exitText(exitCode: number | null): string {
	if (exitCode === null) return "Shell exited without an exit code.";
	return `Shell exited with status ${exitCode}.`;
}

export function TerminalEndedBanner({
	exitCode,
	canStartNew,
	onNewTerminal,
	onRestart,
	terminalLimit,
}: TerminalEndedBannerProps) {
	return (
		<div className="flex shrink-0 items-center justify-between gap-3 border-t border-separator bg-panel px-3 py-2 text-xs text-fg-muted">
			<div className="min-w-0">
				<p>{exitText(exitCode)}</p>
				{!canStartNew && terminalLimit !== undefined ? (
					<p className="text-fg-subtle">Maximum {terminalLimit} terminals allowed</p>
				) : null}
			</div>
			<div className="flex shrink-0 items-center gap-2">
				{onRestart ? (
					<Button variant="secondary" size="xs" onClick={onRestart}>
						Restart
					</Button>
				) : null}
				{onNewTerminal ? (
					<Button variant="secondary" size="xs" disabled={!canStartNew} onClick={onNewTerminal}>
						New terminal
					</Button>
				) : null}
			</div>
		</div>
	);
}
