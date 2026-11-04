/**
 * @feature RUN-06 Terminal ended banner
 * Owns: the strip under an ended terminal that says the process exited and offers a new terminal.
 * Behaviour: ui-map.md 3.7 (terminal tabs, "New terminal"); native-and-sidecar-map.md (saved
 * terminal history: ended terminals stay readable after a restart).
 * Must handle: exit code 0 versus non-zero wording, an unknown exit code (killed), and the action
 * being unavailable at the terminal limit ("Maximum N terminals allowed").
 * Test first: exit code 1 shows the code, and the New terminal action calls onNewTerminal.
 */
import { notImplemented } from "@conducted/shared";

export interface TerminalEndedBannerProps {
	exitCode: number | null;
	canStartNew: boolean;
	onNewTerminal: () => void;
}

export function TerminalEndedBanner(_props: TerminalEndedBannerProps): never {
	return notImplemented("RUN-06");
}
