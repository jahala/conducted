/**
 * @feature REV-01 Which two points a diff compares
 * Owns: turning a `DiffScope` from the Changes tab into the two git refs to compare, and the
 * rules for when a file is too large to render.
 * Behaviour: services-map.md 3.4.1 (view modes), 3.4.2 (guard counts), ui-map.md 3.6 (Changes
 * options: current branch, target branch, uncommitted, per commit, per turn).
 * @feature PR-08 The range scope: a run of stack pull requests compares the bottom one's start with
 * the top one's head, or with the working tree when the top one is checked out (services-map.md
 * 3.4.1 `range`, 3.4.5; the run is chosen in git/stack-range.ts). Only the checked-out pull
 * request compares like the branch scope. Pull requests that are not adjacent, or whose commits
 * are missing, give no comparison, in Conductor's words.
 * Must handle: a turn whose end checkpoint does not exist yet (compare to the working tree);
 * a range scope without its run (no comparison);
 * a turn with no start checkpoint (the chat gave no restore point, so no comparison);
 * a branch scope without a merge base (no comparison, with a reason); a root commit (compare
 * against git's empty tree).
 * Our design choice: the merge base is looked up by the caller and passed in, so this module is
 * pure. The comparison for the "branch" and "target" scopes is merge base against the working tree.
 * Test first: a turn scope with no end checkpoint compares start to the working tree.
 */
import { appError, err, ok, type Result } from "@conducted/shared";
import type { DiffScope } from "../api.ts";
import { checkpointRef, turnCheckpointId } from "./refs.ts";
import { type StackRunSelection, stackRunComparison } from "./stack-range.ts";

/** `to` null means the working tree. */
export interface Comparison {
	from: string;
	to: string | null;
}

export interface ComparisonContext {
	/** Merge base of HEAD and the workspace's target branch, when it exists. */
	mergeBaseWithTarget: string | null;
	/** Merge base of HEAD and the branch named in a "target" scope, when it exists. */
	mergeBaseWithScopeTarget: string | null;
	/** Whether the refs of the turn's start and end checkpoints exist in the repository. */
	turnCheckpoints: { startExists: boolean; endExists: boolean };
	/**
	 * Whether a commit scope has a parent. Omitted means it does. A root commit compares against
	 * git's empty tree, because `<sha>^` names nothing.
	 */
	commitParentExists?: boolean;
	/** For a range scope: the run of stack pull requests it names. */
	stackRun?: StackRunSelection;
}

/** Git's empty tree. A root commit's whole tree is a change against it. */
const EMPTY_TREE_SHA = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

export function resolveComparison(
	scope: DiffScope,
	context: ComparisonContext,
): Result<Comparison> {
	switch (scope.kind) {
		case "branch":
			return branchComparison(context);
		case "target":
			return context.mergeBaseWithScopeTarget === null
				? err(appError("no_merge_base", `No common ancestor with ${scope.branch}.`))
				: ok({ from: context.mergeBaseWithScopeTarget, to: null });
		case "uncommitted":
			return ok({ from: "HEAD", to: null });
		case "commit":
			return ok({
				from: context.commitParentExists === false ? EMPTY_TREE_SHA : `${scope.sha}^`,
				to: scope.sha,
			});
		case "turn": {
			if (!context.turnCheckpoints.startExists) {
				return err(appError("no_checkpoint", "This turn has no restore point to compare with."));
			}
			const start = checkpointRef(turnCheckpointId(scope.sessionId, scope.turnId, "start"));
			const end = checkpointRef(turnCheckpointId(scope.sessionId, scope.turnId, "end"));
			return ok({ from: start, to: context.turnCheckpoints.endExists ? end : null });
		}
		case "range":
			return rangeComparison(context);
	}
}

function branchComparison(context: ComparisonContext): Result<Comparison> {
	return context.mergeBaseWithTarget === null
		? err(appError("no_merge_base", "The branch has no common ancestor with the target branch."))
		: ok({ from: context.mergeBaseWithTarget, to: null });
}

function rangeComparison(context: ComparisonContext): Result<Comparison> {
	const run = context.stackRun;
	if (run === undefined) {
		return err(appError("stack_range_unresolved", "The stack's pull requests were not read."));
	}
	switch (run.kind) {
		case "checkedOut":
			return branchComparison(context);
		case "nonAdjacent":
			return err(appError("stack_range_not_adjacent", "Select adjacent PRs to see their changes"));
		case "unavailable":
			return err(appError("stack_range_unavailable", `Can't show #${run.prNumber}'s changes`));
		case "run":
			return ok(stackRunComparison(run));
	}
}

/** A single file is shown only when its changed line count is below this limit. */
export const MAX_RENDERABLE_CHANGED_LINES = 20_000;
/** Files above this size are not read for a text diff. */
export const MAX_RENDERABLE_FILE_BYTES = 2 * 1024 * 1024;

export const isTooLargeToRender = (sizeBytes: number, changedLines: number): boolean =>
	sizeBytes > MAX_RENDERABLE_FILE_BYTES || changedLines > MAX_RENDERABLE_CHANGED_LINES;
