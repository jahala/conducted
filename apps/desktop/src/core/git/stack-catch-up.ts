/**
 * @feature PR-12 Catch up a stack branch after GitHub rewrites it
 * Owns: the name of the per-worktree ref that remembers the tip a stack branch last synced to.
 * Behaviour: services-map.md 3.8.3 step 4 (the baseline ref is named by the hash of the branch,
 * its upstream, the remote and the remote's identity). The catch-up itself is still a placeholder:
 * `catchUpStackBranch` in services/github.ts.
 * Our design choice: the namespace is `refs/worktree/conducted/synced/` instead of Conductor's
 * `refs/worktree/conductor/synced/`, to match the `refs/conducted/...` refs in refs.ts.
 * Test first: syncedBaselineRef("abc") is "refs/worktree/conducted/synced/abc".
 */

/** Per-worktree refs that remember the tip a stack branch last synced to. */
export const SYNCED_REF_PREFIX = "refs/worktree/conducted/synced/";

/** The baseline ref for one branch, remote and remote identity, named by the hash of that tuple. */
export const syncedBaselineRef = (tupleHash: string): string => `${SYNCED_REF_PREFIX}${tupleHash}`;
