/**
 * @feature catalogue Every catalogue state, in index order
 * Owns: the one list the index page, the state mount and the screenshot run read.
 * Behaviour: docs/plans/parallel-build.md section 2, "States catalogue".
 * Must handle: ids are unique, since they name the screenshot files (checked when the list loads).
 * Test first: not applicable; the screenshot run opens every state.
 */
import type { CatalogueState } from "../state.ts";
import { APPROVAL_STATES } from "./approvals.ts";
import { BANNER_STATES } from "./banners.ts";
import { CHAT_STATES } from "./chat.ts";
import { CHECKS_STATES } from "./checks.ts";
import { CLOUD_STATES } from "./cloud.ts";
import { COMMENT_STATES } from "./comments.ts";
import { COMPOSER_STATES } from "./composer.ts";
import { DEEP_LINK_STATES } from "./deep-links.ts";
import { GIT_STATES } from "./git.ts";
import { GOAL_STATES } from "./goals.ts";
import { OPEN_IN_STATES } from "./open-in.ts";
import { OVERLAY_STATES } from "./overlays.ts";
import { PAGE_STATES } from "./pages.ts";
import { PR_TAB_STATES } from "./pr-tab.ts";
import { PR_HEADER_STATES } from "./pull-request.ts";
import { QUEUE_STATES } from "./queue.ts";
import { RESOURCE_STATES } from "./resources.ts";
import { SETTINGS_STATES } from "./settings.ts";
import { SETUP_STATES } from "./setup.ts";
import { SHELL_STATES } from "./shell.ts";
import { SIDEBAR_STATES } from "./sidebar.ts";
import { STACK_STATES } from "./stacks.ts";
import { STARTUP_STATES } from "./startup.ts";
import { TOOL_STATES } from "./tools.ts";

export const CATALOGUE_STATES: readonly CatalogueState[] = [
	...SHELL_STATES,
	...PAGE_STATES,
	...CHAT_STATES,
	...COMPOSER_STATES,
	...GIT_STATES,
	...SETTINGS_STATES,
	...OVERLAY_STATES,
	...STARTUP_STATES,
	...OPEN_IN_STATES,
	...TOOL_STATES,
	...APPROVAL_STATES,
	...PR_HEADER_STATES,
	...CHECKS_STATES,
	...GOAL_STATES,
	...STACK_STATES,
	...BANNER_STATES,
	...SETUP_STATES,
	...SIDEBAR_STATES,
	...RESOURCE_STATES,
	...QUEUE_STATES,
	...PR_TAB_STATES,
	...DEEP_LINK_STATES,
	...COMMENT_STATES,
	...CLOUD_STATES,
];

const seen = new Set<string>();
for (const state of CATALOGUE_STATES) {
	if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(state.id)) {
		throw new Error(`Catalogue state id "${state.id}" must be lowercase words joined by hyphens.`);
	}
	if (seen.has(state.id)) throw new Error(`Catalogue state id "${state.id}" is used twice.`);
	seen.add(state.id);
}
