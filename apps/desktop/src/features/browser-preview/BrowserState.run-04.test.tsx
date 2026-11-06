/**
 * @feature RUN-04 Browser tab states
 * Owns: tests for the designed full-tab states and their single action.
 * Test first: kind "server_not_running" shows an action that calls onAction.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserState } from "./BrowserState.tsx";

afterEach(cleanup);

describe("RUN-04 browser tab states", () => {
	it("kind server_not_running shows an action that calls onAction", () => {
		const onAction = vi.fn();
		render(<BrowserState kind="server_not_running" detail={null} onAction={onAction} />);

		expect(screen.getByText("No local servers running.")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));

		expect(onAction).toHaveBeenCalledOnce();
	});

	it("kind starting shows the starting message and no action", () => {
		render(<BrowserState kind="starting" detail={null} onAction={() => {}} />);

		expect(screen.getByText("Starting preview...")).toBeTruthy();
		expect(screen.queryByRole("button")).toBeNull();
	});

	it("kind load_failed shows the detail and a Retry action", () => {
		const onAction = vi.fn();
		render(
			<BrowserState
				kind="load_failed"
				detail="The connection to localhost:5173 was refused."
				onAction={onAction}
			/>,
		);

		expect(screen.getByText("The connection to localhost:5173 was refused.")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		expect(onAction).toHaveBeenCalledOnce();
	});

	it("kind preview_off offers opening the page outside the app", () => {
		const onAction = vi.fn();
		render(<BrowserState kind="preview_off" detail={null} onAction={onAction} />);

		fireEvent.click(screen.getByRole("button", { name: "Open preview in browser" }));

		expect(onAction).toHaveBeenCalledOnce();
	});

	it("kind archived offers unarchiving the workspace", () => {
		const onAction = vi.fn();
		render(<BrowserState kind="archived" detail={null} onAction={onAction} />);

		fireEvent.click(screen.getByRole("button", { name: "Unarchive" }));

		expect(onAction).toHaveBeenCalledOnce();
	});
});
