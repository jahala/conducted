/**
 * @feature PR-04 Checks list
 * Owns: the Checks section. One row per check run with its state, name, duration and a button to
 * show its log, plus "Re-run failed checks" and "Fix errors".
 * Behaviour: ui-map.md 3.6, "Checks" paragraph (states Running, Failed, Cancelled, Pending,
 * Waiting; "Re-run failed checks", "Queue checks"); services-map.md 3.7.2 (duplicate runs are
 * collapsed to the newest) and 3.7.5 (re-run per distinct workflow run).
 * Must handle: no checks (GitHub reports none: say so), many checks (failed first, then running,
 * then the rest), a check with no log link, re-run in flight, "Fix errors" sending failing checks
 * and logs to the agent (PR-05), and a long-running check with a live duration.
 * Test first: checks [success, failure, running] render in the order failure, running, success.
 */
import { notImplemented } from "@conducted/shared";
import type { CheckRun } from "../../../core/model.ts";

export interface ChecksListProps {
	checks: CheckRun[];
	rerunBusy: boolean;
	fixBusy: boolean;
	onRerunFailed: () => void;
	onFixErrors: () => void;
	onOpenCheckUrl: (url: string) => void;
}

export function ChecksList(_props: ChecksListProps): never {
	return notImplemented("PR-04");
}
