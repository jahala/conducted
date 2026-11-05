/**
 * @feature WS-09 Workspace status as a pure function
 * Owns: the one rule that turns lifecycle, chat states and git state into the status the sidebar
 * dot, the Home card and the tabs show.
 * Behaviour: ui-map.md 3.8 (workspace status model: priority order, labels, sidebar subtitles).
 * Must handle: priority from first to last is lifecycle (initializing, setting up, failed,
 * archiving), then agent states in the order needs plan review, needs permission, needs answer,
 * working, cancelling, waiting, then git states in the order merged, in merge queue, ready to
 * merge, draft PR, merge conflict, checks failing, checks running, PR open, changes, clean; the
 * most urgent chat decides when several chats differ; closed chats do not count; an archived
 * workspace has no status (null); `waiting` means idle with background tasks; `cancelling` is
 * the app's own flag for a chat whose cancel is not confirmed yet; missing git state (not loaded
 * yet) yields no git label and never "clean".
 * Our design choice: the function takes plain values and returns a value. It reads no store, so
 * the sidebar, Home and tabs call it with the same inputs and always agree. Ready to merge means
 * an open PR, mergeable, review not blocking, and no failing or pending checks.
 * Test first: a workspace with one working chat and a merged PR shows "working", not "merged".
 */
import type { LiveState } from "@conducted/protocol";
import type { GitState, PullRequest, Workspace, WorkspaceStatus } from "../model.ts";

export interface ChatStatusInput {
	liveState: LiveState;
	/** The app asked to cancel and the sidecar has not confirmed. */
	cancelling: boolean;
	closed: boolean;
}

export interface WorkspaceStatusInput {
	state: Workspace["state"];
	/** The setup script is running (in memory, not stored). */
	settingUp: boolean;
	chats: readonly ChatStatusInput[];
	/** Null while git state has not loaded. */
	git: GitState | null;
}

type LifecycleLabel = Extract<WorkspaceStatus, { kind: "lifecycle" }>["label"];
type AgentLabel = Extract<WorkspaceStatus, { kind: "agent" }>["label"];
type GitLabel = Extract<WorkspaceStatus, { kind: "git" }>["label"];

/** From most urgent to least. The first chat that matches decides the workspace. */
const AGENT_ORDER: readonly AgentLabel[] = [
	"needs_plan_review",
	"needs_permission",
	"needs_answer",
	"working",
	"cancelling",
	"waiting",
];

/** The agent state a chat is in, ignoring chats the user closed. */
function chatAgentLabel(chat: ChatStatusInput): AgentLabel | null {
	if (chat.closed) return null;
	const open = chat.liveState.openInteraction?.interaction;
	if (open !== undefined) {
		switch (open.kind) {
			case "plan_approval":
				return "needs_plan_review";
			case "tool_approval":
			case "permission_grant":
				return "needs_permission";
			case "question":
			case "mcp_form":
				return "needs_answer";
		}
	}
	// A requested cancel is newer than the live state it will replace, so it wins for the chat
	// that is stopping. A genuinely working chat in the workspace still outranks it below.
	if (chat.cancelling) return "cancelling";
	if (chat.liveState.status === "working") return "working";
	if (chat.liveState.backgroundTasks.length > 0) return "waiting";
	return null;
}

function aggregateAgentLabel(chats: readonly ChatStatusInput[]): AgentLabel | null {
	let best: AgentLabel | null = null;
	for (const chat of chats) {
		const label = chatAgentLabel(chat);
		if (label === null) continue;
		if (best === null || AGENT_ORDER.indexOf(label) < AGENT_ORDER.indexOf(best)) best = label;
	}
	return best;
}

function lifecycleLabel(input: WorkspaceStatusInput): LifecycleLabel | null {
	switch (input.state) {
		case "failed":
			return "failed";
		case "archiving":
			return "archiving";
		case "initializing":
			return input.settingUp ? "setting_up" : "initializing";
		case "ready":
			// Setup runs while the row is initializing. If it is still running after the row moves
			// on, the honest label is still Setting up.
			return input.settingUp ? "setting_up" : null;
		case "archived":
			return null;
	}
}

function isActivePullRequest(
	pullRequest: PullRequest | null,
): pullRequest is PullRequest & { state: "open" | "draft" } {
	return pullRequest !== null && (pullRequest.state === "open" || pullRequest.state === "draft");
}

function checksAreFailing(pullRequest: PullRequest): boolean {
	return pullRequest.checks.some(
		(check) => check.state === "failure" || check.state === "cancelled",
	);
}

function checksAreRunning(pullRequest: PullRequest): boolean {
	return pullRequest.checks.some(
		(check) => check.state === "pending" || check.state === "waiting" || check.state === "running",
	);
}

function reviewIsBlocking(pullRequest: PullRequest): boolean {
	return (
		pullRequest.reviewDecision === "changes_requested" ||
		pullRequest.reviewDecision === "review_required"
	);
}

/** Open, mergeable, no blocking review, and no failing or pending checks. */
function isReadyToMerge(pullRequest: PullRequest): boolean {
	return (
		pullRequest.state === "open" &&
		pullRequest.mergeable === "mergeable" &&
		!reviewIsBlocking(pullRequest) &&
		!checksAreFailing(pullRequest) &&
		!checksAreRunning(pullRequest)
	);
}

function hasMergeConflict(git: GitState, pullRequest: PullRequest | null): boolean {
	return (
		git.hasConflicts ||
		git.operation === "merge" ||
		git.operation === "rebase" ||
		pullRequest?.mergeable === "conflicting"
	);
}

function gitLabel(git: GitState): GitLabel {
	const pullRequest = git.pullRequest;
	if (pullRequest?.state === "merged") return "merged";
	const active = isActivePullRequest(pullRequest) ? pullRequest : null;
	if (active?.inMergeQueue === true) return "in_merge_queue";
	if (active !== null && isReadyToMerge(active)) return "ready_to_merge";
	if (active?.state === "draft") return "draft_pr";
	if (hasMergeConflict(git, active)) return "merge_conflict";
	if (active !== null && checksAreFailing(active)) return "checks_failing";
	if (active !== null && checksAreRunning(active)) return "checks_running";
	if (active !== null) return "pr_open";
	if (git.uncommittedFiles > 0 || git.changedFiles > 0) return "changes";
	return "clean";
}

/** Returns null for an archived workspace. */
export function deriveWorkspaceStatus(input: WorkspaceStatusInput): WorkspaceStatus | null {
	if (input.state === "archived") return null;
	const lifecycle = lifecycleLabel(input);
	if (lifecycle !== null) return { kind: "lifecycle", label: lifecycle };
	const agent = aggregateAgentLabel(input.chats);
	if (agent !== null) return { kind: "agent", label: agent };
	if (input.git === null) return null;
	return { kind: "git", label: gitLabel(input.git) };
}
