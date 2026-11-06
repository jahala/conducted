/**
 * @feature PR-04 Checks list
 * Owns: the Checks section. One row per check run with its state, name, duration and a button to
 * show its log, plus "Re-run failed checks" and "Fix errors".
 * Behaviour: ui-map.md 3.6, "Checks" paragraph (states Running, Failed, Cancelled, Pending,
 * Waiting; "Re-run failed checks"); services-map.md 3.7.2 (duplicate runs are collapsed to the
 * newest) and 3.7.5 (re-run per distinct workflow run).
 * Not built here: Conductor's "Queue checks" button. The research records only its label, not what
 * it does (system item "what it does is not yet known"), so it waits for that research.
 * Must handle: no checks (GitHub reports none: say so), many checks (failed first, then running,
 * then the rest), a check with no log link, re-run and fix in flight, and a check with a URL to
 * open on GitHub.
 * Test first: checks [success, failure, running] render in the order failure, running, success.
 */
import type { WorkspaceId } from "@conducted/shared";
import { useState } from "react";
import type { CheckRun } from "../../../core/model.ts";
import { Button } from "../../../ui/Button.tsx";
import { CheckRow } from "./CheckRow.tsx";
import { sortChecksForDisplay, summarizeChecks } from "./checks-summary.ts";

export interface ChecksListProps {
	workspaceId: WorkspaceId;
	checks: CheckRun[];
	treatOptionalAsBlocking: boolean;
	rerunBusy: boolean;
	fixBusy: boolean;
	onRerunFailed: () => void;
	onFixErrors: () => void;
	onOpenCheckUrl: (url: string) => void;
}

export function ChecksList({
	workspaceId,
	checks,
	treatOptionalAsBlocking,
	rerunBusy,
	fixBusy,
	onRerunFailed,
	onFixErrors,
	onOpenCheckUrl,
}: ChecksListProps) {
	const [expanded, setExpanded] = useState<string | null>(null);
	const sorted = sortChecksForDisplay(checks);
	const summary = summarizeChecks(checks, { treatOptionalAsBlocking });
	const hasFailures = summary.failed > 0;

	return (
		<section aria-label="Checks" className="border-b border-separator">
			<div className="flex items-center justify-between gap-2 px-2 pb-1 pt-2">
				<h3 className="text-sm font-medium text-fg">
					Checks
					{summary.total === 0 ? null : (
						<span className="ml-1.5 text-xs font-normal text-fg-subtle">
							{summary.failed} failed · {summary.pending} pending · {summary.total} total
						</span>
					)}
				</h3>
				{hasFailures ? (
					<div className="flex items-center gap-1">
						<Button variant="outline" size="xs" loading={rerunBusy} onClick={onRerunFailed}>
							Re-run failed checks
						</Button>
						<Button variant="outline" size="xs" loading={fixBusy} onClick={onFixErrors}>
							Fix errors
						</Button>
					</div>
				) : null}
			</div>
			{summary.total === 0 ? (
				<p className="px-2 pb-3 pt-1 text-xs text-fg-muted">
					GitHub reports no checks for this pull request.
				</p>
			) : (
				<ul className="m-0 list-none p-0">
					{sorted.map((check) => (
						<li key={check.name}>
							<CheckRow
								workspaceId={workspaceId}
								check={check}
								expanded={expanded === check.name}
								onToggle={() =>
									setExpanded((current) => (current === check.name ? null : check.name))
								}
								onOpenUrl={onOpenCheckUrl}
							/>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
