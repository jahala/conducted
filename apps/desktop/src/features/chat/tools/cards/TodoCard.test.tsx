import type { SessionId } from "@conducted/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ToolCallView } from "../../../../core/model.ts";
import { TodoCard } from "./TodoCard.tsx";

afterEach(cleanup);

const sessionId = "s1" as SessionId;

let sequence = 0;

function view(
	input: unknown,
	{ rawName = "TodoWrite", output }: { rawName?: string; output?: string } = {},
): ToolCallView {
	sequence += 1;
	const toolUseId = `tu-${sequence}` as ToolCallView["toolUseId"];
	return {
		toolUseId,
		item: { kind: "tool_call", toolUseId, tool: "todo", rawName, input },
		result:
			output === undefined
				? null
				: { kind: "tool_result", toolUseId, output, isError: false, truncated: false },
		blocks: [],
	};
}

describe("CHAT-09 todo card", () => {
	it("renders two rows through the shared list", () => {
		render(
			<TodoCard
				call={view({
					items: [
						{ label: "Write the test", status: "pending" },
						{ label: "Run the test", status: "done" },
					],
				})}
				sessionId={sessionId}
				defaultExpanded
			/>,
		);
		const rows = screen.getAllByRole("listitem");
		expect(rows).toHaveLength(2);
		expect(rows[0]?.textContent).toContain("Write the test");
		expect(rows[1]?.textContent).toContain("Run the test");
	});

	it("shows 'Todo started' while work remains", () => {
		render(
			<TodoCard
				call={view({ items: [{ label: "One", status: "in_progress" }] })}
				sessionId={sessionId}
				defaultExpanded
			/>,
		);
		expect(screen.getByText("Todo started")).toBeTruthy();
	});

	it("shows 'Todo completed' when every item is done", () => {
		render(
			<TodoCard
				call={view({ items: [{ label: "One", status: "done" }] })}
				sessionId={sessionId}
				defaultExpanded
			/>,
		);
		expect(screen.getByText("Todo completed")).toBeTruthy();
	});

	it("shows 'No todos' for an empty list", () => {
		render(<TodoCard call={view({ items: [] })} sessionId={sessionId} defaultExpanded />);
		expect(screen.getByText("No todos")).toBeTruthy();
	});

	it("falls back to the generic card when the input has no list", () => {
		render(
			<TodoCard
				call={view({}, { rawName: "TodoRead", output: "current list" })}
				sessionId={sessionId}
				defaultExpanded
			/>,
		);
		expect(screen.getByText("TodoRead")).toBeTruthy();
		expect(screen.getByText("current list")).toBeTruthy();
	});

	it("falls back to the generic card for a status outside the neutral set", () => {
		render(
			<TodoCard
				call={view(
					{ items: [{ label: "One", status: "running" }] },
					{ rawName: "TodoWrite", output: "raw call" },
				)}
				sessionId={sessionId}
				defaultExpanded
			/>,
		);
		expect(screen.queryAllByRole("listitem")).toHaveLength(0);
		expect(screen.getByText("TodoWrite")).toBeTruthy();
		expect(screen.getByText("raw call")).toBeTruthy();
	});

	it("falls back to the generic card when an entry has no label", () => {
		render(
			<TodoCard
				call={view(
					{ items: [{ status: "pending" }] },
					{ rawName: "TodoWrite", output: "raw call" },
				)}
				sessionId={sessionId}
				defaultExpanded
			/>,
		);
		expect(screen.queryAllByRole("listitem")).toHaveLength(0);
		expect(screen.getByText("TodoWrite")).toBeTruthy();
		expect(screen.getByText("raw call")).toBeTruthy();
	});
});
