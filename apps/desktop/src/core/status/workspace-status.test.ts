import type { Interaction, LiveState } from "@conducted/protocol";
import type { InteractionId, ToolUseId } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import type { CheckRun, GitState, PullRequest, WorkspaceStatus } from "../model.ts";
import {
	type ChatStatusInput,
	deriveWorkspaceStatus,
	type WorkspaceStatusInput,
} from "./workspace-status.ts";

const idle: LiveState = {
	status: "idle",
	pendingSteerIds: [],
	backgroundTasks: [],
	fastModeAvailable: true,
};

const working: LiveState = { ...idle, status: "working" };

const waiting: LiveState = {
	...idle,
	backgroundTasks: [{ id: "task-1", kind: "shell", description: "npm test" }],
};

function liveWith(interaction: Interaction): LiveState {
	return {
		...idle,
		openInteraction: {
			interactionId: "interaction-1" as InteractionId,
			interaction,
			since: 0,
		},
	};
}

const planApproval: Interaction = { kind: "plan_approval", plan: "Change the parser" };
const toolApproval: Interaction = {
	kind: "tool_approval",
	toolUseId: "tool-1" as ToolUseId,
	toolName: "Bash",
	input: {},
};
const permissionGrant: Interaction = {
	kind: "permission_grant",
	description: "Network access",
	paths: [],
	network: true,
};
const question: Interaction = {
	kind: "question",
	questions: [{ question: "Which branch?", options: [], multiSelect: false }],
};
const mcpForm: Interaction = {
	kind: "mcp_form",
	server: "example",
	message: "Fill this in",
	schema: {},
};

function chat(overrides: Partial<ChatStatusInput> = {}): ChatStatusInput {
	return { liveState: idle, cancelling: false, closed: false, ...overrides };
}

function check(state: CheckRun["state"], required = true): CheckRun {
	return { name: "ci", state, url: null, startedAt: null, completedAt: null, required };
}

function pullRequest(overrides: Partial<PullRequest> = {}): PullRequest {
	return {
		number: 1,
		url: "https://example.test/pull/1",
		title: "A change",
		body: "",
		state: "open",
		mergeable: "mergeable",
		reviewDecision: null,
		checks: [],
		inMergeQueue: false,
		autoMergeEnabled: false,
		baseBranch: "main",
		authorLogin: "octocat",
		viewerDidAuthor: false,
		viewerCanMerge: true,
		mergeMethod: "squash",
		reviewers: [],
		deployments: [],
		updatedAt: 0,
		...overrides,
	};
}

function git(overrides: Partial<GitState> = {}): GitState {
	return {
		branch: "feature",
		uncommittedFiles: 0,
		changedFiles: 0,
		linesAdded: 0,
		linesRemoved: 0,
		hasConflicts: false,
		operation: "none",
		sync: { ahead: 0, behind: 0, rewritten: false, hasUpstream: true },
		pullRequest: null,
		pullRequestUnavailable: "none",
		untrackedFilesTruncated: false,
		pendingPullRequestAction: null,
		...overrides,
	};
}

function input(overrides: Partial<WorkspaceStatusInput> = {}): WorkspaceStatusInput {
	return { state: "ready", settingUp: false, chats: [], git: null, ...overrides };
}

function label(status: WorkspaceStatus | null): string {
	return status === null ? "none" : `${status.kind}:${status.label}`;
}

function deriveGit(overrides: Partial<GitState>): string {
	return label(deriveWorkspaceStatus(input({ git: git(overrides) })));
}

describe("WS-09 workspace status", () => {
	it("shows working, not merged, when a chat is working and the pull request is merged", () => {
		const status = deriveWorkspaceStatus(
			input({
				chats: [chat({ liveState: working })],
				git: git({ pullRequest: pullRequest({ state: "merged" }) }),
			}),
		);
		expect(status).toEqual({ kind: "agent", label: "working" });
	});

	describe("WS-09 lifecycle", () => {
		it("has no status for an archived workspace", () => {
			const status = deriveWorkspaceStatus(
				input({
					state: "archived",
					chats: [chat({ liveState: working })],
					git: git({ pullRequest: pullRequest({ state: "merged" }) }),
				}),
			);
			expect(status).toBeNull();
		});

		it("reports failed and archiving from the workspace state", () => {
			expect(label(deriveWorkspaceStatus(input({ state: "failed" })))).toBe("lifecycle:failed");
			expect(label(deriveWorkspaceStatus(input({ state: "archiving" })))).toBe(
				"lifecycle:archiving",
			);
		});

		it("reports initializing, and setting up while the setup script runs", () => {
			expect(label(deriveWorkspaceStatus(input({ state: "initializing" })))).toBe(
				"lifecycle:initializing",
			);
			expect(label(deriveWorkspaceStatus(input({ state: "initializing", settingUp: true })))).toBe(
				"lifecycle:setting_up",
			);
			expect(label(deriveWorkspaceStatus(input({ state: "ready", settingUp: true })))).toBe(
				"lifecycle:setting_up",
			);
		});

		it("lets lifecycle outrank a working chat and a merged pull request", () => {
			const status = deriveWorkspaceStatus(
				input({
					state: "initializing",
					settingUp: true,
					chats: [chat({ liveState: working })],
					git: git({ pullRequest: pullRequest({ state: "merged" }) }),
				}),
			);
			expect(status).toEqual({ kind: "lifecycle", label: "setting_up" });
		});
	});

	describe("WS-09 session aggregate order", () => {
		const orderedChats: ChatStatusInput[] = [
			chat({ liveState: liveWith(planApproval) }),
			chat({ liveState: liveWith(toolApproval) }),
			chat({ liveState: liveWith(question) }),
			chat({ liveState: working }),
			chat({ cancelling: true }),
			chat({ liveState: waiting }),
		];

		it("picks the most urgent chat: plan, permission, input, working, cancelling, waiting", () => {
			const expected = [
				"needs_plan_review",
				"needs_permission",
				"needs_answer",
				"working",
				"cancelling",
				"waiting",
			];
			for (const [index, expectedLabel] of expected.entries()) {
				const status = deriveWorkspaceStatus(input({ chats: orderedChats.slice(index) }));
				expect(status).toEqual({ kind: "agent", label: expectedLabel });
			}
		});

		it("maps each interaction kind to the right need", () => {
			const cases: [Interaction, string][] = [
				[planApproval, "needs_plan_review"],
				[toolApproval, "needs_permission"],
				[permissionGrant, "needs_permission"],
				[question, "needs_answer"],
				[mcpForm, "needs_answer"],
			];
			for (const [interaction, expectedLabel] of cases) {
				const status = deriveWorkspaceStatus(
					input({ chats: [chat({ liveState: liveWith(interaction) })] }),
				);
				expect(status).toEqual({ kind: "agent", label: expectedLabel });
			}
		});

		it("shows cancelling while a working chat's cancel is not confirmed", () => {
			const status = deriveWorkspaceStatus(
				input({ chats: [chat({ liveState: working, cancelling: true })] }),
			);
			expect(status).toEqual({ kind: "agent", label: "cancelling" });
		});

		it("shows waiting only while idle with background tasks", () => {
			expect(label(deriveWorkspaceStatus(input({ chats: [chat({ liveState: waiting })] })))).toBe(
				"agent:waiting",
			);
			expect(
				label(
					deriveWorkspaceStatus(
						input({ chats: [chat({ liveState: { ...waiting, status: "working" } })] }),
					),
				),
			).toBe("agent:working");
			expect(deriveWorkspaceStatus(input({ chats: [chat({ liveState: idle })] }))).toBeNull();
		});

		it("ignores closed chats", () => {
			const status = deriveWorkspaceStatus(
				input({
					chats: [
						chat({ liveState: liveWith(planApproval), closed: true }),
						chat({ liveState: working, closed: true }),
					],
					git: git({ pullRequest: pullRequest({ state: "merged" }) }),
				}),
			);
			expect(status).toEqual({ kind: "git", label: "merged" });
		});
	});

	describe("WS-09 git and pull request order", () => {
		it("labels merged, queued, ready, draft, conflict, failing, running, open, changes and clean", () => {
			expect(deriveGit({ pullRequest: pullRequest({ state: "merged" }) })).toBe("git:merged");
			expect(deriveGit({ pullRequest: pullRequest({ inMergeQueue: true }) })).toBe(
				"git:in_merge_queue",
			);
			expect(deriveGit({ pullRequest: pullRequest({ checks: [check("success")] }) })).toBe(
				"git:ready_to_merge",
			);
			expect(deriveGit({ pullRequest: pullRequest({ state: "draft" }) })).toBe("git:draft_pr");
			expect(deriveGit({ hasConflicts: true })).toBe("git:merge_conflict");
			expect(
				deriveGit({
					pullRequest: pullRequest({ mergeable: "unknown", checks: [check("failure")] }),
				}),
			).toBe("git:checks_failing");
			expect(
				deriveGit({
					pullRequest: pullRequest({ mergeable: "unknown", checks: [check("running")] }),
				}),
			).toBe("git:checks_running");
			expect(deriveGit({ pullRequest: pullRequest({ mergeable: "unknown" }) })).toBe("git:pr_open");
			expect(deriveGit({ uncommittedFiles: 2 })).toBe("git:changes");
			expect(deriveGit({ changedFiles: 2 })).toBe("git:changes");
			expect(deriveGit({})).toBe("git:clean");
		});

		it("first match wins across the whole order", () => {
			expect(
				deriveGit({
					hasConflicts: true,
					pullRequest: pullRequest({ state: "merged", checks: [check("failure")] }),
				}),
			).toBe("git:merged");
			expect(
				deriveGit({
					pullRequest: pullRequest({
						inMergeQueue: true,
						mergeable: "mergeable",
						checks: [check("success")],
					}),
				}),
			).toBe("git:in_merge_queue");
			expect(
				deriveGit({
					pullRequest: pullRequest({
						state: "draft",
						mergeable: "conflicting",
						checks: [check("failure")],
					}),
				}),
			).toBe("git:draft_pr");
			expect(
				deriveGit({
					pullRequest: pullRequest({
						mergeable: "conflicting",
						checks: [check("failure")],
					}),
				}),
			).toBe("git:merge_conflict");
			expect(
				deriveGit({
					pullRequest: pullRequest({
						mergeable: "unknown",
						checks: [check("failure"), check("running")],
					}),
				}),
			).toBe("git:checks_failing");
			expect(
				deriveGit({
					pullRequest: pullRequest({ mergeable: "unknown" }),
					changedFiles: 3,
				}),
			).toBe("git:pr_open");
			expect(deriveGit({ changedFiles: 3, uncommittedFiles: 0 })).toBe("git:changes");
		});

		it("treats a merge or rebase in progress as a merge conflict", () => {
			expect(deriveGit({ operation: "merge" })).toBe("git:merge_conflict");
			expect(deriveGit({ operation: "rebase" })).toBe("git:merge_conflict");
			expect(deriveGit({ operation: "cherry_pick" })).toBe("git:clean");
		});

		it("calls a pull request ready only when it is open, mergeable, unblocked and its checks are done", () => {
			const ready = pullRequest({ checks: [check("success"), check("skipped", false)] });
			expect(deriveGit({ pullRequest: ready })).toBe("git:ready_to_merge");
			expect(deriveGit({ pullRequest: pullRequest({ reviewDecision: "approved" }) })).toBe(
				"git:ready_to_merge",
			);
			expect(deriveGit({ pullRequest: pullRequest({ reviewDecision: "changes_requested" }) })).toBe(
				"git:pr_open",
			);
			expect(deriveGit({ pullRequest: pullRequest({ reviewDecision: "review_required" }) })).toBe(
				"git:pr_open",
			);
			expect(deriveGit({ pullRequest: pullRequest({ checks: [check("pending")] }) })).toBe(
				"git:checks_running",
			);
			expect(deriveGit({ pullRequest: pullRequest({ checks: [check("failure")] }) })).toBe(
				"git:checks_failing",
			);
			expect(deriveGit({ pullRequest: pullRequest({ checks: [check("cancelled")] }) })).toBe(
				"git:checks_failing",
			);
		});

		it("does not claim a closed pull request is open, failing or ready", () => {
			expect(
				deriveGit({
					pullRequest: pullRequest({
						state: "closed",
						mergeable: "unknown",
						checks: [check("failure")],
					}),
				}),
			).toBe("git:clean");
		});

		it("has no git label and never claims clean while git state has not loaded", () => {
			expect(deriveWorkspaceStatus(input({ git: null }))).toBeNull();
		});
	});
});
