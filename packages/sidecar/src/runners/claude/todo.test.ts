import { describe, expect, test } from "bun:test";
import { todoItemFromTodoWrite } from "./todo.ts";

describe("AGENT-03 Claude todo lists", () => {
	test("statuses map to the neutral ones and content becomes the label", () => {
		expect(
			todoItemFromTodoWrite({
				todos: [
					{ content: "Write tests", status: "completed", activeForm: "Writing tests" },
					{ content: "Fix bug", status: "in_progress", activeForm: "Fixing bug" },
					{ content: "Ship", status: "weird", activeForm: "Shipping" },
					{ status: "pending" },
				],
			}),
		).toEqual({
			kind: "todo",
			items: [
				{ label: "Write tests", status: "done" },
				{ label: "Fix bug", status: "in_progress" },
				{ label: "Ship", status: "pending" },
			],
		});
	});

	test("input without a todos array is not a todo item", () => {
		expect(todoItemFromTodoWrite(null)).toBeNull();
		expect(todoItemFromTodoWrite({})).toBeNull();
		expect(todoItemFromTodoWrite({ todos: [] })).toEqual({ kind: "todo", items: [] });
	});
});
