import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type DiagnosticsAction, DiagnosticsActions } from "./DiagnosticsActions.tsx";

afterEach(cleanup);

describe("APP-03 diagnostics actions", () => {
	// The labels are Conductor's: "Copy report" and "Ask agent to analyze redacted report"
	// (renderApp @10610669 and @10611428, byte offsets).
	it("calls onAction with the id of the button that was pressed", () => {
		const actions: DiagnosticsAction[] = [];
		render(
			<DiagnosticsActions
				busy={null}
				canStartChat
				agentsWorking={false}
				onAction={(action) => actions.push(action)}
			/>,
		);

		for (const name of [
			"Copy redacted report",
			"Copy report",
			"Ask agent to analyze redacted report",
			"Copy logs (may include personal data)",
			"Restart",
		]) {
			fireEvent.click(screen.getByRole("button", { name }));
		}

		expect(actions).toEqual(["copy_redacted", "copy_full", "start_chat", "copy_logs", "restart"]);
	});

	it("disables every other action while one is busy", () => {
		const onAction = vi.fn();
		render(<DiagnosticsActions busy="copy_logs" canStartChat agentsWorking onAction={onAction} />);

		expect(
			(
				screen.getByRole("button", {
					name: "Copy logs (may include personal data)",
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
		for (const name of ["Copy redacted report", "Copy report", "Restart"]) {
			expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
		}
	});

	it("disables the chat action when there is no workspace", () => {
		render(
			<DiagnosticsActions
				busy={null}
				canStartChat={false}
				agentsWorking={false}
				onAction={() => {}}
			/>,
		);

		expect(
			(
				screen.getByRole("button", {
					name: "Ask agent to analyze redacted report",
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
	});
});
