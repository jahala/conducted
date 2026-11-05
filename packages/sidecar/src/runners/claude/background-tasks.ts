/**
 * @feature AGENT-02 Claude: background task tracking
 * Owns: keeping the list of background work (sub-agents, shells, other tasks) the Claude CLI
 * reports, so the runner can send it to the session manager.
 * Behaviour: research/conductor/claude-runner.md section 2 item 3 (system task_started,
 * task_notification and task_updated messages maintain a background task map; entries with
 * skip_transcript or ambient set are not activity and are left out).
 * Must handle: a notification or update for a task this process never registered (ignored), a
 * task that ends (completed, failed, killed or stopped), an update that only moves a task to the
 * background, and a CLI process restart (reset, because the level is per process).
 * Test first: task_started adds a running task, and task_notification removes it.
 * Our design choice: the list is built from the tracked tasks on every change, so the same events
 * always give the same list. task_progress is not a membership change.
 */
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { TurnCallbacks } from "../runner.ts";

export type BackgroundTask = Parameters<TurnCallbacks["onBackgroundTasks"]>[0][number];
type TaskKind = BackgroundTask["kind"];

export class ClaudeBackgroundTasks {
	private readonly tasks = new Map<string, BackgroundTask>();

	/** Applies one SDK message. Returns the new list, or null when the message changes nothing. */
	handle(message: SDKMessage): BackgroundTask[] | null {
		if (message.type !== "system") return null;
		switch (message.subtype) {
			case "task_started":
				return this.start(message);
			case "task_notification":
				return this.end(message.task_id);
			case "task_updated":
				return this.update(message);
			default:
				return null;
		}
	}

	/** A new CLI process has no tasks of its own yet. */
	reset(): void {
		this.tasks.clear();
	}

	private start(
		message: Extract<SDKMessage, { subtype: "task_started" }>,
	): BackgroundTask[] | null {
		if (message.skip_transcript === true || message.ambient === true) return null;
		this.tasks.set(message.task_id, {
			id: message.task_id,
			kind: taskKind(message),
			description: message.description,
		});
		return this.list();
	}

	private end(taskId: string): BackgroundTask[] | null {
		if (!this.tasks.delete(taskId)) return null;
		return this.list();
	}

	private update(
		message: Extract<SDKMessage, { subtype: "task_updated" }>,
	): BackgroundTask[] | null {
		const task = this.tasks.get(message.task_id);
		if (task === undefined) return null;
		const status = message.patch.status;
		if (status === "completed" || status === "failed" || status === "killed") {
			this.tasks.delete(message.task_id);
			return this.list();
		}
		if (message.patch.description !== undefined) task.description = message.patch.description;
		return this.list();
	}

	private list(): BackgroundTask[] {
		return [...this.tasks.values()];
	}
}

function taskKind(message: Extract<SDKMessage, { subtype: "task_started" }>): TaskKind {
	const type = message.task_type ?? "";
	if (message.subagent_type !== undefined || type.includes("agent")) return "sub_agent";
	if (type.includes("bash") || type.includes("shell")) return "shell";
	return "other";
}
