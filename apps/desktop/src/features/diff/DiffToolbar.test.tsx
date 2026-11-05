/**
 * @feature REV-02 Diff toolbar
 * Tests that each control changes only its own preference.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../../test/dom-polyfills.ts";
import { DiffToolbar, SPLIT_MIN_WIDTH } from "./DiffToolbar.tsx";
import type { DiffPreferences } from "./diff-types.ts";

afterEach(cleanup);

const preferences: DiffPreferences = {
	layout: "unified",
	entireFile: false,
	hideWhitespaceChanges: false,
	wrapLines: false,
	ligatures: true,
};

describe("REV-02 DiffToolbar", () => {
	it("flips wrap lines and nothing else", async () => {
		const onChange = vi.fn();
		render(<DiffToolbar preferences={preferences} onChange={onChange} disabled={false} />);
		fireEvent.click(screen.getByRole("button", { name: "View options" }));
		const wrap = await screen.findByRole("checkbox", { name: "Wrap lines" });
		fireEvent.click(wrap);
		expect(onChange).toHaveBeenCalledWith({ ...preferences, wrapLines: true });
	});

	it("switches to the split layout", () => {
		const onChange = vi.fn();
		render(<DiffToolbar preferences={preferences} onChange={onChange} disabled={false} />);
		fireEvent.click(screen.getByRole("button", { name: "Split view" }));
		expect(onChange).toHaveBeenCalledWith({ ...preferences, layout: "split" });
	});

	it("toggles the entire file", () => {
		const onChange = vi.fn();
		render(<DiffToolbar preferences={preferences} onChange={onChange} disabled={false} />);
		fireEvent.click(screen.getByRole("button", { name: "Entire file" }));
		expect(onChange).toHaveBeenCalledWith({ ...preferences, entireFile: true });
	});

	it("disables every control for a binary file", () => {
		render(<DiffToolbar preferences={preferences} onChange={() => {}} disabled={true} />);
		for (const button of screen.getAllByRole("button")) {
			expect((button as HTMLButtonElement).disabled).toBe(true);
		}
	});

	it("disables the split layout when the tab is too narrow", () => {
		render(
			<DiffToolbar
				preferences={preferences}
				onChange={() => {}}
				disabled={false}
				width={SPLIT_MIN_WIDTH - 1}
			/>,
		);
		expect((screen.getByRole("button", { name: "Split view" }) as HTMLButtonElement).disabled).toBe(
			true,
		);
	});

	it("allows the split layout at the threshold width", () => {
		render(
			<DiffToolbar
				preferences={preferences}
				onChange={() => {}}
				disabled={false}
				width={SPLIT_MIN_WIDTH}
			/>,
		);
		expect((screen.getByRole("button", { name: "Split view" }) as HTMLButtonElement).disabled).toBe(
			false,
		);
	});
});
