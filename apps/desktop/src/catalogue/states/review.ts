/**
 * @feature catalogue States of the review screens: Changes, diff, comments, AI review and previews
 * Owns: the PR status popover, the Changes filter open, the target branch picker and its failure,
 * the untracked-files note, a commit scope, a diff that cannot load or has nothing to show, a
 * whitespace-only diff, the review menu, dialog and tooltip, an SVG preview, an empty CSV preview,
 * the editor's find and replace bar, a video and a PDF that cannot load, and unsaved edits to a file
 * that changed on disk (the banner, and the save it refuses), a file with a merge conflict, and a
 * new comment for the AI on a diff, and the question when it is cancelled with text.
 * Behaviour: ui-map.md 3.2, 3.6 and 5.2; REV-01, REV-02, REV-03, REV-05 and REV-08.
 * Test first: not applicable; the screenshot run opens every state.
 */

import { fileQueryKey } from "../../core/hooks.ts";
import { ARBOR_FILES, type Cast } from "../cast.ts";
import { click, fillIn, findFirst, has, hover, pressUntilTaken, shows } from "../dom.ts";
import type { ScriptedFile } from "../git-repo.ts";
import { setSetting } from "../seeds.ts";
import type { AfterContext, CatalogueState } from "../state.ts";
import type { World } from "../world.ts";
import { arborScene, COMMITTED_ONLY, prOf } from "./git.ts";
import { loginStack, stacked } from "./stacks.ts";

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

/** GitHub's members endpoint for arbor's stack, the read that fails in stack-load-error. */
const LOGIN_STACK_MEMBERS = `repos/{owner}/{repo}/stacks/${loginStack({}).number}`;

const STACK_LOAD_ERROR: CatalogueState = {
	id: "stack-load-error",
	group: "Stacked pull requests",
	title: "A stack whose pull requests cannot be read",
	// GitHub reports arbor's pull request and the stack it sits in, then the connection drops
	// before the stack's members are read.
	seed: async (world: World) => {
		const scene = await arborScene({
			git: stacked(loginStack({})),
			ready: (document) =>
				shows(document, "Couldn't load this stack. Open the PR on GitHub to see it."),
		})(world);
		world.scriptShell((command) =>
			command.program === "gh" &&
			command.args[0] === "api" &&
			command.args[1] === LOGIN_STACK_MEMBERS
				? {
						ok: true,
						value: {
							stdout: "",
							stderr: `Get "https://api.github.com/repos/acme/atlas/stacks/${loginStack({}).number}": dial tcp: lookup api.github.com: no such host\n`,
							exitCode: 1,
						},
					}
				: null,
		);
		return scene;
	},
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
			// Find in file belongs to the editor, so the key is pressed with the editor focused.
			await pressUntilTaken(document, "f", { meta: true }, "[data-file-viewer] .cm-content");
		},
		ready: (document) => shows(document, "Replace All"),
	}),
};

/**
 * A preview whose file the webview cannot load. The catalogue's files have asset:// addresses, which
 * the browser cannot open, as the app's webview cannot open a codec it does not know.
 */
const previewFails = (id: string, title: string, path: string, text: string): CatalogueState => ({
	id,
	group: "File viewer",
	title,
	seed: arborScene({
		blobs: { [path]: new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]) },
		search: { tab: "file", path, fileMode: "edit" },
		after: ({ document }) => click(document, "button", "Preview"),
		ready: (document) => shows(document, text),
	}),
});

const SIGN_IN_DIFF = {
	tab: "file",
	path: "src/auth/sign-in.ts",
	fileMode: "diff",
	scope: "branch",
};
const NEW_COMMENT = 'textarea[placeholder="Add a comment for the AI"]';

/** A new comment for the AI on the first line of sign-in.ts's diff, from the gutter's button. */
const openNewComment = (document: Document): Promise<void> =>
	click(document, "button", "Add a comment for the AI");

const NEW_COMMENT_STATE: CatalogueState = {
	id: "diff-comment-new",
	group: "Git panel",
	title: "A file's diff with a new comment for the AI being written",
	seed: arborScene({
		search: SIGN_IN_DIFF,
		after: ({ document }) => openNewComment(document),
		ready: (document) => document.querySelector(NEW_COMMENT) !== null,
	}),
};

const DISCARD_COMMENT: CatalogueState = {
	id: "diff-comment-discard",
	group: "Git panel",
	title: "Cancelling a comment with text asks before discarding it",
	seed: arborScene({
		search: SIGN_IN_DIFF,
		after: async ({ document }) => {
			await openNewComment(document);
			const field = await findFirst(document, NEW_COMMENT);
			if (!(field instanceof HTMLTextAreaElement)) throw new Error("No comment field.");
			fillIn(field, "Keep the query string too.");
			await click(document, "button", "Cancel");
		},
		ready: (document) => shows(document, "Discard comment?"),
	}),
};

const NOTES = "notes.txt";

/** The user has unsaved edits to notes.txt, and an agent then writes the file. */
async function changeOnDisk({ app, world }: AfterContext, cast: Cast): Promise<void> {
	const workspace = cast.arbor;
	// A planted file has the modified time 0; the editor opened it at that time.
	app.container.services.workspaceFiles.editDraft(workspace.id, NOTES, "alpha beta\nmy edit\n", {
		text: "alpha beta\n",
		modifiedAt: 0,
	});
	const written = await world.memory.platform.fs.writeTextAtomic(
		`${workspace.path}/${NOTES}`,
		"alpha beta\nthe agent's line\n",
	);
	if (!written.ok) throw new Error(`Writing ${NOTES} failed: ${written.error.message}`);
	// The viewer polls the modified time every 5 seconds; read it now instead.
	await app.queryClient.invalidateQueries({ queryKey: fileQueryKey(workspace.id, NOTES) });
}

const DISK_CHANGE: CatalogueState = {
	id: "file-changed-on-disk",
	group: "File viewer",
	title: "Unsaved edits to a file that changed on disk",
	seed: arborScene({
		files: { [NOTES]: "alpha beta\n" },
		search: { tab: "file", path: NOTES, fileMode: "edit" },
		after: changeOnDisk,
		ready: (document) =>
			shows(document, "Keep mine") && has(document, "[role=status]", "Unsaved changes"),
	}),
};

const SAVE_REFUSED: CatalogueState = {
	id: "file-save-changed-on-disk",
	group: "File viewer",
	title: "Saving edits to a file that changed on disk",
	seed: arborScene({
		files: { [NOTES]: "alpha beta\n" },
		search: { tab: "file", path: NOTES, fileMode: "edit" },
		after: async (context, cast) => {
			await changeOnDisk(context, cast);
			// Saving belongs to the editor, so Cmd+S is pressed with the editor focused.
			await pressUntilTaken(
				context.document,
				"s",
				{ meta: true },
				"[data-file-viewer] .cm-content",
			);
		},
		ready: (document) =>
			shows(document, "File changed on disk. Keep or discard your edits to save."),
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
		{ atlasBranchesBroken: true },
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
	previewFails(
		"file-video-failed",
		"A video the webview cannot load",
		"demo.mp4",
		"Failed to load video",
	),
	previewFails(
		"file-pdf-failed",
		"A PDF the webview cannot load",
		"guide.pdf",
		"Failed to load PDF",
	),
	NEW_COMMENT_STATE,
	DISCARD_COMMENT,
	DISK_CHANGE,
	SAVE_REFUSED,
	{
		id: "file-conflicts",
		group: "File viewer",
		title: "Edit mode on a file with a merge conflict",
		seed: arborScene({
			files: {
				"src/config.ts":
					"export const config = {\n<<<<<<< HEAD\n\tport: 3000,\n=======\n\tport: 4000,\n>>>>>>> main\n};\n",
			},
			search: { tab: "file", path: "src/config.ts", fileMode: "edit" },
			ready: (document) => shows(document, "Accept incoming change"),
		}),
	},
	preview(
		"file-csv-empty",
		"An empty CSV file",
		{ tab: "file", path: "prices.csv", fileMode: "edit" },
		{ "prices.csv": "" },
		"Empty CSV",
	),
];
