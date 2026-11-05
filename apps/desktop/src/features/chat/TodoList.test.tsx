import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TodoList } from "./TodoList.tsx";

afterEach(cleanup);

describe("CHAT-09 todo list", () => {
	it("renders three rows with pending, in progress and done states", () => {
		render(
			<TodoList
				items={[
					{ label: "Write the test", status: "pending" },
					{ label: "Build the list", status: "in_progress" },
					{ label: "Ship it", status: "done" },
				]}
			/>,
		);
		const rows = screen.getAllByRole("listitem");
		expect(rows).toHaveLength(3);
		expect(rows[0]?.getAttribute("data-status")).toBe("pending");
		expect(rows[1]?.getAttribute("data-status")).toBe("in_progress");
		expect(rows[2]?.getAttribute("data-status")).toBe("done");
		expect(rows[0]?.textContent).toContain("Write the test");
		expect(rows[0]?.textContent).toContain("pending");
		expect(rows[1]?.textContent).toContain("Build the list");
		expect(rows[1]?.textContent).toContain("in progress");
		expect(rows[2]?.textContent).toContain("Ship it");
		expect(rows[2]?.textContent).toContain("done");
	});

	it("shows 'No todos' when the list is empty", () => {
		render(<TodoList items={[]} />);
		expect(screen.getByText("No todos")).toBeTruthy();
		expect(screen.queryAllByRole("listitem")).toHaveLength(0);
	});
});
