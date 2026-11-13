/**
 * @feature catalogue States of the Git panel and the pull request header
 * Owns: the Changes tab with files, a file's diff and its View options menu, the workspace header's
 * actions menu, a chat tab's context menu, the diff scope menu with the branch's commits, the
 * All files tab, the Checks tab, the header with no pull request, an open one, a draft, one with a
 * failed check, one ready to merge and a merged one, the Changes tab when the tree is clean and when git fails,
 * the Changes tab as a folder tree with a filter that matches nothing, the tab strip's new tab menu,
 * a file's right-click menu in All files, a changed file's discard confirm, the Rename workspace dialog, the toast
 * after Copy link, the question before archiving a workspace whose agent works, the toast when
 * Archive workspace finds no workspace open, the Artifacts tab
 * with one file, the working directories picker (on a folder with uncommitted changes, and while git lists the folders), and the All
 * files tab holding every kind in Conductor's brand file icon table, in
 * parts.
 * Behaviour: ui-map.md 3.6 (Git panel), 3.4 (diff view), 3.7.x (pull request header); core/status/
 * git-header.ts decides the header state and its main action.
 * Test first: not applicable; the screenshot run opens every state.
 */
import type { Workspace } from "../../core/model.ts";
import { BRAND_TABLE } from "../../ui/file-icon.ts";
import {
	ARBOR_FILES,
	animateCast,
	type Cast,
	chatRoute,
	type GitWorld,
	refreshGit,
	seedCast,
	workspaceRoute,
} from "../cast.ts";
import { click, find, has, hover, pressUntilTaken, rightClick, shows, typeInto } from "../dom.ts";
import type { PrKind, ScriptedPr } from "../github.ts";
import type { AfterContext, CatalogueState, Scene } from "../state.ts";
import { CATALOGUE_NOW, DAY } from "../time.ts";
import type { World } from "../world.ts";

export interface GitScene {
	git?: GitWorld;
	/** The route's search, besides arbor's chat tab. */
	search?: Record<string, string>;
	/** Runs after git and the pull request were read; it gets the cast the scene seeded. */
	after?: (context: AfterContext, cast: Cast) => Promise<void>;
	ready?: Scene["ready"];
	/** Leave the pull request unpolled, so the header still loads. */
	skipPullRequest?: boolean;
	/** Extra files to plant in arbor, by path, so a state can show several file kinds. */
	files?: Readonly<Record<string, string>>;
	/** Binary files to plant in arbor, by path: a video or a PDF the file tab previews. */
	blobs?: Readonly<Record<string, Uint8Array>>;
}

/** The cast with arbor open, its git described by `scene.git`. */
export const arborScene =
	(scene: GitScene) =>
	async (world: World): Promise<Scene> => {
		const cast = await seedCast(world, scene.git);
		const workspace: Workspace = cast.arbor;
		for (const [path, text] of Object.entries(scene.files ?? {})) {
			world.memory.controls.files.set(`${workspace.path}/${path}`, text);
		}
		for (const [path, bytes] of Object.entries(scene.blobs ?? {})) {
			world.memory.controls.blobs.set(`${workspace.path}/${path}`, bytes);
		}
		const route =
			scene.search === undefined
				? chatRoute(workspace, cast.chats.arbor)
				: workspaceRoute(workspace, scene.search);
		return {
			route,
			after: async (context) => {
				await refreshGit(context.app, workspace, { pullRequest: scene.skipPullRequest !== true });
				await scene.after?.(context, cast);
			},
			ready: scene.ready,
		};
	};

export const COMMITTED_ONLY = ARBOR_FILES.filter((file) => file.committed);

/** arbor's login fix as a pull request in the given state. */
export const prOf = (kind: PrKind, fields: Partial<ScriptedPr> = {}): GitWorld => ({
	arborFiles: COMMITTED_ONLY,
	prs: [
		{
			...fields,
			kind,
			number: 231,
			title: "Keep the requested page after sign-in",
			branch: "sam/fix-login-redirect",
			base: "main",
			createdAt: CATALOGUE_NOW - DAY,
		},
	],
});

/** Where the brand glyph states plant their files: a folder, so arbor's own root files stay as they are. */
const KINDS_FOLDER = "file-kinds";

/** Files a glyph state plants: with arbor's root rows, the open folder stays on one 900px screen. */
const KINDS_PER_STATE = 14;

/**
 * A file for every name and extension in Conductor's brand table (#534), then two kinds outside it
 * that keep their Material icons, cut into parts of KINDS_PER_STATE so the shots draw every glyph
 * and tint in light and dark.
 */
const KIND_PARTS: readonly (readonly string[])[] = (() => {
	const names = [
		...Object.keys(BRAND_TABLE.names),
		"Dockerfile",
		"Dockerfile.dev",
		...Object.keys(BRAND_TABLE.extensions).map((extension) => `sample.${extension}`),
		"init.lua",
		"Makefile",
	];
	return Array.from({ length: Math.ceil(names.length / KINDS_PER_STATE) }, (_, part) =>
		names.slice(part * KINDS_PER_STATE, (part + 1) * KINDS_PER_STATE),
	);
})();

/** The All files tab with one part of the brand table's kinds open in KINDS_FOLDER. */
const kindsState = (names: readonly string[], part: number): CatalogueState => ({
	id: `git-files-glyphs-${part + 1}`,
	group: "Git panel",
	title: `All files tab with Conductor's file glyphs, part ${part + 1} of ${KIND_PARTS.length}`,
	seed: arborScene({
		files: Object.fromEntries(names.map((name) => [`${KINDS_FOLDER}/${name}`, `${name}\n`])),
		after: async ({ document }) => {
			await click(document, "button,[role=tab]", "All files");
			await click(document, "[role=treeitem]", KINDS_FOLDER);
		},
		ready: (document) => names.every((name) => shows(document, name)),
	}),
});

/**
 * arbor's All files tab with the working directories picker open. Git lists arbor's folders, with
 * sparse checkout off; `hold` keeps the listing running.
 */
const workingDirectoriesState = (
	id: string,
	title: string,
	text: string,
	hold: boolean,
	pointAt?: string,
): CatalogueState => ({
	id,
	group: "Git panel",
	title,
	seed: async (world) => {
		const scene = await arborScene({
			after: async ({ document }) => {
				await click(document, "button,[role=tab]", "All files");
				await click(document, "button", "Select working directories");
				if (pointAt !== undefined) await hover(document, '[role="option"]', pointAt);
			},
			ready: (document) => shows(document, text),
		})(world);
		world.scriptShell((command) => {
			if (command.program !== "git") return null;
			const args = command.args[0] === "-c" ? command.args.slice(2) : command.args;
			if (args[0] === "config" && args.at(-1) === "core.sparseCheckout") {
				return { ok: true, value: { stdout: "", stderr: "", exitCode: 1 } };
			}
			if (args[0] !== "ls-tree" || args[1] !== "-d") return null;
			if (hold) return new Promise(() => {});
			return {
				ok: true,
				value: { stdout: "docs\npublic\nscripts\nsrc\ntests\n", stderr: "", exitCode: 0 },
			};
		});
		return scene;
	},
});

export const GIT_STATES: CatalogueState[] = [
	workingDirectoriesState(
		"git-working-directories",
		"All files tab, the Select working directories picker",
		"Working directories",
		false,
	),
	// arbor's docs/redirects.md is not committed, so docs is locked while it is chosen.
	workingDirectoriesState(
		"git-working-directories-uncommitted",
		"All files tab, the working directories picker on a folder with uncommitted changes",
		"This directory has uncommitted changes.",
		false,
		"docs",
	),
	workingDirectoriesState(
		"git-working-directories-loading",
		"All files tab, the working directories picker while git lists the folders",
		"Loading directories...",
		true,
	),
	{
		id: "git-changes",
		group: "Git panel",
		title: "Changes tab with committed, uncommitted and new files",
		seed: arborScene({ ready: (document) => shows(document, "safe-next.test.ts") }),
	},
	{
		id: "git-file-row-menu",
		group: "Git panel",
		title: "All files tab, a file's right-click menu",
		seed: arborScene({
			after: async ({ document }) => {
				await click(document, "button,[role=tab]", "All files");
				await rightClick(document, '[role="treeitem"]', "README.md");
			},
			ready: (document) => shows(document, "Copy relative path"),
		}),
	},
	{
		id: "git-discard-file-dialog",
		group: "Git panel",
		title: "Changes tab, asking before it discards a file's changes",
		seed: arborScene({
			after: async ({ document }) => {
				await rightClick(document, "button", "Open src/auth/sign-in.ts");
				await click(document, "[role=menuitem]", "Discard changes");
			},
			ready: (document) => shows(document, "Discard file changes?"),
		}),
	},
	{
		id: "git-artifacts",
		group: "Git panel",
		title: "Artifacts tab with a file the agent left in .context",
		seed: arborScene({
			files: { ".context/release-notes.md": "# Release notes\n" },
			after: async ({ document }) => {
				await click(document, "button,[role=tab]", "Artifacts");
				// A file's Attach button shows on hover or focus; reach it as the keyboard does.
				(await find(document, "button", "Attach to chat")).focus();
			},
			ready: (document) => document.activeElement?.textContent === "Attach to chat",
		}),
	},
	{
		id: "git-diff",
		group: "Git panel",
		title: "A file's diff",
		seed: arborScene({
			search: { tab: "file", path: "src/auth/sign-in.ts", fileMode: "diff", scope: "branch" },
			// The layout toggles are icons since the file header took Conductor's look: read their names.
			ready: (document) => has(document, "button", "Unified view"),
		}),
	},
	{
		id: "git-diff-view-options",
		group: "Git panel",
		title: "A file's diff, its View options menu open",
		seed: arborScene({
			search: { tab: "file", path: "src/auth/sign-in.ts", fileMode: "diff", scope: "branch" },
			after: ({ document }) => click(document, "button", "View options"),
			ready: (document) => shows(document, "Hide whitespace changes"),
		}),
	},
	{
		id: "workspace-actions-menu",
		group: "Workspace chat",
		title: "The workspace actions menu, on the sidebar row's right click",
		seed: arborScene({
			after: ({ document }) =>
				rightClick(document, "a[aria-current=page]", "Fix login redirect", { prefix: true }),
			ready: (document) => shows(document, "Move to section"),
		}),
	},
	{
		id: "workspace-rename-dialog",
		group: "Workspace chat",
		title: "The Rename workspace dialog, from the sidebar row's right click",
		seed: arborScene({
			after: async ({ document }) => {
				await rightClick(document, "a[aria-current=page]", "Fix login redirect", { prefix: true });
				await click(document, "[role=menuitem]", "Rename");
			},
			ready: (document) => shows(document, "Enter a new name for this workspace"),
		}),
	},
	{
		id: "workspace-copied-link",
		group: "Workspace chat",
		title: "The toast after Copy link, from the sidebar row's right click",
		seed: arborScene({
			after: async ({ document }) => {
				await rightClick(document, "a[aria-current=page]", "Fix login redirect", { prefix: true });
				// The item's name carries its shortcut after the words.
				await click(document, "[role=menuitem]", "Copy link", { prefix: true });
			},
			ready: (document) => shows(document, "Copied link"),
		}),
	},
	{
		id: "workspace-archive-running",
		group: "Workspace chat",
		title: "Archiving a workspace whose agent is still working asks first",
		seed: async (world) => {
			const cast = await seedCast(world);
			return {
				route: chatRoute(cast.beacon, cast.chats.beacon),
				after: async ({ app, document }) => {
					await animateCast(world, cast, app);
					await refreshGit(app, cast.beacon);
					await rightClick(document, "a[aria-current=page]", "Rate limit api", { prefix: true });
					// The item's name carries its shortcut after the word.
					await click(document, "[role=menuitem]", "Archive", { prefix: true });
				},
				ready: (document) => shows(document, "Agents are still running in this workspace."),
			};
		},
	},
	{
		id: "archive-no-workspace",
		group: "Workspace chat",
		title: "Archive workspace pressed on Home, with no workspace open",
		seed: async (world) => {
			await seedCast(world);
			return {
				route: "/all-workspaces",
				after: async ({ document }) => {
					await find(document, "a,button,span", "Rate limit api");
					await pressUntilTaken(document, "a", { meta: true, shift: true });
				},
				ready: (document) => shows(document, "No workspace selected to archive"),
			};
		},
	},
	{
		id: "chat-tab-menu",
		group: "Workspace chat",
		title: "A chat tab's context menu",
		seed: arborScene({
			after: ({ document }) => rightClick(document, "[role=tab]", "Fix the login redirect"),
			ready: (document) => shows(document, "Rename chat"),
		}),
	},
	{
		id: "git-scope-menu",
		group: "Git panel",
		title: "Diff scope menu with the branch's commits",
		seed: arborScene({
			after: ({ document }) => click(document, "button", "Diff scope"),
			ready: (document) => shows(document, "Add safeNext with tests"),
		}),
	},
	{
		id: "git-files",
		group: "Git panel",
		title: "All files tab",
		seed: arborScene({
			after: ({ document }) => click(document, "button,[role=tab]", "All files"),
			ready: (document) => shows(document, "package.json"),
		}),
	},
	{
		id: "git-files-icons",
		group: "Git panel",
		title: "All files tab with several file kinds and their icons, one file open",
		seed: arborScene({
			files: {
				"main.rs": 'fn main() {\n\tprintln!("hello");\n}\n',
				"theme.ts": "export const theme = 'light';\n",
				"settings.json": '{\n  "theme": "light"\n}\n',
				"guide.md": "# Guide\n\nHow the atlas project fits together.\n",
				"app.css": ".app {\n\tcolor: black;\n}\n",
				"deploy.sh": "#!/bin/sh\nset -e\necho deploy\n",
				"logo.svg": '<svg xmlns="http://www.w3.org/2000/svg" />\n',
			},
			after: async ({ document }) => {
				await click(document, "button,[role=tab]", "All files");
				await click(document, "[role=treeitem]", "main.rs");
			},
			ready: (document) => has(document, "[role=tab]", "main.rs"),
		}),
	},
	...KIND_PARTS.map(kindsState),
	{
		id: "git-changes-clean",
		group: "Git panel",
		title: "Changes tab, nothing changed (empty)",
		seed: arborScene({
			git: { arborFiles: [] },
			ready: (document) => shows(document, "No file changes yet"),
		}),
	},
	{
		id: "git-changes-error",
		group: "Git panel",
		title: "Changes tab when git fails (error)",
		seed: arborScene({
			git: { arborBroken: true },
			ready: (document) => shows(document, "No git status"),
		}),
	},
	{
		id: "git-checks",
		group: "Git panel",
		title: "Checks tab: an open pull request with checks running",
		seed: arborScene({
			git: prOf("open"),
			after: ({ document }) => click(document, "button,[role=tab]", "Checks", { prefix: true }),
			ready: (document) => shows(document, "typecheck"),
		}),
	},
	{
		id: "git-checks-empty",
		group: "Git panel",
		title: "Checks tab with no pull request (empty)",
		seed: arborScene({
			git: { arborFiles: COMMITTED_ONLY },
			after: ({ document }) => click(document, "button,[role=tab]", "Checks", { prefix: true }),
		}),
	},
	{
		id: "pr-none",
		group: "Pull request header",
		title: "No pull request yet: the branch is pushed",
		seed: arborScene({ git: { arborFiles: COMMITTED_ONLY } }),
	},
	{
		id: "pr-loading",
		group: "Pull request header",
		title: "Pull request info loading",
		seed: arborScene({ git: prOf("open"), skipPullRequest: true }),
	},
	{
		id: "pr-open",
		group: "Pull request header",
		title: "Open pull request, checks running",
		seed: arborScene({ git: prOf("open") }),
	},
	{
		id: "pr-draft",
		group: "Pull request header",
		title: "Draft pull request",
		seed: arborScene({ git: prOf("draft") }),
	},
	{
		id: "pr-failing",
		group: "Pull request header",
		title: "Open pull request, a check failed",
		seed: arborScene({ git: prOf("failing") }),
	},
	{
		id: "pr-ready",
		group: "Pull request header",
		title: "Ready to merge: approved, checks passed",
		seed: arborScene({ git: prOf("ready") }),
	},
	{
		id: "pr-merged",
		group: "Pull request header",
		title: "Merged",
		seed: arborScene({ git: prOf("merged") }),
	},
	{
		id: "git-changes-filter-empty",
		group: "Git panel",
		title: "Changes tab as a folder tree, filtered by a name no file has",
		seed: arborScene({
			after: async ({ document }) => {
				await click(document, "button", "Show folder hierarchy");
				await click(document, "button", "Search changed files");
				await typeInto(document, "input", "Filter changed files", "billing");
			},
			ready: (document) => shows(document, "No files match this filter"),
		}),
	},
	{
		id: "workspace-new-tab-menu",
		group: "Workspace chat",
		title: "The tab strip's new tab menu",
		seed: arborScene({
			after: ({ document }) => click(document, "button", "New tab"),
			ready: (document) => shows(document, "New chat, same files"),
		}),
	},
];
