/**
 * @feature WS-03 Setup empty state
 * Owns: tests for the two ways to add a setup script, and for a script that has not run yet.
 * Test first: with no script, both actions show; with a script that has not run, neither does.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SetupEmptyState } from "./SetupEmptyState.tsx";

afterEach(cleanup);

describe("WS-03 setup empty state", () => {
	it("offers Ask agent and Add manually when there is no script", () => {
		const onAskAgent = vi.fn();
		const onAddManually = vi.fn();
		render(
			<SetupEmptyState
				hasScript={false}
				canAskAgent
				onAskAgent={onAskAgent}
				onAddManually={onAddManually}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Ask agent" }));
		fireEvent.click(screen.getByRole("button", { name: "Add manually" }));
		expect(onAskAgent).toHaveBeenCalledTimes(1);
		expect(onAddManually).toHaveBeenCalledTimes(1);
	});

	it("disables Ask agent when the tab says the agent cannot be asked", () => {
		render(
			<SetupEmptyState
				hasScript={false}
				canAskAgent={false}
				onAskAgent={() => {}}
				onAddManually={() => {}}
			/>,
		);

		expect((screen.getByRole("button", { name: "Ask agent" }) as HTMLButtonElement).disabled).toBe(
			true,
		);
	});

	it("shows neither action when a script exists but has not run", () => {
		render(
			<SetupEmptyState hasScript canAskAgent onAskAgent={() => {}} onAddManually={() => {}} />,
		);

		expect(screen.queryByRole("button", { name: "Ask agent" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Add manually" })).toBeNull();
	});
});
