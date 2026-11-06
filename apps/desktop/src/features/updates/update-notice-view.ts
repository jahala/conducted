/**
 * @feature APP-06 Update notice view
 * Owns: the pure mapping from the update status and the auto-restart setting to the notice text
 * and action.
 * Behaviour: ui-map.md 1.3. The states come from UpdateStatus in core/api.ts. Table (our wording):
 *   idle, checking                    -> no notice
 *   available                         -> "Version X is available"              action: Download
 *   downloading                       -> "Downloading version X"               no action
 *   ready_when_idle, auto-restart on  -> "Will automatically restart when all agents are idle"
 *   ready_when_idle, auto-restart off -> "Version X is ready"                  action: Restart when idle
 *   error                             -> "Update failed: <message>"            action: Retry
 * "See changes" opens the release notes at UpdateStatus.notesUrl (null when none are published).
 * Must handle: a null version in a state that needs one (the text omits the version), a very long
 * error message (cut with the full text in a tooltip), and the same status repeated (the result is
 * equal, so the notice does not re-render).
 * Test first: the table above, one case per row.
 */
import type { UpdateStatus } from "../../core/api.ts";

/** Longest error message the notice shows before the UI adds "…", keeping the footer calm. */
const MAX_ERROR_LENGTH = 120;

export interface UpdateNoticeView {
	text: string;
	primary: { id: "download" | "restart_when_idle" | "retry"; label: string } | null;
	showSeeChanges: boolean;
}

function errorText(error: string | null): string {
	if (error === null) return "Update failed";
	const message = error.length > MAX_ERROR_LENGTH ? `${error.slice(0, MAX_ERROR_LENGTH)}…` : error;
	return `Update failed: ${message}`;
}

export function describeUpdate(
	status: UpdateStatus,
	autoRestartWhenIdle: boolean,
): UpdateNoticeView | null {
	const showSeeChanges = status.notesUrl !== null;
	switch (status.state) {
		case "idle":
		case "checking":
			return null;
		case "available":
			return {
				text:
					status.version === null
						? "An update is available"
						: `Version ${status.version} is available`,
				primary: { id: "download", label: "Download" },
				showSeeChanges: false,
			};
		case "downloading":
			return {
				text:
					status.version === null
						? "Downloading the update"
						: `Downloading version ${status.version}`,
				primary: null,
				showSeeChanges: false,
			};
		case "ready_when_idle":
			if (autoRestartWhenIdle) {
				return {
					text: "Will automatically restart when all agents are idle",
					primary: null,
					showSeeChanges,
				};
			}
			return {
				text:
					status.version === null ? "The update is ready" : `Version ${status.version} is ready`,
				primary: { id: "restart_when_idle", label: "Restart when idle" },
				showSeeChanges,
			};
		case "error":
			return {
				text: errorText(status.error),
				primary: { id: "retry", label: "Retry" },
				showSeeChanges: false,
			};
	}
}
