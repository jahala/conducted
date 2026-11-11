/**
 * @feature RUN-06 Terminal find bar
 * Owns: tests for the scrollback search and the find bar controls.
 * Test first: searching for text that is in the scrollback reports a match and Next moves to the
 * following one.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type FindableBuffer,
	findInTerminalBuffer,
	findPatternError,
	TerminalFindBar,
	type TerminalFindOptions,
} from "./TerminalFindBar.tsx";

afterEach(cleanup);

function bufferWith(lines: readonly string[]): FindableBuffer {
	return {
		length: lines.length,
		getLine: (index) => {
			const text = lines[index];
			return text === undefined ? undefined : { translateToString: () => text };
		},
	};
}

const options = (patch: Partial<TerminalFindOptions> = {}): TerminalFindOptions => ({
	query: "foo",
	caseSensitive: false,
	regex: false,
	...patch,
});

describe("RUN-06 find in the terminal buffer", () => {
	it("finds a line and moves Next to the following match", () => {
		const buffer = bufferWith(["foo", "bar foo", "baz"]);
		const first = findInTerminalBuffer(buffer, options());
		expect(first).toEqual({ line: 0, column: 0, length: 3 });

		const next = findInTerminalBuffer(buffer, options(), first, "next");
		expect(next).toEqual({ line: 1, column: 4, length: 3 });
	});

	it("moves Previous back to the match before", () => {
		const buffer = bufferWith(["foo", "bar foo", "baz"]);
		const second = { line: 1, column: 4, length: 3 };
		expect(findInTerminalBuffer(buffer, options(), second, "previous")).toEqual({
			line: 0,
			column: 0,
			length: 3,
		});
	});

	it("wraps around the end of the scrollback", () => {
		const buffer = bufferWith(["foo", "bar foo", "baz"]);
		const last = { line: 1, column: 4, length: 3 };
		expect(findInTerminalBuffer(buffer, options(), last, "next")).toEqual({
			line: 0,
			column: 0,
			length: 3,
		});
	});

	it("wraps back to the only match when Next is pressed on it", () => {
		const buffer = bufferWith(["nothing", "one foo here", "nothing"]);
		const only = findInTerminalBuffer(buffer, options());
		expect(only).toEqual({ line: 1, column: 4, length: 3 });
		expect(findInTerminalBuffer(buffer, options(), only, "next")).toEqual(only);
		expect(findInTerminalBuffer(buffer, options(), only, "previous")).toEqual(only);
	});

	it("reaches a match earlier on the start line after the later ones", () => {
		const buffer = bufferWith(["foo and foo"]);
		const second = { line: 0, column: 8, length: 3 };
		expect(findInTerminalBuffer(buffer, options(), second, "next")).toEqual({
			line: 0,
			column: 0,
			length: 3,
		});
		const first = { line: 0, column: 0, length: 3 };
		expect(findInTerminalBuffer(buffer, options(), first, "previous")).toEqual({
			line: 0,
			column: 8,
			length: 3,
		});
	});

	it("says why a broken regular expression cannot be searched", () => {
		expect(findPatternError(options({ query: "[", regex: true }))).not.toBeNull();
		expect(findPatternError(options({ query: "[", regex: false }))).toBeNull();
		expect(findPatternError(options({ query: "" }))).toBeNull();
	});

	it("honours case sensitivity and regular expressions", () => {
		const buffer = bufferWith(["foo", "FOO"]);
		expect(findInTerminalBuffer(buffer, options({ query: "FOO" }))).toEqual({
			line: 0,
			column: 0,
			length: 3,
		});
		expect(findInTerminalBuffer(buffer, options({ query: "FOO", caseSensitive: true }))).toEqual({
			line: 1,
			column: 0,
			length: 3,
		});
		expect(
			findInTerminalBuffer(buffer, options({ query: "^F.O$", regex: true, caseSensitive: true })),
		).toEqual({
			line: 1,
			column: 0,
			length: 3,
		});
	});

	it("returns nothing for an empty query, an invalid pattern or no match", () => {
		const buffer = bufferWith(["foo"]);
		expect(findInTerminalBuffer(buffer, options({ query: "" }))).toBeNull();
		expect(findInTerminalBuffer(buffer, options({ query: "[", regex: true }))).toBeNull();
		expect(findInTerminalBuffer(buffer, options({ query: "nope" }))).toBeNull();
		expect(findInTerminalBuffer(bufferWith([]), options())).toBeNull();
	});
});

describe("RUN-06 terminal find bar", () => {
	it("reports no match and drives Next, Previous and Close from the keyboard", () => {
		const onNext = vi.fn();
		const onPrevious = vi.fn();
		const onClose = vi.fn();
		render(
			<TerminalFindBar
				query="nope"
				caseSensitive={false}
				regex={false}
				hasMatch={false}
				onQueryChange={vi.fn()}
				onToggle={vi.fn()}
				onNext={onNext}
				onPrevious={onPrevious}
				onClose={onClose}
			/>,
		);
		expect(screen.getByText("No results")).toBeTruthy();
		const input = screen.getByRole("textbox", { name: "Find in terminal" });
		fireEvent.keyDown(input, { key: "Enter" });
		expect(onNext).toHaveBeenCalledTimes(1);
		fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
		expect(onPrevious).toHaveBeenCalledTimes(1);
		fireEvent.keyDown(input, { key: "Escape" });
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("shows Conductor's 'Invalid regular expression' instead of 'No results' for a broken regular expression", () => {
		render(
			<TerminalFindBar
				query="["
				caseSensitive={false}
				regex
				hasMatch={false}
				patternError="Unterminated character class"
				onQueryChange={vi.fn()}
				onToggle={vi.fn()}
				onNext={vi.fn()}
				onPrevious={vi.fn()}
				onClose={vi.fn()}
			/>,
		);
		expect(screen.getByText("Invalid regular expression")).toBeTruthy();
		expect(screen.queryByText("No results")).toBeNull();
	});

	it("toggles case and regex and reports the typed query", () => {
		const onToggle = vi.fn();
		const onQueryChange = vi.fn();
		render(
			<TerminalFindBar
				query=""
				caseSensitive={false}
				regex={false}
				hasMatch={null}
				onQueryChange={onQueryChange}
				onToggle={onToggle}
				onNext={vi.fn()}
				onPrevious={vi.fn()}
				onClose={vi.fn()}
			/>,
		);
		fireEvent.change(screen.getByRole("textbox", { name: "Find in terminal" }), {
			target: { value: "needle" },
		});
		expect(onQueryChange).toHaveBeenCalledWith("needle");
		fireEvent.click(screen.getByRole("button", { name: "Match case" }));
		fireEvent.click(screen.getByRole("button", { name: "Use regular expression" }));
		expect(onToggle).toHaveBeenCalledWith("caseSensitive");
		expect(onToggle).toHaveBeenCalledWith("regex");
	});
});
