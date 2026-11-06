/**
 * @feature catalogue Every catalogue state, in index order
 * Owns: the one list the index page, the state mount and the screenshot run read.
 * Behaviour: docs/plans/parallel-build.md section 2, "States catalogue".
 * Must handle: ids are unique, since they name the screenshot files (checked when the list loads).
 * Test first: not applicable; the screenshot run opens every state.
 */
import type { CatalogueState } from "../state.ts";
import { CHAT_STATES } from "./chat.ts";
import { COMPOSER_STATES } from "./composer.ts";
import { GIT_STATES } from "./git.ts";
import { OVERLAY_STATES } from "./overlays.ts";
import { PAGE_STATES } from "./pages.ts";
import { SETTINGS_STATES } from "./settings.ts";
import { SHELL_STATES } from "./shell.ts";
import { STARTUP_STATES } from "./startup.ts";

export const CATALOGUE_STATES: readonly CatalogueState[] = [
	...SHELL_STATES,
	...PAGE_STATES,
	...CHAT_STATES,
	...COMPOSER_STATES,
	...GIT_STATES,
	...SETTINGS_STATES,
	...OVERLAY_STATES,
	...STARTUP_STATES,
];

const seen = new Set<string>();
for (const state of CATALOGUE_STATES) {
	if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(state.id)) {
		throw new Error(`Catalogue state id "${state.id}" must be lowercase words joined by hyphens.`);
	}
	if (seen.has(state.id)) throw new Error(`Catalogue state id "${state.id}" is used twice.`);
	seen.add(state.id);
}
