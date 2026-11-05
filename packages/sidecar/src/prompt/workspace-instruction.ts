/**
 * @feature SIDE-09 Prompt assembly: first-message workspace instruction
 * Owns: the text block placed in front of the user's first message in a chat. It tells the agent
 * where it works, which branch the work merges into, and a few house rules.
 * Behaviour: research/conductor/claude-runner.md section 5 item 2 lists what the block says in
 * Conductor: the folder to work in, a gitignored .context folder, a ban on touching the main
 * clone, the target branch, the placeholder branch name, no branch rename unless asked, a complete
 * final message, screenshots under .context. The wording below is ours.
 * Must handle: a target branch with and without a remote prefix, a placeholder branch (extra
 * paragraph), paths with spaces (shown as is, in code spans), and user text that contains our own
 * tag (the block is built from trusted values only, never from user text).
 * Test first: the block for a placeholder branch mentions the placeholder; the block for a normal
 * branch does not.
 * Our design choice: the workspace has a .context folder (git-ignored). WS-01 creates it and adds
 * it to the worktree's exclude file; this block only tells the agent it exists.
 */
import type { WorkspaceContext } from "@conducted/protocol";

export const INSTRUCTION_TAG = "conducted_context";

/** Splits "origin/main" into its remote and branch. A bare name gets the remote "origin". */
export function splitTargetBranch(target: string): { remote: string; branch: string } {
	const slash = target.indexOf("/");
	if (slash === -1) return { remote: "origin", branch: target };
	return { remote: target.slice(0, slash), branch: target.slice(slash + 1) };
}

export function buildWorkspaceInstruction(workspace: WorkspaceContext): string {
	const { remote, branch } = splitTargetBranch(workspace.targetBranch);
	const lines: string[] = [
		`<${INSTRUCTION_TAG}>`,
		"You are running inside Conducted, a Mac app that lets one person run several coding agents side by side.",
		`Do your work in \`${workspace.workspacePath}\`. This is a git worktree made for this task.`,
		`Never read or change files in \`${workspace.repoRootPath}\`. That is the main clone, and other workspaces depend on it.`,
		"The folder `.context` inside the worktree is ignored by git. Use it for notes, screenshots and files you want to hand to other agents.",
		`This workspace merges into \`${remote}/${branch}\`. To see your changes, run \`git diff ${remote}/${branch}...\`. To open a pull request, run \`gh pr create --base ${branch}\`.`,
	];
	if (workspace.placeholderBranch) {
		lines.push(
			"The current branch has a temporary name. Conducted renames it after your first reply, so keep working on it as it is.",
		);
	}
	lines.push(
		"Do not rename the branch unless the user asks you to.",
		"The app shows the pull request of whichever branch is checked out. After you open a pull request, or a stack of them, check out that pull request's branch so the user sees it.",
		"The user mostly reads your last message of a turn; earlier messages are folded away. Put every result, decision and open question into that last message.",
		"If you take a screenshot, save it under `.context` and show it in your last message with Markdown image syntax.",
		"If the user brings up several unrelated tasks, suggest that they start a new workspace for each one.",
		`</${INSTRUCTION_TAG}>`,
	);
	return lines.join("\n");
}
