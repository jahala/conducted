/**
 * @feature PR-02 Written instructions the app sends to the agent
 * @feature GIT-07 Resolve conflicts, done by the agent on request
 * Owns now: the text of the "create a pull request" and "resolve conflicts" requests, and the
 * `pull.rebase` choice between rebasing and merging. The other requests (commit and push, fix
 * failing checks, review the diff, rename the branch, reconcile with the target, merge into the
 * target) are placeholders owned by GIT-05, PR-05, REV-05, WS-04, GIT-04 and GIT-14.
 * Behaviour: structure-map.md section 6 pattern 5 (delegate risky git work to the agent),
 * services-map.md 3.6.4 (rebase or merge by `pull.rebase`), 3.7.1 (create PR steps), 3.7.6
 * (conflict resolution goes to the agent), ui-map.md 3.6 and 6 Actions.
 * Must handle: a per-repo custom prompt (`RepoConfig.prompts`) is added to the Create PR text and,
 * when supplied, replaces the default text for Resolve conflicts; the target branch and remote
 * names are inserted as given (they are quoted by the agent's own tools, not by us); a PR
 * template, when the repo has one, is named in the text so the agent reads it; a workspace link
 * is included only when the user turns it on, and the text says it opens the app on this Mac; a
 * force push is only ever requested as `--force-with-lease`; the instruction never asks to rename
 * the branch.
 * Our design choice: all wording is our own. Each function returns plain text with no hidden
 * markers. The text is the message the user sees in the chat, so it must be readable.
 * Test first: createPrInstruction mentions the target branch, `gh pr create` and the PR template
 * path; resolveConflictsInstruction names the target and the rebase or merge steps.
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

export const commitAndPushInstruction = (_input: InstructionBase): string =>
	notImplemented("GIT-05");

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

/** `pull.rebase` values that tell git to rebase (services-map 3.6.4). */
const REBASE_PULL_VALUES = new Set(["true", "yes", "on", "1", "merges", "interactive", "preserve"]);

/**
 * The strategy when the branch has diverged from its target: `pull.rebase` decides, and an
 * unset, false or unknown value means merge (services-map 3.6.4).
 */
export function pullRebaseStrategy(configValue: string): "rebase" | "merge" {
	return REBASE_PULL_VALUES.has(configValue.trim().toLowerCase()) ? "rebase" : "merge";
}

/**
 * The instruction for "Resolve conflicts". A repository prompt replaces the default text
 * (ui-map 6 Actions). The rebase steps finish with a leased force push; the merge steps never
 * force.
 */
export const resolveConflictsInstruction = (
	input: InstructionBase & {
		strategy: "rebase" | "merge";
	},
): string => {
	const custom = input.customPrompt?.trim() ?? "";
	if (custom.length > 0) return custom;

	const remote = input.remote.trim();
	const remoteTarget = remote.length === 0 ? input.targetBranch : `${remote}/${input.targetBranch}`;
	const steps: string[] = [];
	if (input.strategy === "rebase") {
		steps.push(`Rebase this branch onto \`${remoteTarget}\`.`);
		steps.push("Resolve every conflict, then stage the resolved files.");
		steps.push("Continue the rebase with `git rebase --continue` until it finishes.");
		if (remote.length > 0) {
			steps.push(
				"Update the remote branch with `git push --force-with-lease`, never a plain force push.",
			);
		}
	} else {
		steps.push(`Merge \`${remoteTarget}\` into this branch.`);
		steps.push("Resolve every conflict, then stage the resolved files and finish the merge.");
		if (remote.length > 0) steps.push("Push the branch with `git push`.");
	}

	const intro = `Resolve the conflicts on the branch \`${input.branch}\` against \`${remoteTarget}\`.`;
	const numbered = steps.map((step, index) => `${index + 1}. ${step}`).join("\n");
	return `${intro}\n\n${numbered}`;
};

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
	_input: InstructionBase & {
		strategy: "rebase" | "merge";
		dirty: boolean;
	},
): string => notImplemented("GIT-04");

/**
 * "Merge into target" for a repository with no GitHub remote: ask the agent to merge the branch
 * into the target branch in the main clone, as a fast-forward when possible (GIT-14).
 */
export const mergeIntoTargetInstruction = (_input: InstructionBase): string =>
	notImplemented("GIT-14");
