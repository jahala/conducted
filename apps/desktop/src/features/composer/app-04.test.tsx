import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArchivedComposerBar } from "./ArchivedComposerBar.tsx";

afterEach(cleanup);

describe("APP-04 ArchivedComposerBar", () => {
	it("says the workspace is archived and calls onUnarchive", () => {
		const onUnarchive = vi.fn();
		render(<ArchivedComposerBar onUnarchive={onUnarchive} busy={false} />);
		expect(screen.getByText("This workspace is archived.")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Unarchive" }));
		expect(onUnarchive).toHaveBeenCalledTimes(1);
	});

	it("blocks a second unarchive while the first is running", () => {
		const onUnarchive = vi.fn();
		render(<ArchivedComposerBar onUnarchive={onUnarchive} busy />);
		const button = screen.getByRole("button", { name: "Unarchive" });
		expect(button.hasAttribute("disabled")).toBe(true);
		fireEvent.click(button);
		expect(onUnarchive).not.toHaveBeenCalled();
	});
});
