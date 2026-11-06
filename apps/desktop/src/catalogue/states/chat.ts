/**
 * @feature catalogue States of a workspace chat
 * Owns: a finished conversation (its work folded into one "3 tool calls, 2 messages" row, the final reply
 * and the footer with the turn's files), the same with that row opened (thinking, Read, Edit and Bash
 * rows), a chat that is working with a queued follow-up, and the three cards an agent waits on: a tool
 * approval, a question and a plan review; and a reply that uses every Markdown part (headings, lists,
 * inline code, a code block, a table, a quote, a callout, links and a rule).
 * Behaviour: ui-map.md 3.3 (chat), sessions-and-chats.md "Questions, approvals and plans".
 * Test first: not applicable; the screenshot run opens every state.
 */

import type { Workspace } from "../../core/model.ts";
import { animateCast, type Cast, chatRoute, refreshGit, seedCast } from "../cast.ts";
import { conversation } from "../conversation.ts";
import { click, shows } from "../dom.ts";
import { addChat, addEvents } from "../seeds.ts";
import type { CatalogueState, Scene } from "../state.ts";
import { CATALOGUE_NOW, MINUTE } from "../time.ts";
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

/** A reply that shows every Markdown part the chat renders. */
const MARKDOWN_REPLY = `## What changed

The upgrade touched three places. Each one is small, and the **pull request** lists them in order:

1. \`.node-version\` now reads \`24\`.
2. The Dockerfile starts from \`node:24-slim\`.
3. One test called \`url.parse\`, which Node 24 removed.

### The test fix

\`\`\`ts
// Before: url.parse is gone in Node 24.
const next = new URL(request.url).searchParams.get("next");
export const safe = next?.startsWith("/") ? next : "/";
\`\`\`

| Check | Before | After |
| --- | --- | --- |
| Unit tests | 1 failed | all pass |
| Build | 41 s | 38 s |

> Node 22 stays supported until April, so nothing else has to move today.

> [!NOTE]
> The release notes are on [nodejs.org](https://nodejs.org/en/blog/release).

---

- Run \`pnpm install\` after pulling.
- Nothing else needs your attention.`;

/** grove's second chat, with the Markdown reply. */
const markdownChat = async (world: World): Promise<Scene> => {
	const cast = await seedCast(world);
	const chat = await addChat(world, cast.grove, { title: "What changed in the upgrade" });
	const talk = conversation("grove-md", CATALOGUE_NOW - 30 * MINUTE);
	const turn = talk.user("Summarise what the Node 24 upgrade changed.");
	talk.text(turn, MARKDOWN_REPLY);
	talk.usage(turn, 24_000);
	talk.end(turn);
	await addEvents(world, chat.id, talk.events);
	return {
		route: chatRoute(cast.grove, chat),
		after: async ({ app }) => {
			await animateCast(world, cast, app);
			await refreshGit(app, cast.grove);
		},
		ready: (document) => shows(document, "Nothing else needs your attention"),
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
		id: "chat-markdown",
		group: "Workspace chat",
		title: "A reply in Markdown: headings, lists, code, a table, a quote, a callout and links",
		seed: markdownChat,
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
