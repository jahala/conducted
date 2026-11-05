/**
 * @feature PR-02 Written instructions the app sends to the agent
 * Owns: the text of every request the app makes through a chat instead of running git itself:
 * commit and push, create a pull request, resolve conflicts, fix failing checks, review the diff,
 * rename the branch, and reconcile with the target branch.
 * Behaviour: structure-map.md section 6 pattern 5 (delegate risky git work to the agent),
 * services-map.md 3.5 (commit), 3.6.4 (reconcile: rebase or merge by the user's `pull.rebase`),
 * 3.7.1 (create PR steps), 3.7.6 (conflicts, CI fixes), 3.11 (auto rename), ui-map.md 3.6.
 * Must handle: a per-repo custom prompt (`RepoConfig.prompts`) is added to the built-in text,
 * never silently replaces it; the target branch and remote names are inserted as given (they are
 * quoted by the agent's own tools, not by us); a PR template, when the repo has one, is named in
 * the text so the agent reads it; failing checks include the name, link and the last lines of the
 * log, cut to a size the agent can read; a force push is only ever requested as
 * `--force-with-lease`; the instruction never asks to rename the branch unless it is the rename
 * request itself.
 * Our design choice: all wording is our own. Each function returns plain text with no hidden
 * markers. The text is the message the user sees in the chat, so it must be readable.
 * Test first: createPrInstruction mentions the target branch, `gh pr create` and the PR template path.
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
	_input: InstructionBase & {
		prTemplatePath: string | null;
		hasUncommittedChanges: boolean;
	},
): string => notImplemented("PR-02");

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
