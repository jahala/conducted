/**
 * @feature AGENT-03 Claude: translate SDK messages to the neutral format (todo lists)
 * Owns: turning the input of Claude's TodoWrite tool into a neutral todo item.
 * Behaviour: research/conductor/other-runners.md section 3 (the todo list is a first-class tool
 * card) and the installed SDK's TodoWriteInput type: { todos: [{ content, status, activeForm }] }
 * with status pending, in_progress or completed.
 * Must handle: input that is not an object or has no todos array (null, so the caller keeps the
 * plain tool call), an entry without content (skipped), an unknown status (treated as pending),
 * and an empty list (a todo item with no entries, which clears the list in the UI).
 * Test first: one completed and one in_progress entry map to done and in_progress with their
 * content as the label.
 * Our design choice: the label is `content`, the imperative text. `activeForm` ("Running tests")
 * is shown by Claude's own UI while a task runs; ours shows the label only.
 */
import type { AgentItem } from "@conducted/protocol";

type TodoItem = Extract<AgentItem, { kind: "todo" }>;

export function todoItemFromTodoWrite(input: unknown): TodoItem | null {
	if (!input || typeof input !== "object") return null;
	const todos = (input as { todos?: unknown }).todos;
	if (!Array.isArray(todos)) return null;
	const items: TodoItem["items"] = [];
	for (const entry of todos) {
		if (!entry || typeof entry !== "object") continue;
		const { content, status } = entry as { content?: unknown; status?: unknown };
		if (typeof content !== "string" || content === "") continue;
		items.push({
			label: content,
			status:
				status === "completed" ? "done" : status === "in_progress" ? "in_progress" : "pending",
		});
	}
	return { kind: "todo", items };
}
