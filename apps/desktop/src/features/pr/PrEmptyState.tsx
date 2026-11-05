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
import { Button } from "../../ui/Button.tsx";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { Spinner } from "../../ui/Spinner.tsx";

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

export function PrEmptyState({ kind, onAction }: PrEmptyStateProps) {
	if (kind === "loading") {
		return (
			<div className="flex h-full items-center justify-center gap-2 p-6 text-fg-subtle">
				<Spinner label="Loading PR info" />
				<p className="text-sm text-fg-muted">Loading PR info...</p>
			</div>
		);
	}
	if (kind === "no_pr") {
		return (
			<EmptyState
				title="No pull request yet"
				body="Create a pull request to review changes, run checks and merge from here."
				action={
					<Button variant="default" onClick={onAction}>
						Create PR
					</Button>
				}
			/>
		);
	}
	if (kind === "offline") {
		return (
			<EmptyState
				tone="failed"
				title="No internet connection"
				body="Check your connection, then try again."
				action={
					<Button variant="secondary" onClick={onAction}>
						Try again
					</Button>
				}
			/>
		);
	}
	if (kind === "no_github_access") {
		return (
			<EmptyState
				tone="failed"
				title="GitHub access required"
				body="Sign in to GitHub to see this pull request."
				action={
					<Button variant="default" onClick={onAction}>
						Open GitHub sign-in
					</Button>
				}
			/>
		);
	}
	if (kind === "not_github") {
		return (
			<EmptyState
				title="No GitHub remote"
				body="This repository has no GitHub remote. Add one to open pull requests."
			/>
		);
	}
	return (
		<EmptyState
			tone="failed"
			title="PR info unavailable"
			body="GitHub did not return the pull request. Try again in a moment."
			action={
				<Button variant="secondary" onClick={onAction}>
					Try again
				</Button>
			}
		/>
	);
}
