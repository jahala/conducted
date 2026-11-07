/**
 * @feature PR-04 Checks tab
 * Owns: the rows of the Checks tab's "Git status" section: what is left to do on the branch and
 * its pull request, and the action for each.
 * Behaviour: Conductor's Git status section (renderApp @2258400-2263300), in its order: 'Ready to
 * merge' (Merge), 'No PR open' (Create PR), 'PR is in draft' ('Ready for review'), 'N uncommitted
 * change(s)' ('Commit and push'), 'N commit(s) behind remote' (Pull), 'N commit(s) ahead of remote'
 * (Push, only with nothing uncommitted), 'Merge conflicts detected' (Resolve), 'Incompatible with
 * remote' (Resolve), 'Waiting for PR review', 'PR changes requested' ('Add all comments to chat').
 * Our design choice: 'No PR open' shows whenever there is no pull request, as our tab did before;
 * Conductor shows it only when the branch has changes. 'Ready to merge' follows Conductor's rule
 * on our fields: an open pull request the viewer may merge, mergeable, with no blocking check
 * failing, no review asked for or changes requested, and nothing left to commit, pull or push.
 * Not built here: Conductor's merge queue row and its 'N commit(s) behind <target branch>' row,
 * which need fields GitState does not carry.
 * Must handle: singular and plural counts; a merged or closed pull request (no PR rows).
 * Test first: a draft pull request with two uncommitted files gives 'PR is in draft' and then
 * '2 uncommitted changes'.
 */
import type { GitState } from "../../../core/model.ts";
import { countsAsBlocking, type GitHeaderActionId } from "../../../core/status/git-header.ts";

export interface GitStatusRow {
	id: string;
	text: string;
	action: { id: GitHeaderActionId; label: string } | null;
}

function counted(count: number, word: string): string {
	return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function gitStatusRows(
	git: GitState,
	treatOptionalChecksAsBlocking: boolean,
): GitStatusRow[] {
	const rows: GitStatusRow[] = [];
	const pr = git.pullRequest;
	const open = pr !== null && (pr.state === "open" || pr.state === "draft");
	const { ahead, behind, rewritten } = git.sync;
	const uncommitted = git.uncommittedFiles;

	if (pr !== null && pr.state === "open") {
		const failing = pr.checks.some(
			(check) =>
				countsAsBlocking(check, treatOptionalChecksAsBlocking) &&
				(check.state === "failure" || check.state === "cancelled"),
		);
		const ready =
			pr.viewerCanMerge &&
			pr.mergeable === "mergeable" &&
			!failing &&
			pr.reviewDecision !== "review_required" &&
			pr.reviewDecision !== "changes_requested" &&
			uncommitted === 0 &&
			behind === 0 &&
			ahead === 0 &&
			!rewritten;
		if (ready) {
			rows.push({
				id: "ready-to-merge",
				text: "Ready to merge",
				action: { id: "merge", label: "Merge" },
			});
		}
	}
	if (pr === null) {
		rows.push({
			id: "create-pr",
			text: "No PR open",
			action: { id: "create_pr", label: "Create PR" },
		});
	}
	if (pr !== null && pr.state === "draft") {
		rows.push({
			id: "draft-pr",
			text: "PR is in draft",
			action: { id: "ready_for_review", label: "Ready for review" },
		});
	}
	if (uncommitted > 0) {
		rows.push({
			id: "uncommitted",
			text: counted(uncommitted, "uncommitted change"),
			action: { id: "commit_and_push", label: "Commit and push" },
		});
	}
	if (behind > 0) {
		rows.push({
			id: "behind",
			text: `${counted(behind, "commit")} behind remote`,
			action: { id: "pull", label: "Pull" },
		});
	}
	if (ahead > 0 && uncommitted === 0) {
		rows.push({
			id: "ahead",
			text: `${counted(ahead, "commit")} ahead of remote`,
			action: { id: "push", label: "Push" },
		});
	}
	if (pr !== null && open && pr.mergeable === "conflicting") {
		rows.push({
			id: "merge-conflicts",
			text: "Merge conflicts detected",
			action: { id: "resolve", label: "Resolve" },
		});
	}
	if (rewritten) {
		rows.push({
			id: "incompatible",
			text: "Incompatible with remote",
			action: { id: "resolve_incompatible", label: "Resolve" },
		});
	}
	if (pr !== null && pr.state === "open" && pr.reviewDecision === "review_required") {
		rows.push({ id: "review-required", text: "Waiting for PR review", action: null });
	}
	if (pr !== null && open && pr.reviewDecision === "changes_requested") {
		rows.push({
			id: "changes-requested",
			text: "PR changes requested",
			action: { id: "add_comments_to_chat", label: "Add all comments to chat" },
		});
	}
	return rows;
}
