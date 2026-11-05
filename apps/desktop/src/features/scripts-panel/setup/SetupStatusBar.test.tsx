/**
 * @feature WS-03 Setup status bar
 * Owns: tests for the state words and the primary action each kind shows.
 * Test first: kind "running" shows a Stop action and kind "completed" shows Run again.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SetupStatusBar } from "./SetupStatusBar.tsx";

afterEach(cleanup);

const props = {
	exitCode: null,
	interruptedReason: null,
	busy: false,
	onStop: () => {},
	onRunAgain: () => {},
	onAskAgentToFix: () => {},
};

describe("WS-03 setup status bar", () => {
	it("shows Stop while the script is running", () => {
		const onStop = vi.fn();
		render(<SetupStatusBar {...props} kind="running" onStop={onStop} />);

		expect(screen.getByText("Running setup script...")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Stop" }));
		expect(onStop).toHaveBeenCalledTimes(1);
	});

	it("shows Run again when the script completed", () => {
		const onRunAgain = vi.fn();
		render(<SetupStatusBar {...props} kind="completed" onRunAgain={onRunAgain} />);

		expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Run again" }));
		expect(onRunAgain).toHaveBeenCalledTimes(1);
	});

	it("shows the exit code and the fix action for a failure", () => {
		render(<SetupStatusBar {...props} kind="failed" exitCode={2} />);

		expect(screen.getByText("Setup script failed")).toBeTruthy();
		expect(screen.getByText("Exit code 2")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Ask agent to fix" })).toBeTruthy();
	});

	it("shows the interrupted reason and disables actions while busy", () => {
		render(
			<SetupStatusBar
				{...props}
				kind="failed"
				interruptedReason="The app quit while setup was running."
				busy
			/>,
		);

		expect(screen.getByText("The app quit while setup was running.")).toBeTruthy();
		expect((screen.getByRole("button", { name: "Run again" }) as HTMLButtonElement).disabled).toBe(
			true,
		);
	});
});
