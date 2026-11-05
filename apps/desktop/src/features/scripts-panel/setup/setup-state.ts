/**
 * @feature WS-03 Setup tab view state
 * Owns: the pure function that picks what the Setup tab shows from a SetupView (core/model.ts),
 * the kinds it can pick, the words for each kind, and which actions each kind offers.
 * Behaviour: ui-map.md 3.7 (Setup states); services-map.md 5A.1.2 (states idle, running,
 * completed, failed, cancelled; the log is kept after the run; the interrupted case after a quit).
 * Table, first match wins:
 *   no script and not running      -> "no_script"      (offer Add setup script)
 *   state detecting                -> "detecting"
 *   state running                  -> "running"        (live terminal)
 *   state stopping                 -> "stopping"
 *   state failed                   -> "failed"         (log, and a "fix it" action to the agent)
 *   state cancelled                -> "cancelled"
 *   state completed                -> "completed"      (log)
 *   idle with a script, no log     -> "not_run"        (empty: output appears after setup runs)
 *   log missing or expired         -> "log_missing"
 * Must handle: the app quitting during setup (next start shows failed with a reason), a very long
 * log, and a script that exists but the workspace is archived.
 * Test first: state "failed" with a log gives view "failed" and exposes the fix action.
 */

import type { SetupView } from "../../../core/model.ts";
import { SETUP_LOG_MISSING_MESSAGE } from "../../../core/services/workspace.ts";

export type SetupTabKind =
	| "no_script"
	| "detecting"
	| "running"
	| "stopping"
	| "failed"
	| "cancelled"
	| "completed"
	| "not_run"
	| "log_missing";

/** Which action buttons a kind offers. Stop, Run again, Ask agent to fix and Add setup script. */
export interface SetupTabActions {
	stop: boolean;
	runAgain: boolean;
	askAgentToFix: boolean;
	addScript: boolean;
}

export interface SetupTabText {
	title: string;
	body: string | null;
}

/** The words the Setup tab shows for each kind (ui-map.md 3.7). */
export const SETUP_TAB_TEXT: Readonly<Record<SetupTabKind, SetupTabText>> = {
	no_script: {
		title: "No setup script",
		body: "Run commands when a workspace is created to install dependencies or set up the environment.",
	},
	detecting: {
		title: "Detecting setup script...",
		body: "Looking for the repository's setup script.",
	},
	running: { title: "Running setup script...", body: null },
	stopping: { title: "Stopping setup script...", body: null },
	failed: {
		title: "Setup script failed",
		body: "Check the log below, then ask the agent to fix it or run setup again.",
	},
	cancelled: { title: "Cancelled setup script", body: null },
	completed: { title: "Setup script completed", body: null },
	not_run: {
		title: "No setup script output",
		body: "Setup script output will appear here after running setup.",
	},
	log_missing: {
		title: "Couldn't load the logs.",
		body: SETUP_LOG_MISSING_MESSAGE,
	},
};

/**
 * Picks what the Setup tab shows. The first match wins, so a running script shows its terminal
 * even when no script is configured on this Mac, and a failure keeps its own state when the log
 * cannot be loaded.
 */
export function setupTabKind(view: SetupView): SetupTabKind {
	if (
		!view.hasScript &&
		view.state !== "running" &&
		view.state !== "detecting" &&
		view.state !== "stopping"
	) {
		return "no_script";
	}
	if (view.state === "detecting") return "detecting";
	if (view.state === "running") return "running";
	if (view.state === "stopping") return "stopping";
	if (view.state === "failed") return "failed";
	if (view.state === "cancelled") return "cancelled";
	if (view.state === "completed") return "completed";
	if (view.log === "missing" || view.log === "expired") return "log_missing";
	return "not_run";
}

/** The actions a kind offers. A finished run can go again; a failure can also ask the agent. */
export function setupTabActions(kind: SetupTabKind): SetupTabActions {
	switch (kind) {
		case "no_script":
			return { stop: false, runAgain: false, askAgentToFix: false, addScript: true };
		case "running":
			return { stop: true, runAgain: false, askAgentToFix: false, addScript: false };
		case "failed":
			return { stop: false, runAgain: true, askAgentToFix: true, addScript: false };
		case "cancelled":
		case "completed":
			return { stop: false, runAgain: true, askAgentToFix: false, addScript: false };
		default:
			return { stop: false, runAgain: false, askAgentToFix: false, addScript: false };
	}
}
