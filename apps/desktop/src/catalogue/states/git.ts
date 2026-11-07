/**
 * @feature catalogue States of the Git panel and the pull request header
 * Owns: the Changes tab with files, a file's diff and its View options menu, the workspace header's
 * actions menu, a chat tab's context menu, the diff scope menu with the branch's commits, the
 * All files tab, the Checks tab, the header with no pull request, an open one, a draft, one with a
 * failed check, one ready to merge and a merged one, and the Changes tab when the tree is clean and when git fails.
 * Behaviour: ui-map.md 3.6 (Git panel), 3.4 (diff view), 3.7.x (pull request header); core/status/
 * git-header.ts decides the header state and its main action.
 * Test first: not applicable; the screenshot run opens every state.
 */
import type { Workspace } from "../../core/model.ts";
import {
	ARBOR_FILES,
	type Cast,
	chatRoute,
	type GitWorld,
	refreshGit,
	seedCast,
	workspaceRoute,
} from "../cast.ts";
import { click, has, rightClick, shows } from "../dom.ts";
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
}

/** The cast with arbor open, its git described by `scene.git`. */
export const arborScene =
	(scene: GitScene) =>
	async (world: World): Promise<Scene> => {
		const cast = await seedCast(world, scene.git);
		const workspace: Workspace = cast.arbor;
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

export const GIT_STATES: CatalogueState[] = [
	{
		id: "git-changes",
		group: "Git panel",
		title: "Changes tab with committed, uncommitted and new files",
		seed: arborScene({ ready: (document) => shows(document, "safe-next.test.ts") }),
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
];
