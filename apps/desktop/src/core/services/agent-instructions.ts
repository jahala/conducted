/**
 * @feature PR-02 Written instructions the app sends to the agent
<<<<<<< HEAD
 * Owns now: the text of the "create a pull request" request and the "reconcile with the target"
 * request (GIT-04). The other requests (commit and push, resolve conflicts, fix failing checks,
 * review the diff, rename the branch, merge into the target) are placeholders owned by GIT-05,
 * GIT-07, PR-05, REV-05, WS-04 and GIT-14.
 * Behaviour: structure-map.md section 6 pattern 5 (delegate risky git work to the agent),
 * services-map.md 3.6.4 (reconcile messages), 3.7.1 (create PR steps), ui-map.md 3.6.
=======
 * @feature GIT-05 Commit and push, done by the agent on request
 * Owns now: the text of the "commit and push" and "create a pull request" requests. The other
 * requests (resolve conflicts, fix failing checks, review the diff, rename the branch, reconcile
 * with the target, merge into the target) are placeholders owned by GIT-07, PR-05, REV-05, WS-04,
 * GIT-04 and GIT-14.
 * Behaviour: structure-map.md section 6 pattern 5 (delegate risky git work to the agent),
 * services-map.md 3.5 (commit and push is an agent instruction), 3.7.1 (create PR steps),
 * ui-map.md 3.6.
>>>>>>> node/git.05
 * Must handle: a per-repo custom prompt (`RepoConfig.prompts`) is added to the built-in text,
 * never silently replaces it; the target branch and remote names are inserted as given (they are
 * quoted by the agent's own tools, not by us); a PR template, when the repo has one, is named in
 * the text so the agent reads it; a workspace link is included only when the user turns it on,
 * and the text says it opens the app on this Mac; a force push is only ever requested as
 * `--force-with-lease`; the instruction never asks to rename the branch; the commit request names
 * the branch and remote and never asks for a force push.
 * Our design choice: all wording is our own. Each function returns plain text with no hidden
 * markers. The text is the message the user sees in the chat, so it must be readable.
 * Test first: commitAndPushInstruction names the branch and remote; createPrInstruction mentions
 * the target branch, `gh pr create` and the PR template path.
 */
import { notImplemented } from "@conducted/shared";
import type { CheckRun } from "../model.ts";

export interface InstructionBase {
	remote: string;
	/** Target branch name without the remote, for example "main". */
	targetBranch: string;
	branch: string;
	/** The repo's custom text for this action, or null. */
	customPrompt: string | null;
}

export const commitAndPushInstruction = (input: InstructionBase): string => {
	const builtIn =
		`Commit all the changes in this workspace with a clear message, then push the branch ` +
		`\`${input.branch}\` to \`${input.remote}\`. Check that the push succeeded.`;
	const custom = input.customPrompt?.trim() ?? "";
	return custom.length === 0
		? builtIn
		: `${builtIn}\n\nRepository instructions for Commit and push:\n${custom}`;
};

export const createPrInstruction = (
	input: InstructionBase & {
		prTemplatePath: string | null;
		hasUncommittedChanges: boolean;
		/** The `conducted://` link to the workspace, or null when the setting is off. */
		workspaceLink?: string | null;
	},
): string => {
	const target = input.targetBranch;
	const remoteTarget = `${input.remote}/${target}`;
	const steps: string[] = [];
	if (input.hasUncommittedChanges) {
		steps.push(
			"Review the uncommitted changes with `git diff` and commit them with a clear message.",
		);
	}
	steps.push(
		`Push the branch with \`git push -u ${input.remote} HEAD\` if it has no upstream or has unpushed commits.`,
	);
	steps.push(`Review the change against the target with \`git diff ${remoteTarget}...\`.`);
	if (input.prTemplatePath !== null) {
		steps.push(
			`Read the repository's pull request template at \`${input.prTemplatePath}\` and follow it for the description.`,
		);
	}
	const workspaceLink = input.workspaceLink?.trim() ?? "";
	if (workspaceLink.length > 0) {
		steps.push(
			`End the description with this link to the workspace: ${workspaceLink}. It opens the workspace in Conducted on this Mac, so it does not work for anyone else.`,
		);
	}
	steps.push(
		`Open the pull request with \`gh pr create --base ${target}\`. Keep the title under 80 characters and the description under five sentences.`,
	);

	const intro = `Create a pull request for the branch \`${input.branch}\` into \`${remoteTarget}\`.`;
	const numbered = steps.map((step, index) => `${index + 1}. ${step}`).join("\n");
	const forcePush =
		"If the branch history was rewritten, update the remote with `git push --force-with-lease`, never a plain force push.";
	const builtIn = `${intro}\n\n${numbered}\n\n${forcePush}`;
	const custom = input.customPrompt?.trim() ?? "";
	return custom.length === 0
		? builtIn
		: `${builtIn}\n\nRepository instructions for Create PR:\n${custom}`;
};

export const resolveConflictsInstruction = (
	_input: InstructionBase & {
		strategy: "rebase" | "merge";
	},
): string => notImplemented("GIT-07");

export const fixErrorsInstruction = (
	_input: InstructionBase & {
		failing: readonly { check: CheckRun; logTail: string | null }[];
	},
): string => notImplemented("PR-05");

export const aiReviewInstruction = (
	_input: InstructionBase & { extraInstructions: string | null },
): string => notImplemented("REV-05");

export const renameBranchInstruction = (
	_input: InstructionBase & { branchPrefix: string },
): string => notImplemented("WS-04");

/** "Pull latest from the target" when the worktree is dirty or the branch has diverged. */
export const reconcileInstruction = (
	input: InstructionBase & {
		strategy: "rebase" | "merge";
		dirty: boolean;
	},
): string => {
	const remote = input.remote.trim();
	const remoteTarget = remote.length === 0 ? input.targetBranch : `${remote}/${input.targetBranch}`;
	const steps: string[] = [];
	if (input.dirty) {
		steps.push(
			"Review the uncommitted changes with `git diff` and commit them with a clear message.",
		);
	}
	if (input.strategy === "rebase") {
		steps.push(`Rebase this branch onto \`${remoteTarget}\`.`);
	} else {
		steps.push(`Merge \`${remoteTarget}\` into this branch.`);
	}
	if (remote.length > 0) {
		steps.push(
			input.strategy === "rebase"
				? "Update the remote branch with `git push --force-with-lease`, never a plain force push."
				: "Push the branch with `git push`.",
		);
	}

	const intro = `Reconcile the branch \`${input.branch}\` with \`${remoteTarget}\`.`;
	const numbered = steps.map((step, index) => `${index + 1}. ${step}`).join("\n");
	const builtIn = `${intro}\n\n${numbered}`;
	const custom = input.customPrompt?.trim() ?? "";
	return custom.length === 0
		? builtIn
		: `${builtIn}\n\nRepository instructions for Reconcile:\n${custom}`;
};

/**
 * "Merge into target" for a repository with no GitHub remote: ask the agent to merge the branch
 * into the target branch in the main clone, as a fast-forward when possible (GIT-14).
 */
export const mergeIntoTargetInstruction = (_input: InstructionBase): string =>
	notImplemented("GIT-14");
