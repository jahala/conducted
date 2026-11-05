/**
 * @feature RUN-06 Terminal ended banner
 * Owns: the strip under an ended terminal that says the process exited and offers a new terminal.
 * Behaviour: ui-map.md 3.7 (terminal tabs, "New terminal"); native-and-sidecar-map.md (saved
 * terminal history: ended terminals stay readable after a restart).
 * Must handle: exit code 0 versus non-zero wording, an unknown exit code (killed), and the action
 * being unavailable at the terminal limit ("Maximum N terminals allowed").
 * Test first: exit code 1 shows the code, and the New terminal action calls onNewTerminal.
 */
import { Button } from "../../ui/Button.tsx";

export interface TerminalEndedBannerProps {
	exitCode: number | null;
	canStartNew: boolean;
	onNewTerminal: () => void;
	/** Shown when the limit is reached. */
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
	terminalLimit,
}: TerminalEndedBannerProps) {
	return (
		<div className="flex shrink-0 items-center justify-between gap-3 border-t border-separator bg-panel px-3 py-2 text-xs text-fg-muted">
			<div className="min-w-0">
				<p>{exitText(exitCode)}</p>
				{canStartNew ? null : (
					<p className="text-fg-subtle">
						{terminalLimit === undefined
							? "Maximum terminals allowed"
							: `Maximum ${terminalLimit} terminals allowed`}
					</p>
				)}
			</div>
			<Button variant="secondary" size="xs" disabled={!canStartNew} onClick={onNewTerminal}>
				New terminal
			</Button>
		</div>
	);
}
