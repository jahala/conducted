/**
 * @feature RUN-06 Terminal find bar
 * Owns: the small bar for searching the terminal's scrollback.
 * Behaviour: ui-map.md 3.7 ("Find in terminal", Cmd+F).
 * Open question: xterm's search addon (@xterm/addon-search) is not installed. Either add it, or
 * search the buffer through Terminal.buffer. Decide before the build.
 * Must handle: no match, case and regex toggles, Enter and Shift+Enter, Escape closing and
 * returning focus to the terminal, and the query kept when the bar closes and opens again.
 * Test first: searching for text that is in the scrollback reports a match and Next moves to the
 * following one.
 */
import { notImplemented } from "@conducted/shared";

export interface TerminalFindBarProps {
	query: string;
	caseSensitive: boolean;
	regex: boolean;
	hasMatch: boolean | null;
	onQueryChange: (query: string) => void;
	onToggle: (option: "caseSensitive" | "regex") => void;
	onNext: () => void;
	onPrevious: () => void;
	onClose: () => void;
}

export function TerminalFindBar(_props: TerminalFindBarProps): never {
	return notImplemented("RUN-06");
}
