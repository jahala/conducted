/**
 * @feature PR-02 Written instructions the app sends to the agent; REV-05 the AI review text
 * @feature PR-05 Fix errors, done by the agent on request
 * @feature GIT-05 Commit and push, done by the agent on request
 * @feature GIT-07 Resolve conflicts, done by the agent on request
 * Owns now: the text of the "create a pull request" request, the "reconcile with the target"
 * request (GIT-04), the "commit and push" request (GIT-05), the "resolve conflicts" request
 * (GIT-07), the "fix failing checks" request (PR-05), plus the `pull.rebase` choice between
 * rebasing and merging, and the AI code review request. The merge into the target request is a
 * placeholder owned by GIT-14. Renaming the branch is not a chat instruction here: WS-04 asks the
 * sidecar's utility prompt through ChatTitleService instead (D030).
 * Behaviour: structure-map.md section 6 pattern 5 (delegate risky git work to the agent),
 * services-map.md 3.5 (commit and push is an agent instruction), 3.6.4 (reconcile messages, and
 * rebase or merge by `pull.rebase`), 3.7.1 (create PR steps), 3.7.6 (conflict resolution and CI
 * fixing go to the agent), ui-map.md 3.6 and 6 Actions (Review and Fix errors prompts).
 * Must handle: a per-repo custom prompt (`RepoConfig.prompts`) is added to the built-in text for
 * Create PR, Commit and push and Reconcile (those two take it as an optional input), and replaces
 * it for Review, Resolve conflicts and Fix errors; the target branch and remote names are inserted
 * as given (they are quoted by the agent's own tools, not by us); a PR template, when the repo has
 * one, is named in the text so the agent reads it; a workspace link is
 * included only when the user turns it on, and the text says it opens the app on this Mac; a force
 * push is only ever requested as `--force-with-lease`; the instruction never asks to rename the
 * branch; the commit request names the branch and remote and never asks for a force push; when no
 * repository prompt is set, the Resolve conflicts request names the target and the rebase or merge
 * steps, and its rebase steps finish with a leased force push; the extra review instructions from
 * "Edit before sending" are added after the chosen base; the Fix errors request names the branch,
 * each failing check and its log tail when one was read.
 * Our design choice: all wording is our own. Each function returns plain text with no hidden
 * markers. The text is the message the user sees in the chat, so it must be readable.
 * Test first: commitAndPushInstruction names the branch and remote; createPrInstruction mentions
 * the target branch, `gh pr create` and the PR template path; resolveConflictsInstruction names
 * the target and the rebase or merge steps when the repository has no prompt; aiReviewInstruction
 * replaces its default text with the repository's review prompt; fixErrorsInstruction names each
 * failing check with its log tail, and a repository prompt replaces its text.
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

export const commitAndPushInstruction = (
	input: Pick<InstructionBase, "remote" | "branch"> & { customPrompt?: string | null },
): string => {
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
	const remoteTarget = remoteTargetOf(input.remote, target);
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

/** How a pull proceeds: rebase, merge, or only when it can fast-forward. */
export type PullStrategy = "rebase" | "merge" | "ff_only";

/** The two strategies an agent instruction can ask for. */
export type AgentPullStrategy = Exclude<PullStrategy, "ff_only">;

/**
 * The strategy when the branch has diverged from its target: `pull.rebase` decides, and an
 * unset, false or unknown value means merge (services-map 3.6.4).
 */
export function pullRebaseStrategy(configValue: string): AgentPullStrategy {
	return REBASE_PULL_VALUES.has(configValue.trim().toLowerCase()) ? "rebase" : "merge";
}

/**
 * The strategy from the user's git config. `pull.ff = only` wins because it forbids both a merge
 * commit and a rebase; otherwise `pull.rebase` decides, and its absence means merge.
 */
export function pullStrategy(rebase: string | null, ff: string | null): PullStrategy {
	if (ff?.trim().toLowerCase() === "only") return "ff_only";
	return pullRebaseStrategy(rebase ?? "");
}

/** `remote/target` as an agent instruction names it; a repository with no remote names the target. */
export function remoteTargetOf(remote: string, target: string): string {
	const name = remote.trim();
	const branch = target.trim();
	return name.length === 0 ? branch : `${name}/${branch}`;
}

/**
 * The step that moves the branch onto its target, plus the push that follows. The reconcile and
 * Resolve conflicts requests share this wording (services-map 3.6.4, 3.7.6). A rebase updates the
 * remote with a leased force push; a merge pushes normally. There is no push without a remote.
 */
function rebaseOrMergeSteps(input: {
	strategy: AgentPullStrategy;
	remote: string;
	remoteTarget: string;
}): { start: string; push: string | null } {
	const start =
		input.strategy === "rebase"
			? `Rebase this branch onto \`${input.remoteTarget}\`.`
			: `Merge \`${input.remoteTarget}\` into this branch.`;
	const push =
		input.remote.trim().length === 0
			? null
			: input.strategy === "rebase"
				? "Update the remote branch with `git push --force-with-lease`, never a plain force push."
				: "Push the branch with `git push`.";
	return { start, push };
}

/**
 * The instruction for "Resolve conflicts". A repository prompt replaces the default text
 * (ui-map 6 Actions). The rebase steps finish with a leased force push; the merge steps never
 * force.
 */
export const resolveConflictsInstruction = (
	input: InstructionBase & {
		strategy: AgentPullStrategy;
	},
): string => {
	const custom = input.customPrompt?.trim() ?? "";
	if (custom.length > 0) return custom;

	const remote = input.remote.trim();
	const remoteTarget = remoteTargetOf(remote, input.targetBranch);
	const { start, push } = rebaseOrMergeSteps({
		strategy: input.strategy,
		remote,
		remoteTarget,
	});
	const steps: string[] = [start];
	if (input.strategy === "rebase") {
		steps.push("Resolve every conflict, then stage the resolved files.");
		steps.push("Continue the rebase with `git rebase --continue` until it finishes.");
	} else {
		steps.push("Resolve every conflict, then stage the resolved files and finish the merge.");
	}
	if (push !== null) steps.push(push);

	const intro = `Resolve the conflicts on the branch \`${input.branch}\` against \`${remoteTarget}\`.`;
	const numbered = steps.map((step, index) => `${index + 1}. ${step}`).join("\n");
	return `${intro}\n\n${numbered}`;
};

/**
 * The instruction for "Fix errors". Each failing check is named with its details URL and the last
 * lines of its log when one was read. A repository prompt replaces the default text (ui-map 6
 * Actions).
 */
export const fixErrorsInstruction = (
	input: InstructionBase & {
		failing: readonly { check: CheckRun; logTail: string | null }[];
	},
): string => {
	const custom = input.customPrompt?.trim() ?? "";
	if (custom.length > 0) return custom;

	const intro = `Fix the failing checks on the branch \`${input.branch}\`.`;
	const checks = input.failing.map((entry, index) => {
		const url = entry.check.url === null ? "" : ` (${entry.check.url})`;
		const heading = `${index + 1}. ${entry.check.name}${url}`;
		const log = entry.logTail?.trim() ?? "";
		return log.length === 0
			? `${heading}\nNo log was available for this check.`
			: `${heading}\nLast lines of the log:\n${log}`;
	});
	const closing =
		"Find the cause of each failure and fix it. Run the affected checks locally and make sure they pass. Keep the change focused on what makes the checks pass.";
	return `${intro}\n\nThe failing checks:\n${checks.join("\n\n")}\n\n${closing}`;
};

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

/** "Pull latest from the target" when the worktree is dirty or the branch has diverged. */
export const reconcileInstruction = (input: {
	remote: string;
	targetBranch: string;
	branch: string;
	strategy: AgentPullStrategy;
	dirty: boolean;
	customPrompt?: string | null;
}): string => {
	const remote = input.remote.trim();
	const remoteTarget = remoteTargetOf(remote, input.targetBranch);
	const steps: string[] = [];
	if (input.dirty) {
		steps.push(
			"Review the uncommitted changes with `git diff` and commit them with a clear message.",
		);
	}
	const { start, push } = rebaseOrMergeSteps({
		strategy: input.strategy,
		remote,
		remoteTarget,
	});
	steps.push(start);
	if (push !== null) steps.push(push);

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
