/**
 * Guard: no setting changes the data-lifetime limits. They are `DEFAULT_LIFETIME_LIMITS` in
 * `core/db/lifetime.ts`, which `core/container.ts` passes unchanged (DATA-02). This fails when the
 * settings registry grows a key for one of them, or when the container stops passing the defaults.
 */
import { join } from "node:path";
import { type Problem, read } from "./lib.ts";

const SETTINGS_REGISTRY = "apps/desktop/src/core/registries/settings.ts";
const CONTAINER = "apps/desktop/src/core/container.ts";

/** The words a settings key would use to take over a limit the doc calls fixed. */
const LIMIT_WORD = /tool_output|lifetime|retention|compact|_max_age_days/i;

export function checkLifetimeLimits(root: string): Problem[] {
	const problems: Problem[] = [];
	const registry = read(join(root, SETTINGS_REGISTRY));
	for (const match of registry.matchAll(/key:\s*"([^"]+)"/g)) {
		const key = match[1] ?? "";
		if (LIMIT_WORD.test(key)) {
			problems.push({
				guard: "lifetime-limits",
				message: `${SETTINGS_REGISTRY} has the key ${key}; the data-lifetime limits are fixed in code, not settings`,
			});
		}
	}
	const container = read(join(root, CONTAINER));
	if (!/limits:\s*DEFAULT_LIFETIME_LIMITS/.test(container)) {
		problems.push({
			guard: "lifetime-limits",
			message: `${CONTAINER} does not pass DEFAULT_LIFETIME_LIMITS to the data-lifetime job`,
		});
	}
	return problems;
}
