/**
 * @feature RUN-01 Run actions from the scripts panel
 * Owns: the rule that picks the action the Run button starts. The run-scripts service imports it.
 * Behaviour: services-map.md 5A.1.6 (the default action runs, hidden actions are skipped).
 */
import type { RunAction } from "./model.ts";

/**
 * The action the Run button starts: the first marked default, else the first. Hidden actions are
 * skipped, so a hidden default does not run by itself.
 */
export function defaultRunAction(actions: readonly RunAction[]): RunAction | null {
	const visible = actions.filter((action) => !action.hidden);
	return visible.find((action) => action.isDefault) ?? visible[0] ?? null;
}
