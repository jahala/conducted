/**
 * @feature RUN-06 Terminal keys xterm owns
 * Owns: the seven terminal commands whose key xterm.js handles itself (ui-map.md 5.4, "Hidden
 * contextual shortcuts", Terminal: Shift+Enter, Cmd+K, Cmd+Backspace, Cmd+ArrowLeft,
 * Cmd+ArrowRight, Alt+ArrowLeft, Alt+ArrowRight), the sequence each sends, and the list the
 * dispatcher leaves out so no key runs twice.
 * Behaviour: ui-map.md 3.7 (xterm.js terminals) and 5.4 (the terminal's own keys).
 * Our design choice: these are registry entries, so the shortcuts dialog and the key-cap hints
 * show them, but no screen or core handler serves them: the terminal surface applies the key in
 * xterm's key handler. `keyBindings` leaves them out of the root dispatcher, so a key press reaches
 * xterm only and never falls through to "not available yet".
 * Test first: the dispatcher has no binding for a command in this list, and the surface sends the
 * list's sequence when its key is pressed.
 */

export interface TerminalOwnedKey {
	/** The registry command the key describes. */
	commandId: string;
	/** The default shortcut, in the registry's spelling. */
	shortcut: string;
	/** The bytes xterm sends to the shell. */
	sequence?: string;
	/** Clears xterm's scrollback instead of sending bytes. */
	clear?: true;
}

export const TERMINAL_OWNED_KEYS: readonly TerminalOwnedKey[] = [
	{ commandId: "terminal.newline", shortcut: "Shift+Enter", sequence: "\n" },
	{ commandId: "terminal.clear", shortcut: "Cmd+K", clear: true },
	{ commandId: "terminal.deleteLine", shortcut: "Cmd+Backspace", sequence: "\u0015" },
	{ commandId: "terminal.lineStart", shortcut: "Cmd+ArrowLeft", sequence: "\u0001" },
	{ commandId: "terminal.lineEnd", shortcut: "Cmd+ArrowRight", sequence: "\u0005" },
	{ commandId: "terminal.wordBack", shortcut: "Alt+ArrowLeft", sequence: "\u001bb" },
	{ commandId: "terminal.wordForward", shortcut: "Alt+ArrowRight", sequence: "\u001bf" },
];

/** The command ids the root dispatcher must not run: xterm already applied the key. */
export const TERMINAL_OWNED_COMMAND_IDS: readonly string[] = TERMINAL_OWNED_KEYS.map(
	(key) => key.commandId,
);
