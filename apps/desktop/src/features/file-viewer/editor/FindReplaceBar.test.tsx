/**
 * @feature REV-08 Find and replace bar
 * Tests the count, the navigation buttons and the disabled state.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FindReplaceBar, type FindReplaceBarProps } from "./FindReplaceBar.tsx";

afterEach(cleanup);

const props = (over: Partial<FindReplaceBarProps> = {}): FindReplaceBarProps => ({
	query: "a",
	replacement: "",
	matchCount: 3,
	currentIndex: 0,
	caseSensitive: false,
	wholeWord: false,
	regex: false,
	regexError: null,
	onQueryChange: () => {},
	onReplacementChange: () => {},
	onToggle: () => {},
	onNext: () => {},
	onPrevious: () => {},
	onReplace: () => {},
	onReplaceAll: () => {},
	onClose: () => {},
	...over,
});

describe("REV-08 FindReplaceBar", () => {
	it("shows three matches and moves with Next", () => {
		const onNext = vi.fn();
		render(<FindReplaceBar {...props({ onNext })} />);
		expect(screen.getByLabelText("3 matches").textContent).toBe("3");
		fireEvent.click(screen.getByRole("button", { name: "Next" }));
		expect(onNext).toHaveBeenCalledTimes(1);
	});

	it("disables the movement and replace buttons when there is no match", () => {
		render(<FindReplaceBar {...props({ matchCount: 0, currentIndex: null })} />);
		expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(true);
		expect((screen.getByRole("button", { name: "Previous" }) as HTMLButtonElement).disabled).toBe(
			true,
		);
		expect(
			(screen.getByRole("button", { name: "Replace All" }) as HTMLButtonElement).disabled,
		).toBe(true);
	});

	it("shows a regular-expression error inline", () => {
		render(<FindReplaceBar {...props({ regex: true, regexError: "Unterminated group" })} />);
		expect(screen.getByRole("alert").textContent).toContain("Unterminated group");
	});

	it("runs Next on Enter and Previous on Shift+Enter", () => {
		const onNext = vi.fn();
		const onPrevious = vi.fn();
		render(<FindReplaceBar {...props({ onNext, onPrevious })} />);
		const find = screen.getByRole("textbox", { name: "Find" });
		fireEvent.keyDown(find, { key: "Enter" });
		fireEvent.keyDown(find, { key: "Enter", shiftKey: true });
		expect(onNext).toHaveBeenCalledTimes(1);
		expect(onPrevious).toHaveBeenCalledTimes(1);
	});
});
