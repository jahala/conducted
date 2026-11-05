/**
 * @feature RUN-06 Terminal ended banner
 * Owns: tests for the exit notice and the New terminal action.
 * Test first: exit code 1 shows the code, and the New terminal action calls onNewTerminal.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TerminalEndedBanner } from "./TerminalEndedBanner.tsx";

afterEach(cleanup);

describe("RUN-06 terminal ended banner", () => {
	it("shows a non-zero exit code and starts a new terminal on request", () => {
		const onNewTerminal = vi.fn();
		render(<TerminalEndedBanner exitCode={1} canStartNew onNewTerminal={onNewTerminal} />);
		expect(screen.getByText("Shell exited with status 1.")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "New terminal" }));
		expect(onNewTerminal).toHaveBeenCalledTimes(1);
	});

	it("shows exit code 0", () => {
		render(<TerminalEndedBanner exitCode={0} canStartNew onNewTerminal={vi.fn()} />);
		expect(screen.getByText("Shell exited with status 0.")).toBeTruthy();
	});

	it("says when the exit code is unknown", () => {
		render(<TerminalEndedBanner exitCode={null} canStartNew onNewTerminal={vi.fn()} />);
		expect(screen.getByText("Shell exited without an exit code.")).toBeTruthy();
	});

	it("disables New terminal at the limit and names the limit", () => {
		render(
			<TerminalEndedBanner
				exitCode={1}
				canStartNew={false}
				terminalLimit={5}
				onNewTerminal={vi.fn()}
			/>,
		);
		const button = screen.getByRole("button", { name: "New terminal" }) as HTMLButtonElement;
		expect(button.disabled).toBe(true);
		expect(screen.getByText("Maximum 5 terminals allowed")).toBeTruthy();
	});

	it("does not name a limit when the limit is not the reason", () => {
		render(<TerminalEndedBanner exitCode={1} canStartNew={false} onNewTerminal={vi.fn()} />);
		expect(screen.queryByText(/Maximum/)).toBeNull();
	});

	it("restarts the finished shell on request", () => {
		const onRestart = vi.fn();
		render(
			<TerminalEndedBanner
				exitCode={1}
				canStartNew={false}
				onNewTerminal={vi.fn()}
				onRestart={onRestart}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Restart" }));
		expect(onRestart).toHaveBeenCalledTimes(1);
	});
});
