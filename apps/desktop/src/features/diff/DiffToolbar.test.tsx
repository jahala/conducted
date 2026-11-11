/**
 * @feature REV-02 Diff toolbar
 * Tests that each control changes only its own preference. The toolbar is Conductor's icon toggles
 * plus a "View options" menu; "Entire file" is the file header's read-only view, not a diff option.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DiffLayoutToggles, DiffViewOptions, SPLIT_MIN_WIDTH } from "./DiffToolbar.tsx";
import type { DiffPreferences } from "./diff-types.ts";

afterEach(cleanup);

const preferences: DiffPreferences = {
	layout: "unified",
	hideWhitespaceChanges: false,
	wrapLines: false,
	ligatures: true,
};

describe("REV-02 DiffToolbar", () => {
	it("gives each toolbar's checkboxes ids of their own, for two tabs side by side", async () => {
		render(
			<>
				<DiffViewOptions preferences={preferences} onChange={vi.fn()} disabled={false} />
				<DiffViewOptions preferences={preferences} onChange={vi.fn()} disabled={false} />
			</>,
		);
		const buttons = screen.getAllByRole("button", { name: "View options" });
		fireEvent.click(buttons[0] as HTMLElement);
		const first = await screen.findByRole("checkbox", { name: "Wrap lines" });
		const firstId = first.id;
		fireEvent.keyDown(first, { key: "Escape" });
		fireEvent.click(buttons[1] as HTMLElement);
		const second = await screen.findByRole("checkbox", { name: "Wrap lines" });
		expect(second.id).not.toBe(firstId);
	});

	it("flips wrap lines and nothing else", async () => {
		const onChange = vi.fn();
		render(<DiffViewOptions preferences={preferences} onChange={onChange} disabled={false} />);
		fireEvent.click(screen.getByRole("button", { name: "View options" }));
		const wrap = await screen.findByRole("checkbox", { name: "Wrap lines" });
		fireEvent.click(wrap);
		expect(onChange).toHaveBeenCalledWith({ ...preferences, wrapLines: true });
	});

	it("switches to the split layout and shows the diff", () => {
		const onChange = vi.fn();
		const onShowDiff = vi.fn();
		render(
			<DiffLayoutToggles
				preferences={preferences}
				onChange={onChange}
				disabled={false}
				active={false}
				onShowDiff={onShowDiff}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Split view" }));
		expect(onChange).toHaveBeenCalledWith({ ...preferences, layout: "split" });
		expect(onShowDiff).toHaveBeenCalledTimes(1);
	});

	it("marks the layout in use as pressed only while the diff is on show", () => {
		const { rerender } = render(
			<DiffLayoutToggles preferences={preferences} onChange={() => {}} disabled={false} />,
		);
		expect(screen.getByRole("button", { name: "Unified view" }).getAttribute("aria-pressed")).toBe(
			"true",
		);
		rerender(
			<DiffLayoutToggles
				preferences={preferences}
				onChange={() => {}}
				disabled={false}
				active={false}
			/>,
		);
		expect(screen.getByRole("button", { name: "Unified view" }).getAttribute("aria-pressed")).toBe(
			"false",
		);
	});

	it("offers only the choices that change the diff itself", async () => {
		render(<DiffViewOptions preferences={preferences} onChange={() => {}} disabled={false} />);
		fireEvent.click(screen.getByRole("button", { name: "View options" }));
		expect(await screen.findByRole("checkbox", { name: "Hide whitespace changes" })).toBeTruthy();
		expect(await screen.findByRole("checkbox", { name: "Wrap lines" })).toBeTruthy();
		// "Entire file" is the header's own read-only view (FileTabHeader), not a diff option.
		expect(screen.queryByRole("checkbox", { name: "Entire file" })).toBeNull();
	});

	it("disables every control for a binary file", () => {
		render(
			<>
				<DiffLayoutToggles preferences={preferences} onChange={() => {}} disabled={true} />
				<DiffViewOptions preferences={preferences} onChange={() => {}} disabled={true} />
			</>,
		);
		for (const button of screen.getAllByRole("button")) {
			expect((button as HTMLButtonElement).disabled).toBe(true);
		}
	});

	it("disables the split layout when the tab is too narrow", () => {
		render(
			<DiffLayoutToggles
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
			<DiffLayoutToggles
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
