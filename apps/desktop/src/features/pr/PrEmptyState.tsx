/**
 * @feature APP-04 PR tab empty and unavailable states
 * Owns: the designed states of the PR tab when there is nothing to show: no PR yet, loading,
 * offline, no GitHub access, no GitHub remote, and PR info unavailable.
 * Behaviour: ui-map.md 3.6 (Loading texts: "Loading PR info...", "No internet connection",
 * "GitHub access required", "PR info unavailable", with Retry) and 7.2.
 * Must handle: one action per state (Create PR, Retry, Open sign-in help), `gh` missing, and the
 * local-git forge where the tab says a GitHub remote is needed.
 * Test first: state "no_pr" shows a Create PR action that calls onAction.
 */
import { notImplemented } from "@conducted/shared";

export type PrEmptyKind =
	| "no_pr"
	| "loading"
	| "offline"
	| "no_github_access"
	| "not_github"
	| "unavailable";

export interface PrEmptyStateProps {
	kind: PrEmptyKind;
	onAction: () => void;
}

export function PrEmptyState(_props: PrEmptyStateProps): never {
	return notImplemented("APP-04");
}
