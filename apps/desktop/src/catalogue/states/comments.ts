/**
 * @feature catalogue States of review comments on arbor's diff
 * Owns: sign-in.ts's diff with a comment of the user's that suggests a change and the agent's
 * reply under it; the same comment in its own Comment tab; the Comment tab for a comment that
 * was deleted; and the tab of a reviewer's comment with nothing written in it ("No comment body").
 * Behaviour: ui-map.md 3.2 (Comment tab, "Comment not found"), 3.6 (comment card: author You,
 * Edit comment, Delete comment, Suggested change); REV-03.
 * Test first: not applicable; the screenshot run opens every state.
 */

import type { CommentId } from "@conducted/shared";
import { type Cast, refreshGit, seedCast, workspaceRoute } from "../cast.ts";
import { shows } from "../dom.ts";
import { must } from "../seeds.ts";
import type { CatalogueState, Scene } from "../state.ts";
import type { World } from "../world.ts";

/** The user's comment on the redirect line, with a suggested change, and the agent's reply. */
async function seedComments(world: World, cast: Cast): Promise<CommentId> {
	const { diffComments } = world.repositories;
	const comment = must(
		await diffComments.add({
			workspaceId: cast.arbor.id,
			filePath: "src/auth/sign-in.ts",
			line: 8,
			endLine: null,
			body: "Read `next` once and log when it is refused, so a bad link shows up in the logs.",
			author: { kind: "user", name: null, avatarUrl: null },
			side: "additions",
			threadId: "thread-redirect",
			replyToId: null,
			suggestion: "  return redirect(safeNext(next, { log: true }), { session });",
			suggestionBaseCode: "  return redirect(safeNext(next), { session });",
		}),
	);
	must(
		await diffComments.add({
			workspaceId: cast.arbor.id,
			filePath: "src/auth/sign-in.ts",
			line: 8,
			endLine: null,
			body: "Done: `safeNext` takes a `log` option and warns once per refused link.",
			author: { kind: "agent", name: "Claude", avatarUrl: null },
			side: "additions",
			threadId: "thread-redirect",
			replyToId: comment.id,
			suggestion: null,
			suggestionBaseCode: null,
		}),
	);
	return comment.id;
}

/** arbor with the comments seeded, open on `search`. */
const commentState = (
	id: string,
	title: string,
	search: (comment: CommentId) => Record<string, string>,
	text: string,
): CatalogueState => ({
	id,
	group: "Review comments",
	title,
	seed: async (world): Promise<Scene> => {
		const cast = await seedCast(world);
		const comment = await seedComments(world, cast);
		return {
			route: workspaceRoute(cast.arbor, search(comment)),
			after: ({ app }) => refreshGit(app, cast.arbor),
			ready: (document) => shows(document, text),
		};
	},
});

/** A reviewer's comment from GitHub with nothing written in it, on the redirect line. */
async function seedEmptyComment(world: World, cast: Cast): Promise<CommentId> {
	return must(
		await world.repositories.diffComments.add({
			workspaceId: cast.arbor.id,
			filePath: "src/auth/sign-in.ts",
			line: 8,
			endLine: null,
			body: "",
			author: { kind: "github", name: "mira-k", avatarUrl: null },
			side: "additions",
			threadId: "thread-empty",
			replyToId: null,
			suggestion: null,
			suggestionBaseCode: null,
		}),
	).id;
}

export const COMMENT_STATES: CatalogueState[] = [
	{
		id: "comment-tab-no-body",
		group: "Review comments",
		title: "The tab of a reviewer's comment with nothing written in it",
		seed: async (world): Promise<Scene> => {
			const cast = await seedCast(world);
			const comment = await seedEmptyComment(world, cast);
			return {
				route: workspaceRoute(cast.arbor, { tab: "comment", commentId: comment }),
				after: ({ app }) => refreshGit(app, cast.arbor),
				ready: (document) => shows(document, "No comment body"),
			};
		},
	},
	commentState(
		"diff-comments",
		"A file's diff with the user's suggested change and the agent's reply",
		() => ({ tab: "file", path: "src/auth/sign-in.ts", fileMode: "diff", scope: "branch" }),
		"Suggested change",
	),
	commentState(
		"comment-tab",
		"The user's comment in its own tab",
		(comment) => ({ tab: "comment", commentId: comment }),
		"Suggested change",
	),
	commentState(
		"comment-tab-missing",
		"The tab of a comment that was deleted",
		() => ({ tab: "comment", commentId: "comment-deleted" }),
		"Comment not found",
	),
];
