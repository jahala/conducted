import { describe, expect, it } from "vitest";
import type { WorkspaceStatus } from "../../core/model.ts";
import { statusText } from "./status-text.ts";

describe("NAV-03 statusText", () => {
	it.each<[WorkspaceStatus, string, string]>([
		[{ kind: "lifecycle", label: "unstarted" }, "Unstarted", "neutral"],
		[{ kind: "lifecycle", label: "initializing" }, "Initializing…", "active"],
		[{ kind: "lifecycle", label: "setting_up" }, "Setting up…", "active"],
		[{ kind: "lifecycle", label: "failed" }, "Initialization failed", "danger"],
		[{ kind: "lifecycle", label: "archiving" }, "Archiving…", "active"],
		[{ kind: "agent", label: "needs_plan_review" }, "Review plan", "attention"],
		[{ kind: "agent", label: "needs_permission" }, "Need permission", "attention"],
		[{ kind: "agent", label: "needs_answer" }, "Answer question", "attention"],
		[{ kind: "agent", label: "working" }, "Working…", "active"],
		[{ kind: "agent", label: "cancelling" }, "Cancelling…", "active"],
		[{ kind: "agent", label: "waiting" }, "Waiting…", "active"],
		[{ kind: "git", label: "merged" }, "Merged", "success"],
		[{ kind: "git", label: "in_merge_queue" }, "In merge queue", "active"],
		[{ kind: "git", label: "ready_to_merge" }, "Ready to merge", "success"],
		[{ kind: "git", label: "draft_pr" }, "Draft pull request", "neutral"],
		[{ kind: "git", label: "merge_conflict" }, "Merge conflict", "danger"],
		[{ kind: "git", label: "checks_failing" }, "Checks failing", "danger"],
		[{ kind: "git", label: "checks_running" }, "Checks running", "active"],
		[{ kind: "git", label: "pr_open" }, "Pull request open", "neutral"],
		[{ kind: "git", label: "changes" }, "Changes", "neutral"],
		[{ kind: "git", label: "clean" }, "Ready", "neutral"],
	])("gives %j the word %s and tone %s", (status, text, tone) => {
		expect(statusText(status)).toEqual({ text, tone });
	});

	it("asks for attention when the agent needs permission", () => {
		expect(statusText({ kind: "agent", label: "needs_permission" })).toEqual({
			text: "Need permission",
			tone: "attention",
		});
	});

	it("marks failing checks as danger", () => {
		expect(statusText({ kind: "git", label: "checks_failing" }).tone).toBe("danger");
	});

	it("shows nothing while the status is unknown", () => {
		expect(statusText(null)).toEqual({ text: "", tone: "neutral" });
	});
});
