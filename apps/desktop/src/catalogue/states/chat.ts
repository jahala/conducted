/**
 * @feature catalogue States of a workspace chat
 * Owns: a finished conversation (its work folded into one "3 tool calls, 2 messages" row, the final reply
 * and the footer with the turn's files), the same with that row opened (thinking, Read, Edit and Bash
 * rows), a chat that is working with a queued follow-up (and retrying a failed request), and the three cards an agent waits on: a tool
 * approval, a question and a plan review; a workspace with a closed chat, so the tab strip offers
 * "View chat history"; a workspace address no workspace answers ("Workspace not
 * found"); and a reply that uses every Markdown part (headings, lists, inline code, a code block, a
 * table, a quote, a callout, links and a rule); a long user message shortened with Show more; the reply just copied; the
 * plan review bar's three tooltips; and the toast
 * after copying a chat image.
 * Behaviour: ui-map.md 3.3 (chat), sessions-and-chats.md "Questions, approvals and plans".
 * Test first: not applicable; the screenshot run opens every state.
 */

import type { Workspace } from "../../core/model.ts";
import { animateCast, type Cast, chatRoute, refreshGit, seedCast } from "../cast.ts";
import { conversation } from "../conversation.ts";
import { click, has, hover, shows } from "../dom.ts";
import { setLiveState } from "../live.ts";
import { addChat, addEvents, addRepo, must } from "../seeds.ts";
import type { CatalogueState, Scene } from "../state.ts";
import { CATALOGUE_NOW, MINUTE } from "../time.ts";
import { HOME, type World } from "../world.ts";

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

> [!TIP]
> Run the unit tests before the build; they catch the same problems sooner.

> [!IMPORTANT]
> Node 24 drops \`url.parse\`, so every old call site has to move.

> [!WARNING]
> CI on main still runs Node 22 until the next release.

> [!CAUTION]
> Do not merge the Dockerfile change before the runtime change lands.

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

/** arbor's chat with a screenshot attached, and its attachment viewer open. */
/**
 * The screenshot the user attached: a browser window whose address ends at `/`. A picture the browser
 * loads, so the chip keeps its Open button as it does for a real image.
 */
const REDIRECT_SCREENSHOT = `data:image/svg+xml,${encodeURIComponent(
	'<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800" viewBox="0 0 1280 800">' +
		'<rect width="1280" height="800" fill="#f4f4f5"/>' +
		'<rect width="1280" height="56" fill="#e4e4e7"/>' +
		'<rect x="160" y="14" width="960" height="28" rx="14" fill="#ffffff"/>' +
		'<rect x="96" y="120" width="480" height="40" rx="6" fill="#d4d4d8"/>' +
		'<rect x="96" y="192" width="1088" height="16" rx="4" fill="#e4e4e7"/>' +
		'<rect x="96" y="224" width="880" height="16" rx="4" fill="#e4e4e7"/>' +
		"</svg>",
)}`;

async function attachmentChat(
	world: World,
	then?: { step: (document: Document) => Promise<void>; text: string },
): Promise<Scene> {
	const cast = await seedCast(world);
	const chat = await addChat(world, cast.arbor, { title: "Check the redirect screenshot" });
	const path = "/Users/sam/Desktop/redirect.png";
	const video = "/Users/sam/Desktop/redirect-clip.mp4";
	const talk = conversation("arbor-attachment", CATALOGUE_NOW - 20 * MINUTE);
	const turn = talk.user("Does this screenshot show the redirect losing the page?", {
		attachmentPaths: [path, video],
	});
	talk.text(turn, "It does: the address ends at `/` instead of `/billing`.");
	talk.usage(turn, 12_000);
	talk.end(turn);
	await addEvents(world, chat.id, talk.events);
	world.showPicture(path, REDIRECT_SCREENSHOT);
	return {
		route: chatRoute(cast.arbor, chat),
		after: async ({ app, document }) => {
			await animateCast(world, cast, app);
			await refreshGit(app, cast.arbor);
			await click(document, "button", "Open redirect.png");
			await then?.step(document);
		},
		ready: (document) => shows(document, then?.text ?? "Copy image"),
	};
}

/** The image's bytes, as the app's copy script prints them: a PNG signature, base64. */
const scriptImageRead = (world: World): void =>
	world.scriptShell((command) =>
		command.program === "sh" && command.args.includes("conducted-copy-image")
			? { ok: true, value: { stdout: "iVBORw0KGgo=", stderr: "", exitCode: 0 } }
			: null,
	);

/** A long brief the user pasted: longer than the chat shows before "Show more". */
const LONG_BRIEF = [
	"Rework the billing export so finance can reconcile it with the bank statements.",
	"Each row needs the invoice number, the customer's legal name, the net amount, the tax amount, the currency and the date the payment cleared, not the date the invoice was raised.",
	"Refunds should appear as their own rows with a negative amount and a reference to the invoice they refund.",
	"Keep the file as CSV with a header row, quote every text field, and use a full stop for decimals whatever the user's locale is.",
	"The export must stream, because the largest account has more than two hundred thousand invoices and the current version runs out of memory.",
	"Add tests for a refund, a partial payment, a currency other than the account's own, and an invoice that was cancelled after it was paid.",
	"Finally, document the columns in docs/billing/export.md so finance can check them without asking us.",
].join(" ");

async function longMessageChat(world: World): Promise<Scene> {
	const cast = await seedCast(world);
	const chat = await addChat(world, cast.arbor, { title: "Billing export for finance" });
	const talk = conversation("arbor-long-brief", CATALOGUE_NOW - 25 * MINUTE);
	const turn = talk.user(LONG_BRIEF);
	talk.text(turn, "I will start with the streaming writer, then the refund rows.");
	talk.usage(turn, 14_000);
	talk.end(turn);
	await addEvents(world, chat.id, talk.events);
	return {
		route: chatRoute(cast.arbor, chat),
		after: async ({ app }) => {
			await animateCast(world, cast, app);
			await refreshGit(app, cast.arbor);
		},
		ready: (document) => shows(document, "Show more"),
	};
}

export const CHAT_STATES: CatalogueState[] = [
	{
		id: "chat-copied",
		group: "Workspace chat",
		title: "The turn footer's copy button just after copying the reply",
		seed: async (world: World): Promise<Scene> => {
			const cast = await seedCast(world);
			return {
				route: chatRoute(cast.arbor, cast.chats.arbor),
				after: async ({ app, document }) => {
					await animateCast(world, cast, app);
					await refreshGit(app, cast.arbor);
					await click(document, "button", "Copy final message");
				},
				// An icon button: its name says Copied for a moment.
				ready: (document) => has(document, "button", "Copied"),
			};
		},
	},
	{
		id: "chat-long-message",
		group: "Workspace chat",
		title: "A long message from the user, shortened with Show more",
		seed: longMessageChat,
	},
	{
		id: "chat-turn-details",
		group: "Workspace chat",
		title: "The turn footer's details card open: start to end time, Fast mode and token counts",
		seed: castChat(
			(cast) => ({ route: chatRoute(cast.arbor, cast.chats.arbor), workspace: cast.arbor }),
			"Cache read",
			(document) => hover(document, "button", "Turn details"),
		),
	},
	{
		id: "chat-attachment-viewer",
		group: "Workspace chat",
		title:
			"A chat image open in the attachment viewer: Copy image, Download file, Open in default app",
		seed: (world) => attachmentChat(world),
	},
	{
		id: "chat-attachment-copied",
		group: "Workspace chat",
		title: "A chat image copied from the attachment viewer",
		seed: (world) => {
			scriptImageRead(world);
			return attachmentChat(world, {
				step: (document) => click(document, "button", "Copy image"),
				text: "Copied image to clipboard",
			});
		},
	},
	{
		id: "chat-attachment-copy-failed",
		group: "Workspace chat",
		title: "A chat image whose copy from the attachment viewer fails",
		seed: (world) => {
			// The copy script cannot read the file, so it prints nothing and fails.
			world.scriptShell((command) =>
				command.program === "sh" && command.args.includes("conducted-copy-image")
					? { ok: true, value: { stdout: "", stderr: "", exitCode: 1 } }
					: null,
			);
			return attachmentChat(world, {
				step: (document) => click(document, "button", "Copy image"),
				text: "Failed to copy to clipboard",
			});
		},
	},
	{
		id: "chat-attachment-saved",
		group: "Workspace chat",
		title: "A chat image saved from the attachment viewer to Downloads",
		seed: (world) => {
			world.memory.controls.queueDialogAnswers({ savePath: `${HOME}/Downloads/redirect.png` });
			world.scriptShell((command) =>
				command.program === "cp"
					? { ok: true, value: { stdout: "", stderr: "", exitCode: 0 } }
					: null,
			);
			return attachmentChat(world, {
				step: (document) => click(document, "button", "Download file"),
				text: "Image saved",
			});
		},
	},
	{
		id: "chat-attachment-save-failed",
		group: "Workspace chat",
		title: "A chat image whose save from the attachment viewer is refused",
		seed: (world) => {
			world.memory.controls.queueDialogAnswers({ savePath: "/Library/redirect.png" });
			world.scriptShell((command) =>
				command.program === "cp"
					? {
							ok: true,
							value: {
								stdout: "",
								stderr: "cp: /Library/redirect.png: Permission denied\n",
								exitCode: 1,
							},
						}
					: null,
			);
			return attachmentChat(world, {
				step: (document) => click(document, "button", "Download file"),
				text: "Failed to save image",
			});
		},
	},
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
		id: "chat-retrying",
		group: "Workspace chat",
		title: "Working, the agent retrying a failed request by itself",
		seed: async (world: World): Promise<Scene> => {
			const cast = await seedCast(world);
			return {
				route: chatRoute(cast.beacon, cast.chats.beacon),
				after: async ({ app }) => {
					await animateCast(world, cast, app);
					await refreshGit(app, cast.beacon);
					setLiveState(world, cast.chats.beacon.id, {
						retry: { attempt: 2, maxAttempts: 10, error: "The API is overloaded." },
					});
				},
				ready: (document) => shows(document, "Retry now"),
			};
		},
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
		id: "chat-history-button",
		group: "Workspace chat",
		title: "A workspace with a closed chat, so the tab strip offers View chat history",
		seed: async (world): Promise<Scene> => {
			const cast = await seedCast(world);
			const chat = await addChat(world, cast.grove, { title: "Fix the login redirect" });
			must(await world.repositories.sessions.close(chat.id));
			return {
				route: `/repository/${cast.grove.repoId}/workspace/${cast.grove.id}`,
				ready: (document) => has(document, "button", "View chat history"),
			};
		},
	},
	{
		id: "workspace-not-found",
		group: "Workspace chat",
		title: "A workspace address that no workspace answers, on a Mac with no workspaces",
		// With any workspace loaded, the route sends an unknown id to All workspaces (router.tsx), so
		// the gate's card shows only while the list is empty.
		seed: async (world): Promise<Scene> => {
			const atlas = await addRepo(world, { name: "atlas" });
			return {
				route: `/repository/${atlas.id}/workspace/workspace-that-is-gone`,
				ready: (document) => shows(document, "Workspace not found"),
			};
		},
	},
	{
		id: "chat-plan-review",
		group: "Workspace chat",
		title: "Plan review",
		seed: async (world) => {
			// The sidecar takes the answer to the plan it is waiting on and logs it, so the plan
			// review browser check (scripts/catalogue/plan-approve.browser.ts) can see what it got.
			world.answerSidecar({
				answerInteraction: ({ answer }) => {
					console.info("[catalogue] answered interaction:", JSON.stringify(answer));
					return { accepted: true, superseded: false };
				},
			});
			return castChat(
				(cast) => ({ route: chatRoute(cast.fjord, cast.chats.fjord), workspace: cast.fjord }),
				"Invalidate cached prices on write",
			)(world);
		},
	},
	...(
		[
			["chat-plan-copy-tooltip", "Copy", "Copy plan to clipboard"],
			["chat-plan-hand-off-tooltip", "Hand off", "Send plan to a new chat for implementation"],
			["chat-plan-approve-tooltip", "Approve", "Execute plan in current chat"],
		] as const
	).map(
		([id, button, tooltip]): CatalogueState => ({
			id,
			group: "Workspace chat",
			title: `Plan review, the ${button} button's tooltip`,
			seed: castChat(
				(cast) => ({ route: chatRoute(cast.fjord, cast.chats.fjord), workspace: cast.fjord }),
				tooltip,
				// Approve's name carries its shortcut after the word.
				(document) => hover(document, "button", button, { prefix: button === "Approve" }),
			),
		}),
	),
];
