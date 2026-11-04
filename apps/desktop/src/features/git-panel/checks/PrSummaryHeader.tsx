/**
 * @feature PR-04 PR summary header
 * Owns: the top block of the Checks tab. PR number and title, state badge, base branch, and the
 * "Open on GitHub" link.
 * Behaviour: ui-map.md 3.6, "Checks" paragraph ("PR header, Git status"); services-map.md 3.7.1
 * ("Open on GitHub" runs `gh pr create --web` when no PR exists yet).
 * Must handle: no PR (shows the branch and a Create PR link instead), a long title (two lines,
 * truncated), draft, merged and closed badges, and a link that fails to open (toast).
 * Test first: a draft PR renders the "Draft" badge and the number "#12".
 */
import { notImplemented } from "@conducted/shared";
import type { PullRequest } from "../../../core/model.ts";

export interface PrSummaryHeaderProps {
	pullRequest: PullRequest | null;
	branch: string;
	onOpenOnGithub: () => void;
}

export function PrSummaryHeader(_props: PrSummaryHeaderProps): never {
	return notImplemented("PR-04");
}
