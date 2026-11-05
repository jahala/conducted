/**
 * @feature COMP-06 Terminal command bar
 * Owns: The bar that appears above the composer while a slash command runs in the embedded
 * terminal.
 * Behaviour: ui-map.md 3.5 ('Run /x in the embedded terminal', 'Complete /x below, then click
 * done', 'Terminal command finished. Refresh to use the updated config here').
 * Must handle: the terminal was closed early (the bar offers to reopen it); the command exits
 * with an error (shown); only one bar at a time (the caller renders one, keyed by its command).
 * Test first: While a command runs the bar shows its name and a Done button; clicking Done calls
 * onDone once.
 */
import { Button } from "../../ui/Button.tsx";

/** `running`: the command is in the terminal. `finished`: it exited and config can be reloaded. */
export type TerminalCommandPhase = "running" | "finished";

export interface TerminalCommandBarProps {
	/** The command name, with or without its leading slash. */
	command: string;
	onDone: () => void;
	phase?: TerminalCommandPhase;
	/** The command's own failure text, when it exited with an error. */
	error?: string | null;
	/** The user closed the terminal before the command finished. */
	terminalClosed?: boolean;
	/** Reopen the terminal that holds the command. */
	onReopen?: () => void;
}

const withSlash = (command: string): string => (command.startsWith("/") ? command : `/${command}`);

export function TerminalCommandBar({
	command,
	onDone,
	phase = "running",
	error = null,
	terminalClosed = false,
	onReopen,
}: TerminalCommandBarProps) {
	const name = withSlash(command);
	let text: string;
	if (phase === "finished") {
		text = "Terminal command finished. Refresh to use the updated config here";
	} else if (terminalClosed) {
		text = `Run ${name} in the embedded terminal`;
	} else {
		text = `Complete ${name} below, then click done`;
	}
	return (
		<div
			role="status"
			className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-2"
		>
			<div className="min-w-0">
				<p className="truncate text-sm text-fg-muted">{text}</p>
				{error !== null && error.length > 0 ? (
					<p className="truncate text-xs text-danger">{error}</p>
				) : null}
			</div>
			<div className="flex shrink-0 items-center gap-1">
				{terminalClosed && onReopen !== undefined ? (
					<Button variant="ghost" size="sm" onClick={onReopen}>
						Reopen terminal
					</Button>
				) : null}
				<Button variant="secondary" size="sm" onClick={onDone}>
					Done
				</Button>
			</div>
		</div>
	);
}
