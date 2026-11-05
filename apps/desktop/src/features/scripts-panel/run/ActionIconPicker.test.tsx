import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../../../test/dom-polyfills.ts";
import { ActionIconPicker } from "./ActionIconPicker.tsx";

afterEach(cleanup);

describe("SET-07 ActionIconPicker", () => {
	it("narrows the grid to icons whose name contains the search", () => {
		const onSelect = vi.fn();
		render(<ActionIconPicker selected={null} onSelect={onSelect} />);

		fireEvent.change(screen.getByLabelText("Search icons"), { target: { value: "play" } });

		expect(screen.getByRole("button", { name: "play" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "terminal" })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "play" }));
		expect(onSelect).toHaveBeenCalledWith("play");
	});

	it("shows the designed empty text when no icon matches", () => {
		render(<ActionIconPicker selected={null} onSelect={vi.fn()} />);

		fireEvent.change(screen.getByLabelText("Search icons"), { target: { value: "zzzz" } });

		expect(screen.getByText("No icons found")).toBeTruthy();
	});

	it("marks the current icon", () => {
		render(<ActionIconPicker selected="test" onSelect={vi.fn()} />);

		expect(screen.getByRole("button", { name: "test" }).getAttribute("aria-pressed")).toBe("true");
		expect(screen.getByRole("button", { name: "play" }).getAttribute("aria-pressed")).toBe("false");
	});
});
