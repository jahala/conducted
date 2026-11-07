/**
 * @feature catalogue States of links the app is asked to open and cannot
 * Owns: Home with the toasts that links of each kind raise when they cannot be opened: one that is
 * no link the app knows, links to a workspace or a browser tab that is gone, a setting a link may
 * not turn on, a browser link with an address that is not a web page, and plan links with no
 * repository, unreadable plan data or an empty plan.
 * Behaviour: app/deep-link-routes.ts (each failure's title, in Conductor's words); PLAT-16 delivers
 * the links. The links arrive the way macOS hands them to the app, through the Platform's deep
 * link event.
 * Test first: not applicable; the screenshot run opens every state.
 */

import { seedCast } from "../cast.ts";
import { find, shows } from "../dom.ts";
import type { CatalogueState } from "../state.ts";

/** Base64 of three spaces: a plan link whose plan is empty. */
const EMPTY_PLAN = "ICAg";

/** Home, with `links` opened one after the other once the app is up. */
const linksState = (
	id: string,
	title: string,
	links: readonly string[],
	last: string,
): CatalogueState => ({
	id,
	group: "Deep links",
	title,
	seed: async (world) => {
		await seedCast(world);
		return {
			route: "/all-workspaces",
			after: async ({ document }) => {
				// The links arrive once the window shows Home, as a click in another app would send them.
				await find(document, "a,button,span", "Rate limit api");
				for (const link of links) world.memory.controls.emitDeepLink(link);
				// The pointer rests on the toasts, which spreads the stack so each one reads in full.
				const toast = await find(document, "[data-sonner-toast]", last, { prefix: true });
				toast.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
			},
			ready: (document) => shows(document, last),
		};
	},
});

export const DEEP_LINK_STATES: CatalogueState[] = [
	linksState(
		"deep-link-gone",
		"Links to a workspace and a browser tab that are gone, and one the app does not know",
		[
			"conducted://workspace?id=ws-deleted-long-ago",
			"conducted://browser?url=https%3A%2F%2Flocalhost%3A55000%2F&workspace-id=ws-deleted-long-ago",
			"conducted://teleport?to=mars",
		],
		"Invalid deep link",
	),
	linksState(
		"deep-link-refused",
		"Links that may not turn a setting on or open an address that is not a web page",
		[
			"conducted://settings-enable?key=theme",
			"conducted://browser?url=file%3A%2F%2F%2Fetc%2Fhosts&workspace-id=ws-deleted-long-ago",
		],
		"Invalid browser URL",
	),
	linksState(
		"deep-link-plans",
		"Plan links with no repository, unreadable plan data and an empty plan",
		[
			`conducted://async?plan=${EMPTY_PLAN}`,
			"conducted://async?repo=atlas&plan=%25%25not-base64%25%25",
			`conducted://async?repo=atlas&plan=${EMPTY_PLAN}`,
		],
		"Empty plan",
	),
];
