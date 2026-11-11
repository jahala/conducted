/**
 * @feature PR-08 The Graphite stack the git panel shows
 * Owns: one hook that reads the Graphite stack of the checked-out branch from the Graphite
 * service's store, for the repository the git panel watches.
 * Behaviour: services-map.md 3.8.1 (`gt state` for the visible workspace's repository, only while
 * `graphite_disabled` is not true), 5B.1.8; the stack rule lives in core/graphite.ts
 * (graphiteStackOf).
 * Data: the Graphite store, keyed by the repository's root, and useSetting("graphite_disabled").
 * Must handle: the switch turned off (no stack at once, before the next poll clears the store), a
 * repository Graphite has not answered for yet, and a branch git has not named yet or a detached
 * HEAD (no stack). It only reads: the git panel starts and stops the poll (GitPanel.tsx).
 * Test first: the git panel's Changes tab lists the stack Graphite reports for the branch
 * (git-panel.pr-08.test.tsx).
 */
import { useStore } from "zustand";
import { useServices } from "../../core/context.tsx";
import { type GraphiteStack, graphiteStackOf } from "../../core/graphite.ts";
import { useSetting } from "../../core/hooks.ts";

const NO_GRAPHITE_STACK: GraphiteStack = { isInStack: false, branches: [] };

/** The Graphite stack `branch` belongs to in the repository at `repoRootPath`, or no stack. */
export function useGraphiteStack(
	repoRootPath: string | null,
	branch: string | null,
): GraphiteStack {
	const { services } = useServices();
	const branches = useStore(services.graphite.store, (state) =>
		repoRootPath === null ? undefined : state.byRepo[repoRootPath]?.branches,
	);
	const off = useSetting<boolean>("graphite_disabled") !== false;
	if (off || branches === undefined || branch === null || branch.length === 0) {
		return NO_GRAPHITE_STACK;
	}
	return graphiteStackOf(branches, branch);
}
