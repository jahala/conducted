/**
 * @feature PR-08 Stack view in the Changes tab
 * Owns: a read-only list of the PRs in a stack, from trunk up, with the current one marked.
 * Behaviour: ui-map.md 3.6 ("Stack view: Stack PRs, Current, (trunk), gt restack, Checkout this
 * branch, Ready for review"); services-map.md 3.8 (Graphite is read-only plus checkout; GitHub
 * stacks use `gh stack`).
 * Data: useStack(workspaceId) (PR-08).
 * Must handle: no stack (the view is not offered), a branch that needs a restack (shows the
 * `gt restack` hint, never runs it), a draft entry with a Ready for review action, checkout of
 * another stack branch refused while the worktree is dirty, and Graphite disabled in settings.
 * Test first: three entries render in order with the current one marked and the trunk shown first.
 */
import { notImplemented } from "@conducted/shared";
import type { StackEntryView } from "../../../core/model.ts";

export interface StackViewProps {
	trunk: string;
	entries: StackEntryView[];
	onCheckout: (branch: string) => void;
	onMarkReady: (prNumber: number) => void;
}

export function StackView(_props: StackViewProps): never {
	return notImplemented("PR-08");
}
