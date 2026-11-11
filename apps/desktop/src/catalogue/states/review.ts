/**
 * @feature catalogue States of the review screens: Changes, diff, comments, AI review and previews
 * Owns: the PR status popover, the Changes filter open, the target branch picker and its failure,
 * the untracked-files note, a commit scope, a diff that cannot load or has nothing to show, a
 * whitespace-only diff, the review menu, dialog and tooltip, an SVG preview, an empty CSV preview
 * and the editor's find and replace bar.
 * Behaviour: ui-map.md 3.2, 3.6 and 5.2; REV-01, REV-02, REV-03, REV-05 and REV-08.
 * Test first: not applicable; the screenshot run opens every state.
 */

import { ARBOR_FILES } from "../cast.ts";
import { click, has, hover, pressUntilTaken, shows } from "../dom.ts";
import type { ScriptedFile } from "../git-repo.ts";
import { setSetting } from "../seeds.ts";
import type { CatalogueState } from "../state.ts";
import type { World } from "../world.ts";
import { arborScene, COMMITTED_ONLY, prOf } from "./git.ts";

const CHANGES_DIFF = {
	tab: "file",
	path: "src/auth/sign-in.ts",
	fileMode: "diff",
	scope: "branch",
} as const;

/** One changed file whose texts differ only in whitespace. */
const WHITESPACE_FILE: ScriptedFile = {
	path: "src/theme.css",
	status: "modified",
	before: ".app {\n  color: black;\n}\n",
	after: ".app {\n    color:   black;\n}\n",
	committed: true,
};

/** The Changes tab with the filter box open, which holds Conductor's Close filter button. */
const filterOpen: CatalogueState = {
	id: "git-filter-open",
	group: "Git panel",
	title: "Changes tab with the filter box open",
	seed: arborScene({
		after: ({ document }) => click(document, "button", "Search changed files"),
		ready: (document) => has(document, "button", "Close filter"),
	}),
};

/** The diff scope menu's Target branch picker, loaded or failed. */
const targetBranch = (
	id: string,
	title: string,
	git: Parameters<typeof arborScene>[0]["git"],
	ready: (document: Document) => boolean,
): CatalogueState => ({
	id,
	group: "Git panel",
	title,
	seed: arborScene({
		git,
		after: async ({ document }) => {
			await click(document, "button", "Diff scope");
			await click(document, "[role=menuitem]", "Target branch");
		},
		ready,
	}),
});

const PR_STATUS: CatalogueState = {
	id: "git-pr-status",
	group: "Git panel",
	title: "The PR status details popover",
	seed: arborScene({
		git: prOf("open"),
		after: ({ document }) => click(document, "button", "View PR status"),
		ready: (document) => has(document, "[aria-label]", "PR status details"),
	}),
};

const UNTRACKED_NOTE: CatalogueState = {
	id: "git-untracked-truncated",
	group: "Git panel",
	title: "Changes tab with more untracked files than the list shows",
	seed: arborScene({
		git: {
			arborFiles: [
				...ARBOR_FILES,
				...Array.from({ length: 101 }, (_, index) => ({
					path: `notes/untracked-${String(index).padStart(3, "0")}.txt`,
					status: "untracked" as const,
					before: "",
					after: `note ${index}\n`,
					committed: false,
				})),
			],
		},
		ready: (document) => shows(document, "Some untracked files are not shown."),
	}),
};

const COMMIT_SCOPE: CatalogueState = {
	id: "git-scope-commit",
	group: "Git panel",
	title: "A single commit's changes, with the back bar",
	seed: arborScene({
		after: async ({ document }) => {
			await click(document, "button", "Diff scope");
			await click(document, "[role=menuitemradio]", "Add safeNext with tests", { prefix: true });
		},
		ready: (document) => shows(document, "All changes"),
	}),
};

const DIFF_ERROR: CatalogueState = {
	id: "git-diff-error",
	group: "Git panel",
	title: "A file diff when git cannot read the changes",
	seed: arborScene({
		git: { arborBroken: true },
		search: CHANGES_DIFF,
		ready: (document) => shows(document, "Couldn't load file changes"),
	}),
};

const DIFF_EMPTY: CatalogueState = {
	id: "git-diff-empty",
	group: "Git panel",
	title: "A file with no changes in the chosen scope",
	seed: arborScene({
		git: { arborFiles: COMMITTED_ONLY },
		search: { tab: "file", path: "package.json", fileMode: "diff", scope: "branch" },
		ready: (document) => shows(document, "No changes to this file."),
	}),
};

const WHITESPACE_DIFF: CatalogueState = {
	id: "git-diff-whitespace",
	group: "Git panel",
	title: "A diff whose only changes are whitespace",
	seed: async (world: World) => {
		await setSetting(world, "hide_whitespace_changes", true);
		return arborScene({
			git: { arborFiles: [...ARBOR_FILES, WHITESPACE_FILE] },
			search: { tab: "file", path: "src/theme.css", fileMode: "diff", scope: "branch" },
			ready: (document) => shows(document, "Only whitespace changes found"),
		})(world);
	},
};

const STACK_LOAD_ERROR: CatalogueState = {
	id: "stack-load-error",
	group: "Stacked pull requests",
	title: "A stack whose pull requests cannot be read",
	seed: arborScene({
		git: { ...prOf("open"), github: "offline" },
		ready: (document) =>
			shows(document, "Couldn't load this stack. Open the PR on GitHub to see it."),
	}),
};

const REVIEW_MENU: CatalogueState = {
	id: "review-menu",
	group: "Git panel",
	title: "The Review button's split menu",
	seed: arborScene({
		after: ({ document }) => click(document, "button", "Review options"),
		ready: (document) => shows(document, "Edit before sending"),
	}),
};

const REVIEW_DIALOG: CatalogueState = {
	id: "review-dialog",
	group: "Git panel",
	title: "Edit the review prompt before sending it",
	seed: arborScene({
		after: async ({ document }) => {
			await click(document, "button", "Review options");
			await click(document, "[role=menuitem]", "Edit before sending");
		},
		ready: (document) => shows(document, "Send"),
	}),
};

const REVIEW_TOOLTIP: CatalogueState = {
	id: "review-tooltip",
	group: "Git panel",
	title: "The Review button's tooltip",
	seed: arborScene({
		after: ({ document }) => hover(document, "button", "Review"),
		ready: (document) => shows(document, "Get an AI code review"),
	}),
};

const EDIT_FIND: CatalogueState = {
	id: "file-edit-find",
	group: "File viewer",
	title: "Edit mode with the find and replace bar",
	seed: arborScene({
		files: { "notes.txt": "alpha beta\nalpha gamma\n" },
		search: { tab: "file", path: "notes.txt", fileMode: "edit" },
		after: async ({ document }) => {
			await pressUntilTaken(document, "f", { meta: true });
		},
		ready: (document) => shows(document, "Replace All"),
	}),
};

const preview = (
	id: string,
	title: string,
	search: Record<string, string>,
	files: Record<string, string>,
	text: string,
): CatalogueState => ({
	id,
	group: "File viewer",
	title,
	seed: arborScene({
		files,
		search,
		after: ({ document }) => click(document, "button", "Preview"),
		ready: (document) => shows(document, text),
	}),
});

export const REVIEW_STATES: CatalogueState[] = [
	PR_STATUS,
	filterOpen,
	targetBranch(
		"git-target-branch",
		"Choose a target branch",
		undefined,
		(document) => document.querySelector('input[placeholder="Select target branch..."]') !== null,
	),
	targetBranch(
		"git-target-branch-error",
		"The target branch list when it cannot load",
		{ arborBroken: true },
		(document) => shows(document, "Couldn't load branches."),
	),
	UNTRACKED_NOTE,
	COMMIT_SCOPE,
	DIFF_ERROR,
	DIFF_EMPTY,
	WHITESPACE_DIFF,
	STACK_LOAD_ERROR,
	REVIEW_MENU,
	REVIEW_DIALOG,
	REVIEW_TOOLTIP,
	EDIT_FIND,
	preview(
		"file-svg-preview",
		"An SVG preview with its rendered and source views",
		{ tab: "file", path: "logo.svg", fileMode: "edit" },
		{ "logo.svg": '<svg xmlns="http://www.w3.org/2000/svg"><circle r="10" /></svg>\n' },
		"View rendered SVG",
	),
	preview(
		"file-csv-empty",
		"An empty CSV file",
		{ tab: "file", path: "prices.csv", fileMode: "edit" },
		{ "prices.csv": "" },
		"Empty CSV",
	),
];
