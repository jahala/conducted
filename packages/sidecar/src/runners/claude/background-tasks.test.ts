import { describe, expect, test } from "bun:test";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { ClaudeBackgroundTasks } from "./background-tasks.ts";

function started(options: {
	taskId: string;
	description: string;
	taskType?: string;
	subagentType?: string;
	skipTranscript?: boolean;
	ambient?: boolean;
}): SDKMessage {
	return {
		type: "system",
		subtype: "task_started",
		task_id: options.taskId,
		description: options.description,
		...(options.taskType === undefined ? {} : { task_type: options.taskType }),
		...(options.subagentType === undefined ? {} : { subagent_type: options.subagentType }),
		...(options.skipTranscript === undefined ? {} : { skip_transcript: options.skipTranscript }),
		...(options.ambient === undefined ? {} : { ambient: options.ambient }),
		uuid: "u",
		session_id: "s1",
	} as unknown as SDKMessage;
}

function notification(taskId: string, status: "completed" | "failed" | "stopped"): SDKMessage {
	return {
		type: "system",
		subtype: "task_notification",
		task_id: taskId,
		status,
		output_file: "/tmp/out",
		summary: "done",
		uuid: "u",
		session_id: "s1",
	} as unknown as SDKMessage;
}

function updated(taskId: string, patch: { status?: string; description?: string }): SDKMessage {
	return {
		type: "system",
		subtype: "task_updated",
		task_id: taskId,
		patch,
		uuid: "u",
		session_id: "s1",
	} as unknown as SDKMessage;
}

describe("AGENT-02 background tasks", () => {
	test("a started task joins the list, a notification removes it", () => {
		const tasks = new ClaudeBackgroundTasks();

		expect(
			tasks.handle(started({ taskId: "a", description: "Run tests", taskType: "local_bash" })),
		).toEqual([{ id: "a", kind: "shell", description: "Run tests" }]);
		expect(tasks.handle(notification("a", "completed"))).toEqual([]);
	});

	test("a sub-agent is classified as a sub-agent and an unknown type as other", () => {
		const tasks = new ClaudeBackgroundTasks();
		tasks.handle(
			started({
				taskId: "a",
				description: "Research",
				subagentType: "Explore",
			}),
		);
		tasks.handle(started({ taskId: "b", description: "Watch", taskType: "mcp_task" }));

		expect(tasks.handle(updated("a", { description: "Research done" }))).toEqual([
			{ id: "a", kind: "sub_agent", description: "Research done" },
			{ id: "b", kind: "other", description: "Watch" },
		]);
	});

	test("an update that ends a task removes it", () => {
		const tasks = new ClaudeBackgroundTasks();
		tasks.handle(started({ taskId: "a", description: "Run tests", taskType: "local_bash" }));

		expect(tasks.handle(updated("a", { status: "killed" }))).toEqual([]);
	});

	test("ambient and skip-transcript tasks are not activity", () => {
		const tasks = new ClaudeBackgroundTasks();

		expect(
			tasks.handle(started({ taskId: "a", description: "Housekeeping", skipTranscript: true })),
		).toBeNull();
		expect(
			tasks.handle(started({ taskId: "b", description: "Watcher", ambient: true })),
		).toBeNull();
	});

	test("a notification for an untracked task changes nothing", () => {
		const tasks = new ClaudeBackgroundTasks();
		expect(tasks.handle(notification("missing", "failed"))).toBeNull();
	});

	test("reset clears the list for a new process", () => {
		const tasks = new ClaudeBackgroundTasks();
		tasks.handle(started({ taskId: "a", description: "Run tests", taskType: "local_bash" }));
		tasks.reset();
		expect(
			tasks.handle(started({ taskId: "b", description: "New", taskType: "local_bash" })),
		).toEqual([{ id: "b", kind: "shell", description: "New" }]);
	});
});
