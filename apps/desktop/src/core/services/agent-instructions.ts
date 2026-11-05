/**
 * @feature PR-02 Written instructions the app sends to the agent; REV-05 the AI review text
 * Owns now: the text of the "create a pull request" request and the AI code review request. The
 * other requests (commit and push, resolve conflicts, fix failing checks, rename the branch,
 * reconcile with the target, merge into the target) are placeholders owned by GIT-05, GIT-07,
 * PR-05, WS-04, GIT-04 and GIT-14.
 * Behaviour: structure-map.md section 6 pattern 5 (delegate risky git work to the agent),
 * services-map.md 3.7.1 (create PR steps), ui-map.md 3.6, 6 Actions (Review prompt).
 * Must handle: a per-repo custom prompt (`RepoConfig.prompts`) is added to the built-in text for
 * Create PR and replaces it for Review; the target branch and remote names are inserted as given
 * (they are quoted by the agent's own tools, not by us); a PR template, when the repo has one, is
 * named in the text so the agent reads it; a workspace link is included only when the user turns
 * it on, and the text says it opens the app on this Mac; a force push is only ever requested as
 * `--force-with-lease`; the instruction never asks to rename the branch; the extra review
 * instructions from "Edit before sending" are added after the chosen base.
 * Our design choice: all wording is our own. Each function returns plain text with no hidden
 * markers. The text is the message the user sees in the chat, so it must be readable.
 * Test first: createPrInstruction mentions the target branch, `gh pr create` and the PR template path,
 * and aiReviewInstruction replaces its default text with the repository's review prompt.
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

export interface AiReviewInstructionInput {
	/** The repository's review prompt. It replaces the built-in text when it is not blank. */
	customPrompt: string | null;
	/** What the user typed in "Edit before sending", or null. */
	extraInstructions: string | null;
}

const BUILT_IN_REVIEW = [
	"Review the changes on this workspace's branch against its target branch.",
	"",
	"Run `git status` and `git diff` to see the changes, then read enough of the changed files to judge them in context. Look for bugs, risky behaviour, missing tests and anything that does not match the repository's conventions.",
	"",
	"Report what you find as a short list, most important first. For each item give the file, the line, what is wrong and a concrete fix. If a change looks correct, do not list it.",
	"",
	"Do not edit any files.",
].join("\n");

export const aiReviewInstruction = (input: AiReviewInstructionInput): string => {
	const custom = input.customPrompt?.trim() ?? "";
	const base = custom.length > 0 ? custom : BUILT_IN_REVIEW;
	const extra = input.extraInstructions?.trim() ?? "";
	return extra.length === 0
		? base
		: `${base}\n\nAdditional instructions for this review:\n${extra}`;
};

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
