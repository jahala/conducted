/**
 * @feature APP-06 Update notice view
 * Owns: the pure mapping from the update status and the auto-restart setting to the notice text
 * and action.
 * Behaviour: ui-map.md 1.3. The states come from UpdateStatus in core/api.ts. Table (our wording):
 *   idle, checking                    -> no notice
 *   available                         -> "Version X is available"        action: Download
 *   downloading                       -> "Downloading version X"         no action
 *   ready_when_idle, auto-restart on  -> "Will restart when agents are idle"  action: See changes
 *   ready_when_idle, auto-restart off -> "Version X is ready"            action: Restart when idle,
 *                                                                        plus See changes
 *   error                             -> "Update failed: <message>"      action: Retry
 * "See changes" opens the release notes at UpdateStatus.notesUrl (null when none are
 * published).
 * Must handle: a null version in a state that needs one (an error result is not possible here, so
 * the text omits the version), a very long error message (cut with the full text in a tooltip), and
 * the same status repeated (the result is equal, so the notice does not re-render).
 * Test first: the table above, one case per row.
 */
import { notImplemented } from "@conducted/shared";
import type { UpdateStatus } from "../../core/api.ts";

export interface UpdateNoticeView {
	text: string;
	primary: { id: "download" | "restart_when_idle" | "retry"; label: string } | null;
	showSeeChanges: boolean;
}

export function describeUpdate(
	_status: UpdateStatus,
	_autoRestartWhenIdle: boolean,
): UpdateNoticeView | null {
	return notImplemented("APP-06");
}
