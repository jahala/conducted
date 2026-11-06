/**
 * @feature SIDE-21 Agent settings reach the sidecar: program paths, environment, keys
 * Owns: the program paths the user chose in Settings, as the app last sent them
 * (`setAgentPrograms`), for the agent detector to report.
 * Behaviour: native-and-sidecar-map.md B3 "Harness version tracking" (versions are probed again when
 * the paths change); other-runners.md 5 (the detector gets the Settings program paths).
 * Must handle: a new list replaces the whole old one (an agent missing from it has no path), the
 * two ACP agents kept apart, and an unchanged list reported as unchanged so nothing is probed again.
 * Test first: s1-sidecar.join.test.ts, "the agent list reports the program paths the app sends".
 * Our design choice: the sidecar keeps the paths in memory only; the app sends them again after
 * every connect, so a restarted sidecar has them before the first detection the app asks for.
 */
import { type RunnerSelector, selectorKey } from "../runners/registry.ts";

export class AgentProgramChoices {
	private paths = new Map<string, string>();

	/** Replaces every choice. True when any path was added, changed or removed. */
	replace(programs: readonly (RunnerSelector & { path: string })[]): boolean {
		const next = new Map(programs.map((program) => [selectorKey(program), program.path]));
		const changed =
			next.size !== this.paths.size ||
			[...next].some(([key, path]) => this.paths.get(key) !== path);
		this.paths = next;
		return changed;
	}

	/** The path chosen for one agent, when there is one. */
	pathFor(selector: RunnerSelector): string | undefined {
		return this.paths.get(selectorKey(selector));
	}
}
