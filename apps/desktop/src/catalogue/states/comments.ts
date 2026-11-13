/**
 * @feature catalogue States of review comments on arbor's diff
 * Owns: sign-in.ts's diff with a comment of the user's that suggests a change and the agent's
 * reply under it; the same comment in its own Comment tab; and the Comment tab for a comment that
 * was deleted; the comment resolved, its edit cancelled with changes, its edit refused, and its
 * Add to chat failing.
 * Behaviour: ui-map.md 3.2 (Comment tab, "Comment not found"), 3.6 (comment card: author You,
 * Edit comment, Delete comment, Suggested change); REV-03.
 * Test first: not applicable; the screenshot run opens every state.
 */

import type { CommentId } from "@conducted/shared";
import { type Cast, refreshGit, seedCast, workspaceRoute } from "../cast.ts";
import { click, fillIn, findField, shows } from "../dom.ts";
import { must } from "../seeds.ts";
import type { AfterContext, CatalogueState, Scene } from "../state.ts";
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

/** arbor with the comments seeded, open on `search`, then `then`. */
const commentState = (
	id: string,
	title: string,
	search: (comment: CommentId) => Record<string, string>,
	text: string,
	then?: (context: AfterContext) => Promise<void>,
	before?: (world: World, cast: Cast, comment: CommentId) => Promise<void>,
): CatalogueState => ({
	id,
	group: "Review comments",
	title,
	seed: async (world): Promise<Scene> => {
		const cast = await seedCast(world);
		const comment = await seedComments(world, cast);
		await before?.(world, cast, comment);
		return {
			route: workspaceRoute(cast.arbor, search(comment)),
			after: async (context) => {
				await refreshGit(context.app, cast.arbor);
				await then?.(context);
			},
			ready: (document) => shows(document, text),
		};
	},
});

const COMMENT_TAB = (comment: CommentId) => ({ tab: "comment", commentId: comment });

/** Opens the comment tab's editor and changes the text. */
async function editComment(document: Document): Promise<void> {
	await click(document, "button", "Edit comment");
	fillIn(
		await findField(document, 'textarea[aria-label="Edit comment"]'),
		"Read `next` once, and log a refused link at warn level.",
	);
}

export const COMMENT_STATES: CatalogueState[] = [
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
	commentState(
		"comment-tab-resolved",
		"The user's comment in its own tab, resolved",
		COMMENT_TAB,
		"Resolved",
		undefined,
		async (world, _cast, comment) => {
			must(await world.repositories.diffComments.setResolved(comment, true));
		},
	),
	commentState(
		"comment-tab-discard",
		"The user's comment being edited, cancelled with changes: Discard comment?",
		COMMENT_TAB,
		"Discard comment?",
		async ({ document }) => {
			await editComment(document);
			await click(document, "fieldset button", "Cancel");
		},
	),
	commentState(
		"comment-tab-save-failed",
		"The user's comment edited, its save refused by the database",
		COMMENT_TAB,
		"Failed to save comment",
		async ({ document, world }) => {
			await editComment(document);
			await world.failWrites("diff_comments", "UPDATE");
			await click(document, "fieldset button", "Save");
		},
	),
	commentState(
		"comment-tab-add-to-chat-failed",
		"The user's comment whose Add to chat fails",
		COMMENT_TAB,
		"Failed to add comment to chat",
		({ document }) => click(document, "button", "Add to chat"),
		// A file stands where the comments' folder must go, so the comment cannot be written for the agent.
		async (world, cast) => world.memory.controls.addFile(`${cast.arbor.path}/.context`, ""),
	),
];
