/**
 * @feature SIDE-12 App tool: SetTargetBranch
 * Owns: the tool that changes the branch this workspace merges into.
 * Behaviour: research/conductor/claude-runner.md section 4.2: takes a branch name without the
 * "origin/" prefix, checks that the branch exists on origin, does not rebase or change an open
 * pull request. In Conductor the sidecar only verifies; here the app verifies and stores (the
 * protocol request setTargetBranch).
 * Must handle: a name with an "origin/" prefix (refused with a hint), a branch that does not
 * exist on origin (the app answers ok false and the message goes back to the agent), an empty
 * name, and a branch the agent has not fetched yet (the message says to run git fetch).
 * Test first: execute() with "origin/main" returns an error result that asks for "main".
 */
import { notImplemented } from "@conducted/shared";
import { z } from "zod";
import type { ToolContext, ToolDefinition, ToolResult } from "./types.ts";

export const setTargetBranchShape = {
	branch: z.string().min(1).describe("The branch name on origin, without the 'origin/' prefix."),
};

export const setTargetBranchTool: ToolDefinition<typeof setTargetBranchShape> = {
	name: "SetTargetBranch",
	description:
		"Change the branch this workspace merges into, for example when the user asks you to base the work or the pull request on another branch. Pass the name as it is on origin, without 'origin/'. Run `git fetch origin <branch>` first so the branch is known locally. This does not rebase your branch or change a pull request that is already open.",
	inputShape: setTargetBranchShape,
	readOnly: false,
	idempotent: true,
	execute(
		_args: z.infer<z.ZodObject<typeof setTargetBranchShape>>,
		_context: ToolContext,
	): Promise<ToolResult> {
		return notImplemented("SIDE-12");
	},
};
