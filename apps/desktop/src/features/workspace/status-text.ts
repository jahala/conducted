/**
 * @feature NAV-03 Workspace status text
 * Owns: the words and the tone for a workspace's derived status, shared by the sidebar row, Home card and tab.
 * Behaviour: ui-map.md 3.8 (sidebar row subtitle text: "Review plan", "Need permission", "Answer question",
 * "Planning...", "Working...", "Cancelling...", "Waiting...", "Initializing...", "Initialization failed",
 * "Setting up...", "Archiving..."; git and PR labels, first match wins).
 * Our design choice: the research writes the progress words with three dots ("Working..."); we print
 * one ellipsis character ("Working…") on purpose, so the words never wrap between dots. "Planning..."
 * has no case because WorkspaceStatus carries no planning label. The labels for `changes` and `clean` are ours ("Changes", "Ready"): Conductor's
 * "Local workspace" and "Ready (has branch)" depend on fields our WorkspaceStatus does not carry. Tone is a
 * function, not decoration: `attention` means the user must act (shown in the accent), `active` means work is
 * in progress, `danger` means something failed, `success` means done, `neutral` is the rest.
 * Must handle: a null status (not loaded yet) gives empty text and neutral tone; every status in the model has
 * a label (the switch is exhaustive, so a new status fails to compile here).
 * Test first: needs_permission gives "Need permission" with tone attention; checks_failing gives danger.
 */
import type { WorkspaceStatus } from "../../core/model.ts";

export type StatusTone = "attention" | "active" | "danger" | "success" | "neutral";

export interface StatusText {
	text: string;
	tone: StatusTone;
}

export function statusText(status: WorkspaceStatus | null): StatusText {
	if (status === null) return { text: "", tone: "neutral" };
	switch (status.kind) {
		case "lifecycle":
			switch (status.label) {
				case "unstarted":
					return { text: "Unstarted", tone: "neutral" };
				case "initializing":
					return { text: "Initializing…", tone: "active" };
				case "setting_up":
					return { text: "Setting up…", tone: "active" };
				case "failed":
					return { text: "Initialization failed", tone: "danger" };
				case "archiving":
					return { text: "Archiving…", tone: "active" };
			}
			break;
		case "agent":
			switch (status.label) {
				case "needs_plan_review":
					return { text: "Review plan", tone: "attention" };
				case "needs_permission":
					return { text: "Need permission", tone: "attention" };
				case "needs_answer":
					return { text: "Answer question", tone: "attention" };
				case "working":
					return { text: "Working…", tone: "active" };
				case "cancelling":
					return { text: "Cancelling…", tone: "active" };
				case "waiting":
					return { text: "Waiting…", tone: "active" };
			}
			break;
		case "git":
			switch (status.label) {
				case "merged":
					return { text: "Merged", tone: "success" };
				case "in_merge_queue":
					return { text: "In merge queue", tone: "active" };
				case "ready_to_merge":
					return { text: "Ready to merge", tone: "success" };
				case "draft_pr":
					return { text: "Draft pull request", tone: "neutral" };
				case "merge_conflict":
					return { text: "Merge conflict", tone: "danger" };
				case "checks_failing":
					return { text: "Checks failing", tone: "danger" };
				case "checks_running":
					return { text: "Checks running", tone: "active" };
				case "pr_open":
					return { text: "Pull request open", tone: "neutral" };
				case "changes":
					return { text: "Changes", tone: "neutral" };
				case "clean":
					return { text: "Ready", tone: "neutral" };
			}
	}
	return { text: "", tone: "neutral" };
}
