/**
 * @feature catalogue More states of the Git panel header, one per case it tells apart
 * Owns: arbor's header when a reviewer asked for changes, when GitHub finds a conflict, while the
 * pull request waits in the merge queue, after it was closed, while GitHub has not said whether it
 * can merge (with and without checks), when this Mac is offline or GitHub refuses the sign-in, on a
 * detached HEAD, when the branch and its remote have both moved on (and when the remote was
 * force-pushed), and with commits to push.
 * Behaviour: ui-map.md 3.6, table "Header status chip and action"; core/status/git-header.ts
 * decides each case from what git and GitHub answer.
 * Test first: not applicable; the screenshot run opens every state.
 */

import type { GitWorld } from "../cast.ts";
import { shows } from "../dom.ts";
import type { CatalogueState } from "../state.ts";
import { CATALOGUE_NOW, HOUR } from "../time.ts";
import { arborScene, COMMITTED_ONLY, prOf } from "./git.ts";

const header = (
	id: string,
	title: string,
	scene: Parameters<typeof arborScene>[0],
	text: string,
): CatalogueState => ({
	id,
	group: "Pull request header",
	title,
	seed: arborScene({ ...scene, ready: (document) => shows(document, text) }),
});

/** lee asked for one change on arbor's pull request. */
const changesRequested: GitWorld = (() => {
	const world = prOf("changes_requested");
	return {
		...world,
		prs: (world.prs ?? []).map((pr) => ({
			...pr,
			reviewComments: [
				{
					path: "src/auth/safe-next.ts",
					line: 6,
					body: "Refuse a path that starts with a backslash too; some browsers read /\\evil.example as another site.",
					author: "lee",
					at: CATALOGUE_NOW - 2 * HOUR,
				},
			],
		})),
	};
})();

export const PR_HEADER_STATES: CatalogueState[] = [
	header(
		"pr-changes-requested",
		"A reviewer asked for changes, with a review comment not in the chat yet",
		{ git: changesRequested },
		"Add all comments to chat",
	),
	header(
		"pr-conflicts",
		"GitHub finds a conflict with the base branch",
		{ git: prOf("conflicting") },
		"Merge conflicts",
	),
	header("pr-merge-queue", "Waiting in the merge queue", { git: prOf("queued") }, "In merge queue"),
	header("pr-closed", "Closed without merging", { git: prOf("closed") }, "Unable to merge"),
	header(
		"pr-blocked",
		"Approved and checks passed, mergeability not known yet",
		{ git: prOf("blocked") },
		"Blocked from merging",
	),
	header(
		"pr-checking-mergeability",
		"Approved, no checks yet, GitHub still checking mergeability",
		{ git: prOf("checking") },
		"Checking mergeability",
	),
	header(
		"pr-offline",
		"No pull request can be read: this Mac is offline",
		{ git: { arborFiles: [], github: "offline" } },
		"No internet connection",
	),
	header(
		"pr-no-github-access",
		"No pull request can be read: GitHub refuses the sign-in",
		{ git: { arborFiles: [], github: "unauthorized" } },
		"GitHub access required",
	),
	header(
		"git-detached-head",
		"No branch checked out (detached HEAD)",
		{ git: { arborFiles: [], arborDetached: true } },
		"Detached HEAD",
	),
	header(
		"pr-diverged",
		"The branch and its remote have both moved on",
		{ git: { ...prOf("open"), arborUpstream: { ahead: 1, behind: 2 } } },
		"Incompatible with remote",
	),
	header(
		"pr-remote-rebased",
		"The remote branch was force-pushed after this branch's tip was pushed",
		{
			git: { ...prOf("open"), arborUpstream: { ahead: 1, behind: 2 }, arborRemoteRewritten: true },
		},
		"Remote branch was rebased",
	),
	header(
		"pr-ahead",
		"Commits to push to the open pull request",
		{
			git: { ...prOf("open"), arborFiles: COMMITTED_ONLY, arborUpstream: { ahead: 2, behind: 0 } },
		},
		"Ahead by 2 commits",
	),
];
