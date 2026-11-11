import type { CanonicalTool } from "@conducted/protocol";
import type { SessionId } from "@conducted/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { ServicesProvider } from "../../../../core/context.tsx";
import type { ToolCallView } from "../../../../core/model.ts";
import { createTestContainer, type TestContainer } from "../../../../test/container.ts";
import { ToolCard } from "../ToolCard.tsx";
import { ImageGenerationCard } from "./ImageGenerationCard.tsx";
import { ImageViewCard } from "./ImageViewCard.tsx";
import { MonitorCard } from "./MonitorCard.tsx";
import { NodeReplCard } from "./NodeReplCard.tsx";
import { ScheduleWakeupCard } from "./ScheduleWakeupCard.tsx";
import { SendMessageCard } from "./SendMessageCard.tsx";
import { TaskCreateCard } from "./TaskCreateCard.tsx";
import { TaskGetCard } from "./TaskGetCard.tsx";
import { TaskListCard } from "./TaskListCard.tsx";
import { TaskStopCard } from "./TaskStopCard.tsx";
import { TaskUpdateCard } from "./TaskUpdateCard.tsx";
import { ToolSearchCard } from "./ToolSearchCard.tsx";

const sessionId = "s1" as SessionId;

const containers: TestContainer[] = [];

afterEach(async () => {
	cleanup();
	for (const test of containers.splice(0)) {
		await test.container.stop();
		test.close();
	}
});

/** Renders a card that turns a file path into a URL through the real container's platform. */
function renderWithServices(ui: ReactElement) {
	const test = createTestContainer();
	containers.push(test);
	return render(<ServicesProvider container={test.container}>{ui}</ServicesProvider>);
}

let sequence = 0;

interface Extra {
	output?: string;
	isError?: boolean;
	rawName?: string;
}

function view(tool: CanonicalTool, input: unknown, extra: Extra = {}): ToolCallView {
	sequence += 1;
	const toolUseId = `tu-${sequence}` as ToolCallView["toolUseId"];
	return {
		toolUseId,
		item: { kind: "tool_call", toolUseId, tool, rawName: extra.rawName ?? tool, input },
		result:
			extra.output === undefined
				? null
				: {
						kind: "tool_result",
						toolUseId,
						output: extra.output,
						isError: extra.isError ?? false,
						truncated: false,
					},
		children: [],
	};
}

describe("CHAT-20 task list card", () => {
	it("renders 'No tasks' for an empty list", () => {
		render(
			<TaskListCard
				call={view("task_list", {}, { output: "[]" })}
				sessionId={sessionId}
				defaultExpanded
			/>,
		);
		expect(screen.getByText("No tasks")).toBeTruthy();
	});

	it("renders one row per task with its status and subject", () => {
		render(
			<TaskListCard
				call={view(
					"task_list",
					{},
					{ output: "#1 [pending] Write the test\n#2 [completed] Run it" },
				)}
				sessionId={sessionId}
				defaultExpanded
			/>,
		);
		expect(screen.getByText("2 tasks")).toBeTruthy();
		expect(screen.getByText("Write the test")).toBeTruthy();
		expect(screen.getByText("Run it")).toBeTruthy();
		expect(screen.getByText("pending")).toBeTruthy();
		expect(screen.getByText("completed")).toBeTruthy();
	});
});

describe("CHAT-20 start monitor card", () => {
	it("renders 'Start monitor' and the watched command", () => {
		render(
			<MonitorCard
				call={view(
					"monitor",
					{ command: "npm run dev", description: "Watch the server" },
					{ output: "monitor started" },
				)}
				sessionId={sessionId}
				defaultExpanded
			/>,
		);
		expect(screen.getByText("Start monitor")).toBeTruthy();
		expect(screen.getAllByText("npm run dev").length).toBeGreaterThan(0);
		expect(screen.getByText("Watch the server")).toBeTruthy();
	});

	it("shows Failed when the monitor ended with an error", () => {
		render(
			<MonitorCard
				call={view(
					"monitor",
					{ command: "npm run dev" },
					{ output: "no such command", isError: true },
				)}
				sessionId={sessionId}
			/>,
		);
		expect(screen.getByText("Failed")).toBeTruthy();
	});
});

describe("CHAT-20 task details card", () => {
	it("renders 'Task details' with its status and subject", () => {
		render(
			<TaskGetCard
				call={view(
					"task_get",
					{ taskId: "1" },
					{
						output:
							'{"id":"1","subject":"Write the test","status":"in_progress","blockedBy":["2"],"blocks":[]}',
					},
				)}
				sessionId={sessionId}
				defaultExpanded
			/>,
		);
		expect(screen.getByText("Task details")).toBeTruthy();
		expect(screen.getAllByText("Write the test").length).toBeGreaterThan(0);
		expect(screen.getByText("in_progress")).toBeTruthy();
		expect(screen.getByText("Status:")).toBeTruthy();
		expect(screen.getByText("Subject:")).toBeTruthy();
		expect(screen.getByText("Blocked by:")).toBeTruthy();
		expect(screen.getByText("Blocks:")).toBeTruthy();
		expect(screen.getByText("2")).toBeTruthy();
		expect(screen.getByText("None")).toBeTruthy();
		expect(screen.getByText("Task ID:")).toBeTruthy();
	});

	it("says 'Loading task...' until the task has been read", () => {
		render(
			<TaskGetCard
				call={view("task_get", { taskId: "1" })}
				sessionId={sessionId}
				defaultExpanded
			/>,
		);
		expect(screen.getByText("Loading task...")).toBeTruthy();
		expect(screen.queryByText("Status:")).toBeNull();
	});

	it("shows the agent's text when the task no longer exists", () => {
		render(
			<TaskGetCard
				call={view("task_get", { taskId: "9" }, { output: "Task not found", isError: true })}
				sessionId={sessionId}
				defaultExpanded
			/>,
		);
		expect(screen.getByText("Task not found")).toBeTruthy();
		expect(screen.getByText("Failed")).toBeTruthy();
	});
});

describe("CHAT-20 stop task card", () => {
	it("renders 'Stop task' and the task's name", () => {
		render(
			<TaskStopCard
				call={view("task_stop", { task_id: "t1", name: "Run tests" })}
				sessionId={sessionId}
				defaultExpanded
			/>,
		);
		expect(screen.getByText("Stop task")).toBeTruthy();
		expect(screen.getAllByText("Run tests").length).toBeGreaterThan(0);
	});
});

describe("CHAT-20 schedule wake-up card", () => {
	it("shows when the agent will wake up", () => {
		render(
			<ScheduleWakeupCard
				call={view("schedule_wakeup", { delay_seconds: 300, reason: "Check the build" })}
				sessionId={sessionId}
				defaultExpanded
			/>,
		);
		expect(screen.getByText("Schedule wakeup")).toBeTruthy();
		expect(screen.getAllByText(/5 minutes/).length).toBeGreaterThan(0);
		expect(screen.getByText("Check the build")).toBeTruthy();
	});

	it("names a wake-up time that is in the past", () => {
		render(
			<ScheduleWakeupCard
				call={view("schedule_wakeup", { delay_seconds: -1 })}
				sessionId={sessionId}
			/>,
		);
		// A call with no result yet is running, so its card is open (CHAT-08): the header summary and
		// the body both name the time.
		expect(screen.getAllByText("Wake-up time is in the past")).toHaveLength(2);
	});

	it("shows an absolute wake-up time as a time, whenever the chat is read", () => {
		// 2001 is long past on any clock that reads this chat, and must still not be judged as past.
		const at = Date.UTC(2001, 0, 2, 3, 4);
		render(
			<ScheduleWakeupCard
				call={view("schedule_wakeup", { wake_at: String(at) })}
				sessionId={sessionId}
				defaultExpanded
			/>,
		);
		expect(
			screen.getAllByText(`Wake up at ${new Date(at).toLocaleString()}`).length,
		).toBeGreaterThan(0);
		expect(screen.queryByText(/in the past/i)).toBeNull();
	});

	it("marks a cancelled wake-up", () => {
		render(
			<ScheduleWakeupCard
				call={view("schedule_wakeup", { cancelled: true, reason: "No longer needed" })}
				sessionId={sessionId}
				defaultExpanded
			/>,
		);
		expect(screen.getByText("Wake-up cancelled")).toBeTruthy();
		expect(screen.getByText("This wake-up was cancelled.")).toBeTruthy();
	});
});

describe("CHAT-20 preview image card", () => {
	it("renders 'Preview image' with the file name", () => {
		renderWithServices(
			<ImageViewCard
				call={view(
					"image_view",
					{ path: "/work/screens/a.png" },
					{ output: "/work/screens/a.png" },
				)}
				sessionId={sessionId}
				defaultExpanded
			/>,
		);
		expect(screen.getByText("Preview image")).toBeTruthy();
		expect(screen.getAllByText("a.png").length).toBeGreaterThan(0);
		expect(screen.getByRole("img", { name: "a.png" })).toBeTruthy();
	});

	it("keeps the name and says so when the image cannot be loaded", () => {
		renderWithServices(
			<ImageViewCard
				call={view("image_view", { path: "/work/gone.png" }, { output: "/work/gone.png" })}
				sessionId={sessionId}
				defaultExpanded
			/>,
		);
		fireEvent.error(screen.getByRole("img", { name: "gone.png" }));
		expect(screen.getByText("Failed to load image")).toBeTruthy();
		expect(screen.queryByRole("img")).toBeNull();
	});

	it("does not take a result that is not a path as the image", () => {
		renderWithServices(
			<ImageViewCard
				call={view("image_view", {}, { output: "done" })}
				sessionId={sessionId}
				defaultExpanded
			/>,
		);
		expect(screen.queryByRole("img")).toBeNull();
		expect(screen.getByText("No image path was given.")).toBeTruthy();
	});

	it("takes the path the result names when the input has none", () => {
		renderWithServices(
			<ImageViewCard
				call={view("image_view", {}, { output: "Read the image\n/work/shots/plot" })}
				sessionId={sessionId}
				defaultExpanded
			/>,
		);
		expect(screen.getByRole("img", { name: "plot" }).getAttribute("src")).toBe(
			"asset://localhost/%2Fwork%2Fshots%2Fplot",
		);
	});

	it("says 'Loading image' while the image is still being read", () => {
		renderWithServices(
			<ImageViewCard call={view("image_view", { path: "/work/a.png" })} sessionId={sessionId} />,
		);
		expect(screen.getByText("Loading image")).toBeTruthy();
	});
});

describe("CHAT-20 task update card", () => {
	it("shows the subject and the new status when a task is marked done", () => {
		renderWithServices(
			<TaskUpdateCard
				call={view(
					"task_update",
					{ taskId: "1", subject: "Write the test", status: "completed" },
					{ output: "Updated task #1 status" },
				)}
				sessionId={sessionId}
				defaultExpanded
			/>,
		);
		expect(screen.getByText("Task details")).toBeTruthy();
		expect(screen.getAllByText("Write the test").length).toBeGreaterThan(0);
		expect(screen.getByText("completed")).toBeTruthy();
	});

	it("reads the subject from the result for a status-only change", () => {
		renderWithServices(
			<TaskUpdateCard
				call={view(
					"task_update",
					{ taskId: "1", status: "completed" },
					{ output: '{"id":"1","subject":"Run the tests","status":"completed"}' },
				)}
				sessionId={sessionId}
				defaultExpanded
			/>,
		);
		expect(screen.getAllByText("Run the tests").length).toBeGreaterThan(0);
		expect(screen.getByText("completed")).toBeTruthy();
	});
});

describe("CHAT-20 send message card", () => {
	it("names the chat it went to", () => {
		renderWithServices(
			<SendMessageCard
				call={view(
					"send_message",
					{ targetChat: "Design chat", message: "Please review the plan" },
					{ output: "Message sent" },
				)}
				sessionId={sessionId}
				defaultExpanded
			/>,
		);
		expect(screen.getByText("Send message")).toBeTruthy();
		expect(screen.getByText("To:")).toBeTruthy();
		expect(screen.getAllByText("Design chat").length).toBeGreaterThan(0);
		expect(screen.getByText("Please review the plan")).toBeTruthy();
	});
});

describe("CHAT-20 task created card", () => {
	it("renders 'Task created' and the task subject", () => {
		renderWithServices(
			<TaskCreateCard
				call={view(
					"task_create",
					{ subject: "Write the test", description: "Cover the card" },
					{ output: "Task #1 created successfully" },
				)}
				sessionId={sessionId}
				defaultExpanded
			/>,
		);
		expect(screen.getByText("Task created")).toBeTruthy();
		expect(screen.getAllByText("Write the test").length).toBeGreaterThan(0);
		expect(screen.getByText("Cover the card")).toBeTruthy();
	});
});

describe("CHAT-20 image generation card", () => {
	it("shows the image preview when generation finished", () => {
		renderWithServices(
			<ImageGenerationCard
				call={view(
					"image_generation",
					{ prompt: "a cat" },
					{ output: "/work/.context/images/cat.png" },
				)}
				sessionId={sessionId}
				defaultExpanded
			/>,
		);
		expect(screen.getByText("Preview image")).toBeTruthy();
		expect(screen.getByRole("img", { name: "cat.png" }).getAttribute("src")).toBe(
			"asset://localhost/%2Fwork%2F.context%2Fimages%2Fcat.png",
		);
		expect(screen.getByText("a cat")).toBeTruthy();
	});

	it("shows 'Loading image' while generation runs", () => {
		renderWithServices(
			<ImageGenerationCard
				call={view("image_generation", { prompt: "a cat" })}
				sessionId={sessionId}
			/>,
		);
		expect(screen.getAllByText("Loading image").length).toBeGreaterThan(0);
	});
});

describe("CHAT-20 node REPL card", () => {
	it("renders 'Node REPL' with the code and its output", () => {
		render(
			<NodeReplCard
				call={view("node_repl", { code: "1 + 1" }, { output: "2" })}
				sessionId={sessionId}
				defaultExpanded
			/>,
		);
		expect(screen.getByText("Node REPL")).toBeTruthy();
		expect(screen.getByText("1 + 1")).toBeTruthy();
		expect(screen.getByText("2")).toBeTruthy();
	});
});

describe("CHAT-20 search tools card", () => {
	it("renders 'Search tools' and the query", () => {
		render(
			<ToolSearchCard
				call={view("tool_search", { query: "linear" }, { output: "linear.create\nlinear.list" })}
				sessionId={sessionId}
				defaultExpanded
			/>,
		);
		expect(screen.getByText("Search tools")).toBeTruthy();
		expect(screen.getAllByText("linear").length).toBeGreaterThan(0);
		expect(screen.getByText(/linear\.create/)).toBeTruthy();
	});

	it("says 'No tools found' when the search found none", () => {
		render(
			<ToolSearchCard
				call={view("tool_search", { query: "nothing" }, { output: "" })}
				sessionId={sessionId}
				defaultExpanded
			/>,
		);
		expect(screen.getByText("No tools found")).toBeTruthy();
	});
});

describe("CHAT-20 tool cards in the real container", () => {
	it("routes every new tool through the real tool card registry", async () => {
		const test = createTestContainer();
		try {
			const cases: { tool: CanonicalTool; input: unknown; output: string; title: string }[] = [
				{ tool: "task_list", input: {}, output: "[]", title: "No tasks" },
				{
					tool: "monitor",
					input: { command: "npm run dev" },
					output: "started",
					title: "Start monitor",
				},
				{
					tool: "task_get",
					input: { taskId: "1" },
					output: '{"subject":"One","status":"pending"}',
					title: "Task details",
				},
				{
					tool: "task_stop",
					input: { task_id: "t1", name: "Run tests" },
					output: "stopped",
					title: "Stop task",
				},
				{
					tool: "schedule_wakeup",
					input: { delay_seconds: 60 },
					output: "scheduled",
					title: "Schedule wakeup",
				},
				{
					tool: "image_view",
					input: { path: "/work/a.png" },
					output: "/work/a.png",
					title: "Preview image",
				},
				{
					tool: "task_update",
					input: { taskId: "1", status: "completed" },
					output: "updated",
					title: "Task details",
				},
				{
					tool: "send_message",
					input: { target: "Design chat", message: "hi" },
					output: "sent",
					title: "Send message",
				},
				{
					tool: "task_create",
					input: { subject: "Write it" },
					output: "created",
					title: "Task created",
				},
				{
					tool: "image_generation",
					input: { prompt: "a cat" },
					output: "/work/cat.png",
					title: "Preview image",
				},
				{ tool: "node_repl", input: { code: "1 + 1" }, output: "2", title: "Node REPL" },
				{
					tool: "tool_search",
					input: { query: "linear" },
					output: "linear",
					title: "Search tools",
				},
			];
			for (const entry of cases) {
				const rendered = render(
					<ServicesProvider container={test.container}>
						<ToolCard
							call={view(entry.tool, entry.input, { output: entry.output })}
							sessionId={sessionId}
						/>
					</ServicesProvider>,
				);
				expect(screen.getByText(entry.title)).toBeTruthy();
				rendered.unmount();
			}
		} finally {
			await test.container.stop();
			test.close();
		}
	});
});
