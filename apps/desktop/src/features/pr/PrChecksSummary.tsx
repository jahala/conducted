/**
 * @feature PR-07 PR checks summary
 * Owns: the Checks block of the PR tab: a one-line summary of the checks and a link to the full
 * list, whose destination the caller chooses.
 * Behaviour: ui-map.md 3.2 (PR tab: Checks); the full list lives in the git panel (PR-04). Counts
 * come from the same rule as the Checks tab (features/git-panel/checks/checks-summary.ts).
 * Our design choice: the PR tab shows counts and failing check names only, to keep one home for the
 * detailed list.
 * Must handle: no checks, all passing, failing (names of up to three, then "and N more"), pending.
 * Test first: two failed and one passing check render "2 failed" and both names.
 */
import type { CheckRun } from "../../core/model.ts";
import { Button } from "../../ui/Button.tsx";
import { summarizeChecks } from "../git-panel/checks/checks-summary.ts";

export interface PrChecksSummaryProps {
	checks: CheckRun[];
	onShowDetails: () => void;
}

const NAMED_FAILURES = 3;

export function PrChecksSummary({ checks, onShowDetails }: PrChecksSummaryProps) {
	const summary = summarizeChecks(checks, { treatOptionalAsBlocking: true });
	const failed = checks.filter((check) => check.state === "failure");
	const named = failed.slice(0, NAMED_FAILURES);
	const rest = failed.length - named.length;

	return (
		<div className="flex flex-wrap items-start justify-between gap-2 px-2 py-2">
			<div className="min-w-0">
				{summary.total === 0 ? (
					<p className="text-sm text-fg-muted">No checks reported.</p>
				) : (
					<>
						<p className="flex flex-wrap items-center gap-x-2 text-sm">
							{summary.failed > 0 ? (
								<span className="font-medium text-danger">{summary.failed} failed</span>
							) : null}
							{summary.pending > 0 ? (
								<span className="text-warning">{summary.pending} pending</span>
							) : null}
							{summary.passed > 0 ? (
								<span className="text-fg-muted">{summary.passed} passed</span>
							) : null}
						</p>
						{named.length === 0 ? null : (
							<ul className="m-0 mt-0.5 flex list-none flex-wrap gap-x-2 p-0">
								{named.map((check) => (
									<li key={check.name} className="truncate font-mono text-xs text-danger">
										{check.name}
									</li>
								))}
								{rest > 0 ? <li className="text-xs text-fg-muted">and {rest} more</li> : null}
							</ul>
						)}
					</>
				)}
			</div>
			<Button variant="link" size="xs" onClick={onShowDetails}>
				View checks
			</Button>
		</div>
	);
}
