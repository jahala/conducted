/**
 * @feature CHAT-20 Background task row
 * The row of a task the agent started in the background, in Conductor's words (main @1420230).
 */
import type { ToolUseId } from "@conducted/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BackgroundTaskRow } from "./BackgroundTaskRow.tsx";

afterEach(cleanup);

describe("CHAT-20 a task started in the background", () => {
	it("a background task shows its description and opens to the command that started it", () => {
		render(
			<BackgroundTaskRow
				item={{
					kind: "background_task",
					taskId: "task-1",
					description: "Watch the test run",
					prompt: "Say when the suite ends",
					toolUseId: "bash-1" as ToolUseId,
				}}
				source={{
					kind: "tool_call",
					toolUseId: "bash-1" as ToolUseId,
					tool: "bash",
					rawName: "Bash",
					input: { command: "pnpm test --watch" },
				}}
			/>,
		);
		expect(screen.getByText("Background Task")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: /Background Task/ }));
		expect(screen.getByText("Command")).toBeTruthy();
		expect(screen.getByText("pnpm test --watch")).toBeTruthy();
		expect(screen.getByText("Prompt")).toBeTruthy();
		expect(screen.getByText("Say when the suite ends")).toBeTruthy();
	});

	it("a task with nothing more to show does not open", () => {
		render(
			<BackgroundTaskRow item={{ kind: "background_task", taskId: "task-2" }} source={null} />,
		);
		expect(screen.getByText("Background Task")).toBeTruthy();
		expect(screen.queryByRole("button")).toBeNull();
	});
});
