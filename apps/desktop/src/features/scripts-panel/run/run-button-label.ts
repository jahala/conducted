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
 * Must handle: an empty label (use the action id), and a stop that did not confirm (the caller
 * shows the terminal service's "Stop not confirmed" message and this model returns to Run again).
 * Test first: phase "running" for action "Dev server" gives "Stop Dev server" with click "stop".
 */

export type RunPhase = "stopped" | "starting" | "waiting_for_setup" | "running" | "stopping";

export interface RunButtonModel {
	label: string;
	disabled: boolean;
	click: "start" | "stop" | "start_spotlight" | "stop_spotlight" | null;
}

export function runButtonModel(
	action: { id: string; label: string; isSpotlight: boolean },
	phase: RunPhase,
	hasRunBefore: boolean,
): RunButtonModel {
	const label = action.label.trim() === "" ? action.id : action.label;

	if (action.isSpotlight) {
		if (phase === "running") {
			return { label: "Stop spotlight", disabled: false, click: "stop_spotlight" };
		}
		if (phase === "starting" || phase === "waiting_for_setup") {
			return { label: "Starting...", disabled: true, click: null };
		}
		if (phase === "stopping") {
			return { label: "Stopping...", disabled: true, click: null };
		}
		return { label: "Start spotlight", disabled: false, click: "start_spotlight" };
	}

	switch (phase) {
		case "starting":
			return { label: "Starting...", disabled: true, click: null };
		case "waiting_for_setup":
			return { label: "Waiting for setup", disabled: false, click: "stop" };
		case "running":
			return { label: `Stop ${label}`, disabled: false, click: "stop" };
		case "stopping":
			return { label: "Stopping...", disabled: true, click: null };
		case "stopped":
			return {
				label: hasRunBefore ? `Run ${label} again` : `Run ${label}`,
				disabled: false,
				click: "start",
			};
	}
}
