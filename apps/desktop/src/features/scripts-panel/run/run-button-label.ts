/**
 * @feature RUN-01 Run button label
 * Owns: the pure mapping from an action and its phase to the Run tab's button text, enabled state
 * and click effect.
 * Behaviour: ui-map.md 3.7, "Run" paragraph (texts "Run <label>", "Run <label> again", "Stop
 * <label>", "Starting...", "Stopping...", "Start spotlight", shortcut Cmd+R to start or stop);
 * services-map.md 5A.1.3 (process states starting, waiting_for_setup, running, stopping, stopped).
 * Table:
 *   stopped, never run          -> "Run <label>"          click: start
 *   stopped, ran before         -> "Run <label> again"    click: start
 *   starting                    -> "Starting..."          disabled
 *   waiting_for_setup           -> "Waiting for setup"    click: stop (cancel the parked start)
 *   running                     -> "Stop <label>"         click: stop
 *   stopping                    -> "Stopping..."          disabled
 *   spotlight action, stopped   -> "Start spotlight"      click: start spotlight
 *   spotlight action, running   -> "Stop spotlight"       click: stop spotlight
 * Starting a task stops the workspace's previous one (services-map.md 5A.1.3, step 2).
 * Must handle: an empty label (use the action id), a stop not confirmed after 20 seconds (text
 * "Stop not confirmed", the process may still run), and a start while setup is still running.
 * Test first: phase "running" for action "Dev server" gives "Stop Dev server" with click "stop".
 */
import { notImplemented } from "@conducted/shared";

export type RunPhase = "stopped" | "starting" | "waiting_for_setup" | "running" | "stopping";

export interface RunButtonModel {
	label: string;
	disabled: boolean;
	click: "start" | "stop" | "start_spotlight" | "stop_spotlight" | null;
}

export function runButtonModel(
	_action: { id: string; label: string; isSpotlight: boolean },
	_phase: RunPhase,
	_hasRunBefore: boolean,
): RunButtonModel {
	return notImplemented("RUN-01");
}
