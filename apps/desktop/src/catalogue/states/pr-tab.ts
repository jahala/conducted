/**
 * @feature catalogue States of the pull request tab
 * Owns: arbor's open pull request in its center tab (title, number, description, activity,
 * checks, review and merge), the number's right-click menu, the Edit PR title dialog, a draft
 * pull request with no description, reviewers in every review state, the merge button of a
 * repository that only allows rebasing, and a closed pull request.
 * Behaviour: ui-map.md 3.2 ("Tab content: PR"), 5.2 (the "Edit PR title" dialog), 7.2 ("No
 * description"); features/pr/PrTab.tsx.
 * Test first: not applicable; the screenshot run opens every state.
 */

import { click, rightClick, shows } from "../dom.ts";
import type { CatalogueState } from "../state.ts";
import { arborScene, prOf } from "./git.ts";

const PR_TAB = { tab: "pr" };

export const PR_TAB_STATES: CatalogueState[] = [
	{
		id: "pr-tab",
		group: "Pull request tab",
		title: "Pull request tab: an open pull request with checks running",
		seed: arborScene({
			git: prOf("open"),
			search: PR_TAB,
			ready: (document) => shows(document, "Accepts paths on this site only"),
		}),
	},
	{
		id: "pr-tab-closed",
		group: "Pull request tab",
		title: "Pull request tab: a pull request closed without merging",
		seed: arborScene({
			git: prOf("closed"),
			search: PR_TAB,
			ready: (document) => shows(document, "Closed"),
		}),
	},
	{
		id: "pr-tab-number-menu",
		group: "Pull request tab",
		title: "Pull request tab: the number's right-click menu",
		seed: arborScene({
			git: prOf("open"),
			search: PR_TAB,
			after: ({ document }) =>
				rightClick(
					document,
					'section[aria-label="Pull request"] a, section[aria-label="Pull request"] button',
					"#231",
					{ prefix: true },
				),
			ready: (document) => shows(document, "Copy number"),
		}),
	},
	{
		id: "pr-tab-edit-title",
		group: "Pull request tab",
		title: "Pull request tab: the Edit PR title dialog",
		seed: arborScene({
			git: prOf("open"),
			search: PR_TAB,
			after: ({ document }) => click(document, "button", "Edit title"),
			ready: (document) => shows(document, "Edit PR title"),
		}),
	},
	{
		id: "pr-tab-draft",
		group: "Pull request tab",
		title: "Pull request tab: a draft pull request with no description",
		seed: arborScene({
			git: prOf("draft", { body: "" }),
			search: PR_TAB,
			ready: (document) => shows(document, "No description"),
		}),
	},
	{
		id: "pr-tab-reviews",
		group: "Pull request tab",
		title:
			"Pull request tab: reviewers who asked for changes, commented, were dismissed or are awaited",
		seed: arborScene({
			git: prOf("changes_requested", {
				reviews: [
					{ login: "lee", state: "CHANGES_REQUESTED" },
					{ login: "ana", state: "COMMENTED" },
					{ login: "kim", state: "DISMISSED" },
				],
				requestedReviewers: ["jo"],
			}),
			search: PR_TAB,
			ready: (document) => shows(document, "Awaiting review"),
		}),
	},
	{
		id: "pr-tab-rebase-only",
		group: "Pull request tab",
		title: "Pull request tab: ready to merge in a repository that only allows rebasing",
		seed: arborScene({
			git: { ...prOf("ready"), mergeMethods: { squash: false, rebase: true, merge: false } },
			search: PR_TAB,
			ready: (document) => shows(document, "Rebase and merge"),
		}),
	},
];
