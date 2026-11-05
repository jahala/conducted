import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TodoBlock } from "./TodoBlock.tsx";

afterEach(cleanup);

describe("CHAT-09 todo block", () => {
	it("names how many are done and lists every item", () => {
		render(
			<TodoBlock
				item={{
					kind: "todo",
					items: [
						{ label: "First", status: "done" },
						{ label: "Second", status: "in_progress" },
						{ label: "Third", status: "pending" },
					],
				}}
			/>,
		);
		expect(screen.getByText("1 of 3 done")).toBeTruthy();
		const rows = screen.getAllByRole("listitem");
		expect(rows).toHaveLength(3);
		expect(screen.getByText("First")).toBeTruthy();
		expect(screen.getByText("Second")).toBeTruthy();
		expect(screen.getByText("Third")).toBeTruthy();
	});

	it("shows 'No todos' for an empty block", () => {
		render(<TodoBlock item={{ kind: "todo", items: [] }} />);
		expect(screen.getByText("No todos")).toBeTruthy();
	});
});
