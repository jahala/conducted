/**
 * @feature APP-16 One rule for terminal escapes
 * Owns: tests for stripTerminalEscapes, the one rule the tool cards, the terminal snapshots, the
 * Fix errors log and the in-memory Platform use to turn terminal output into plain text.
 * Test first: colours, a cursor move, a window title and a link are removed and the text is kept.
 */
import { describe, expect, it } from "vitest";
import { stripTerminalEscapes } from "./terminal-escapes.ts";

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

describe("APP-16 stripTerminalEscapes", () => {
	it("removes colours, a cursor move, a window title and a link, and keeps the text", () => {
		const text = [
			`${ESC}[1;31merror${ESC}[0m: failed`,
			`${ESC}[2K${ESC}[1Gprogress 50%`,
			`${ESC}]0;build${BEL}title set`,
			`${ESC}]8;;https://example.com${ESC}\\link${ESC}]8;;${ESC}\\`,
			`${ESC}(Bcharset ${ESC}=keypad`,
		].join("\n");

		expect(stripTerminalEscapes(text)).toBe(
			["error: failed", "progress 50%", "title set", "link", "charset keypad"].join("\n"),
		);
	});

	it("leaves text without escapes alone", () => {
		expect(stripTerminalEscapes("plain [1;31m text")).toBe("plain [1;31m text");
	});
});
