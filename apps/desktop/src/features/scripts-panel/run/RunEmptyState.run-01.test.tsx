/**
 * @feature RUN-01 Run empty state
 * Owns: tests for the three ways to add a run action and the disabled agent route.
 * Test first: the Add action button calls onAddAction.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RunEmptyState } from "./RunEmptyState.tsx";

afterEach(cleanup);

describe("RUN-01 run empty state", () => {
	it("calls onAddAction from the Add action button", () => {
		const onAddAction = vi.fn();
		render(
			<RunEmptyState
				canAskAgent={false}
				onAskAgent={() => {}}
				onAddAction={onAddAction}
				onConfigure={() => {}}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Add action" }));

		expect(onAddAction).toHaveBeenCalledTimes(1);
		expect(
			screen.getByText("Run tests or a development server to test changes in this workspace."),
		).toBeTruthy();
	});

	it("offers the manual and configure routes", () => {
		const onConfigure = vi.fn();
		render(
			<RunEmptyState
				canAskAgent={false}
				onAskAgent={() => {}}
				onAddAction={() => {}}
				onConfigure={onConfigure}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Add action manually" }));
		fireEvent.click(screen.getByRole("button", { name: "Configure actions" }));

		expect(onConfigure).toHaveBeenCalledTimes(2);
	});

	it("disables the agent route without a chat", () => {
		render(
			<RunEmptyState
				canAskAgent={false}
				onAskAgent={() => {}}
				onAddAction={() => {}}
				onConfigure={() => {}}
			/>,
		);

		expect((screen.getByRole("button", { name: "Ask agent" }) as HTMLButtonElement).disabled).toBe(
			true,
		);
	});
});
