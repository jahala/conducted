/**
 * @feature WS-03 Setup tab view state
 * Owns: the pure function that picks what the Setup tab shows from a SetupView (core/model.ts),
 * and the kinds it can pick.
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

import { notImplemented } from "@conducted/shared";
import type { SetupView } from "../../../core/model.ts";

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

export function setupTabKind(_view: SetupView): SetupTabKind {
	return notImplemented("WS-03");
}
