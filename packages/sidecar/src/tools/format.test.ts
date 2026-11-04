import { expect, test } from "bun:test";
import { formatDiffComments, formatQuestionAnswers, formatTerminalOutput } from "./format.ts";

test("a multi-select answer lists its items under the question number", () => {
	expect(formatQuestionAnswers([["Yes"], ["a", "b"]])).toBe(
		"The user answered:\n1. Yes\n2.\n   - a\n   - b",
	);
});

test("comments show the line range, author and resolved state", () => {
	const text = formatDiffComments([
		{ file: "a.ts", line: 3, endLine: 5, body: "one\ntwo", author: "user", resolved: false },
		{ file: "b.ts", line: 9, body: "x", author: "github", resolved: true },
	]);
	expect(text).toBe("a.ts:3-5 [user]\n  one\n  two\n\nb.ts:9 [github, resolved]\n  x");
	expect(formatDiffComments([])).toBe("There are no review comments on the diff.");
});

test("terminal output carries its source and running state", () => {
	expect(formatTerminalOutput({ output: "ok", source: "run_script", running: true })).toBe(
		"[run_script, still running]\nok",
	);
	expect(formatTerminalOutput({ output: "", source: "terminal", running: false })).toContain(
		"(no output yet)",
	);
});
