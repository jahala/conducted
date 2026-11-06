/**
 * @feature catalogue States of a workspace chat
 * Owns: a finished conversation (its work folded into one "3 tool calls, 2 messages" row, the final reply
 * and the footer with the turn's files), the same with that row opened (thinking, Read, Edit and Bash
 * rows), a chat that is working with a queued follow-up, and the three cards an agent waits on: a tool
 * approval, a question and a plan review.
 * Behaviour: ui-map.md 3.3 (chat), sessions-and-chats.md "Questions, approvals and plans".
 * Test first: not applicable; the screenshot run opens every state.
 */

import type { Workspace } from "../../core/model.ts";
import { animateCast, type Cast, chatRoute, refreshGit, seedCast } from "../cast.ts";
import { click, shows } from "../dom.ts";
import type { CatalogueState, Scene } from "../state.ts";
import type { World } from "../world.ts";

/** The cast, with one of its chats open. */
const castChat =
	(
		pick: (cast: Cast) => { route: string; workspace: Workspace },
		text: string,
		then?: (document: Document) => Promise<void>,
	) =>
	async (world: World): Promise<Scene> => {
		const cast = await seedCast(world);
		const { route, workspace } = pick(cast);
		return {
			route,
			after: async ({ app, document }) => {
				await animateCast(world, cast, app);
				await refreshGit(app, workspace);
				await then?.(document);
			},
			ready: (document) => shows(document, text),
		};
	};

export const CHAT_STATES: CatalogueState[] = [
	{
		id: "chat-finished",
		group: "Workspace chat",
		title: "Finished conversation: the work folded into one row, the reply and its footer",
		seed: castChat(
			(cast) => ({ route: chatRoute(cast.arbor, cast.chats.arbor), workspace: cast.arbor }),
			"The redirect now keeps the page",
		),
	},
	{
		id: "chat-tool-calls",
		group: "Workspace chat",
		title: "Finished conversation with its folded row opened: thinking, Read, Edit and Bash rows",
		seed: castChat(
			(cast) => ({ route: chatRoute(cast.arbor, cast.chats.arbor), workspace: cast.arbor }),
			"pnpm test src/auth",
			(document) => click(document, "button", "Expand", { prefix: true }),
		),
	},
	{
		id: "chat-working",
		group: "Workspace chat",
		title: "Working, with a queued follow-up",
		seed: castChat(
			(cast) => ({ route: chatRoute(cast.beacon, cast.chats.beacon), workspace: cast.beacon }),
			"Retry-After header",
		),
	},
	{
		id: "chat-approval",
		group: "Workspace chat",
		title: "Tool approval card",
		seed: castChat(
			(cast) => ({ route: chatRoute(cast.canyon, cast.chats.canyon), workspace: cast.canyon }),
			"pnpm add @radix-ui/react-switch",
		),
	},
	{
		id: "chat-question",
		group: "Workspace chat",
		title: "Question card",
		seed: castChat(
			(cast) => ({ route: chatRoute(cast.ember, cast.chats.ember), workspace: cast.ember }),
			"How long should a failed webhook keep retrying?",
		),
	},
	{
		id: "chat-plan-review",
		group: "Workspace chat",
		title: "Plan review",
		seed: castChat(
			(cast) => ({ route: chatRoute(cast.fjord, cast.chats.fjord), workspace: cast.fjord }),
			"Invalidate cached prices on write",
		),
	},
];
