/**
 * @feature APP-16 One rule for terminal escapes
 * Owns: `stripTerminalEscapes`, the one rule that turns terminal output into plain text, shared by
 * the chat's tool cards, terminal snapshots, the Fix errors log and the in-memory Platform's
 * screen text. It lives in platform/ because the in-memory Platform may not import core.
 * Behaviour: control sequences (colours, cursor moves), operating system commands (window titles,
 * links) ended by BEL or ESC backslash, character set choices and the two-character escapes (ESC
 * and one character from 0 to ~, such as the keypad modes) are removed; everything else stays.
 * Test first: colours, a cursor move, a window title and a link are removed and the text is kept.
 */

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

const TERMINAL_ESCAPES = new RegExp(
	`${ESC}\\[[0-?]*[ -/]*[@-~]|${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)|${ESC}[ -/]+[0-~]|${ESC}[0-~]`,
	"g",
);

/** The text with every terminal escape sequence removed. */
export function stripTerminalEscapes(text: string): string {
	return text.replace(TERMINAL_ESCAPES, "");
}
