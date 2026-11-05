import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TerminalCommandBar } from "./TerminalCommandBar.tsx";

afterEach(() => {
	cleanup();
});

describe("COMP-06 terminal command bar", () => {
	it("names the running command and calls onDone once when Done is clicked", () => {
		const onDone = vi.fn();
		render(<TerminalCommandBar command="mcp" onDone={onDone} />);

		expect(screen.getByText("Complete /mcp below, then click done")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Done" }));
		expect(onDone).toHaveBeenCalledTimes(1);
	});

	it("offers to reopen a terminal the user closed early", () => {
		const onReopen = vi.fn();
		render(
			<TerminalCommandBar command="/hooks" onDone={vi.fn()} terminalClosed onReopen={onReopen} />,
		);

		expect(screen.getByText("Run /hooks in the embedded terminal")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Reopen terminal" }));
		expect(onReopen).toHaveBeenCalledTimes(1);
	});

	it("shows the finished text once the command exits", () => {
		render(<TerminalCommandBar command="agents" onDone={vi.fn()} phase="finished" />);

		expect(
			screen.getByText("Terminal command finished. Refresh to use the updated config here"),
		).toBeTruthy();
	});

	it("shows the command's own error", () => {
		render(
			<TerminalCommandBar
				command="permissions"
				onDone={vi.fn()}
				error="The config file could not be parsed"
			/>,
		);

		expect(screen.getByText("The config file could not be parsed")).toBeTruthy();
	});
});
