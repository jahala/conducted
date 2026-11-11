/**
 * @feature catalogue States of the chat's notices, errors and turn actions
 * Owns: a chat whose history was compacted, whose turn the user stopped, and whose next turn came
 * from another chat and ran into the session limit, with a notice's copy menu open; a chat whose
 * agent needs signing in and whose error had no words, with an error's copy menu open; a working
 * turn that is compacting, one that waits on a subagent and one that waits on a background task;
 * a finished turn's More actions menu and the Reset chat? dialog it opens; and a long chat read
 * from its top, with Scroll to bottom.
 * Behaviour: ui-map.md 3.3 (banners in the list: interrupted, compacted, compacting, session limit,
 * sign-in needed, "This content could not be displayed."; the working line; the turn footer's
 * menu; the Scroll to bottom button), sessions-and-chats.md (a message sent from another chat).
 * Test first: not applicable; the screenshot run opens every state.
 */

import type { SessionId } from "@conducted/shared";
import type { Session, Workspace } from "../../core/model.ts";
import { animateCast, type Cast, chatRoute, refreshGit, seedCast } from "../cast.ts";
import { type Conversation, conversation } from "../conversation.ts";
import { click, has, rightClick, shows } from "../dom.ts";
import { deliverEvents, setLiveState } from "../live.ts";
import { addChat, addEvents } from "../seeds.ts";
import type { AfterContext, CatalogueState } from "../state.ts";
import { CATALOGUE_NOW, MINUTE } from "../time.ts";
import type { World } from "../world.ts";

/** A second chat of arbor's, open, with `stored` written before the app starts. */
const arborChat =
	(
		title: string,
		stored: (chat: Session) => Conversation | null,
		text: string,
		then?: (context: AfterContext, chat: Session, cast: Cast) => Promise<void>,
	) =>
	async (world: World) => {
		const cast = await seedCast(world);
		const workspace: Workspace = cast.arbor;
		const chat = await addChat(world, workspace, { title });
		const talk = stored(chat);
		if (talk !== null) await addEvents(world, chat.id, talk.events);
		return {
			route: chatRoute(workspace, chat),
			after: async (context: AfterContext) => {
				await animateCast(world, cast, context.app);
				await refreshGit(context.app, workspace);
				await then?.(context, chat, cast);
			},
			ready: (document: Document) => shows(document, text),
		};
	};

/** Compacted history, a stopped turn, and a turn sent from another chat that hit the limit. */
function noticesChat(): Conversation {
	const chat = conversation("notices", CATALOGUE_NOW - 50 * MINUTE);
	const first = chat.user("Find every place that builds a redirect URL by hand.");
	chat.text(
		first,
		"Three places build one by hand: `signIn`, `signOut` and the OAuth callback. The rest go through `redirect`.",
	);
	chat.agent(first, [{ kind: "notice", notice: "compacted", text: "" }]);
	chat.usage(first, 12_400);
	chat.end(first);

	const stopped = chat.user("Move all three onto `redirect` and add a test for each.");
	chat.text(stopped, "Starting with `signOut`, which is the simplest of the three.");
	chat.end(stopped, undefined, "cancelled");

	const relayed = chat.user("Only change `signOut` for now; the callback needs a review first.", {
		sender: { kind: "other_chat", sessionId: "c-planning-chat" as SessionId },
	});
	chat.agent(relayed, [{ kind: "notice", notice: "rate_limit", text: "" }]);
	chat.end(relayed);

	const remote = chat.user("The staging redirect still drops the page; check it too.", {
		sender: { kind: "claude_ai" },
	});
	chat.text(remote, "Staging uses the same `safeNext`; its fix is in the same pull request.");
	chat.end(remote);
	return chat;
}

/** A turn the agent could not start because it is signed out, and an error with no words. */
function errorsChat(): Conversation {
	const chat = conversation("errors", CATALOGUE_NOW - 40 * MINUTE);
	const signedOut = chat.user("Add a test for the OAuth callback's redirect.");
	chat.agent(signedOut, [
		{
			kind: "error",
			code: "agent_auth_required",
			message: "Claude Code is not signed in. Sign in again to keep working.",
			retryable: false,
		},
	]);
	chat.end(signedOut, undefined, "error");

	const blank = chat.user("Try again now; I signed in.");
	chat.agent(blank, [{ kind: "error", code: "agent_crashed", message: "", retryable: false }]);
	chat.end(blank, undefined, "error");
	return chat;
}

/** A turn that is still running, delivered once the app is up. */
function runningTurn(
	prefix: string,
	ask: string,
	then: (chat: Conversation, turn: ReturnType<Conversation["user"]>) => void,
): Conversation {
	const chat = conversation(prefix, CATALOGUE_NOW - 3 * MINUTE, 10_000);
	const turn = chat.user(ask);
	then(chat, turn);
	return chat;
}

const nextFrame = (): Promise<void> =>
	new Promise((resolve) => requestAnimationFrame(() => resolve()));

/** Waits a bounded number of frames for `holds`, as the dom helpers wait for a control. */
async function waitFor(holds: () => boolean): Promise<void> {
	for (let frame = 0; frame < 300; frame++) {
		if (holds()) return;
		await nextFrame();
	}
	throw new Error("The screen never showed what the state waits for.");
}

async function waitForElement(document: Document, selector: string): Promise<HTMLElement> {
	await waitFor(() => document.querySelector(selector) !== null);
	const element = document.querySelector<HTMLElement>(selector);
	if (element === null) throw new Error(`No ${selector} appeared.`);
	return element;
}

/** A long finished chat: twelve turns of small questions about the code base. */
function longChat(): Conversation {
	const chat = conversation("long", CATALOGUE_NOW - 3 * 60 * MINUTE, 30_000);
	const topics = [
		["Where is the session cookie set?", "In `src/auth/session.ts`, by `createSession`."],
		["How long does a session last?", "Two weeks, renewed on every request."],
		["Is the cookie marked secure?", "Yes: `Secure`, `HttpOnly` and `SameSite=Lax`."],
		["Who reads the `next` parameter today?", "Nothing yet; `signIn` always sends users to `/`."],
		["Which tests cover sign-in?", "`src/auth/sign-in.test.ts`, with three cases."],
		["Do the tests hit a database?", "No. They use the in-memory session store."],
		["What happens on a failed sign-in?", "The form shows the error and keeps the email."],
		["Is there rate limiting on sign-in?", "Five tries a minute per address, in the middleware."],
		["Where are the redirect helpers?", "In `src/http/redirect.ts`, one function."],
		["Does `redirect` accept relative paths?", "Yes, and it passes them through unchanged."],
		["Any other callers of `redirect`?", "The OAuth callback and the sign-out route."],
		[
			"Summarise what we found.",
			"Sessions are sound; only the redirect after sign-in needs fixing.",
		],
	] as const;
	for (const [ask, answer] of topics) {
		const turn = chat.user(ask);
		chat.text(turn, answer);
		chat.usage(turn, 8_000);
		chat.end(turn);
	}
	return chat;
}

export const BANNER_STATES: CatalogueState[] = [
	{
		id: "chat-notices",
		group: "Workspace chat",
		title:
			"Notices: history compacted, a stopped turn, a message from another chat, the session limit",
		seed: arborChat(
			"Redirect helpers",
			() => noticesChat(),
			"Copy message",
			async ({ document }) => {
				await rightClick(document, "[role=note]", "Claude Code session limit reached");
			},
		),
	},
	{
		id: "chat-errors",
		group: "Workspace chat",
		title: "Errors: the agent needs signing in, an error with no words, its copy menu open",
		seed: arborChat(
			"OAuth callback test",
			() => errorsChat(),
			"Copy details",
			async ({ document }) => {
				await rightClick(document, "span", "This content could not be displayed.");
			},
		),
	},
	{
		id: "chat-compacting",
		group: "Workspace chat",
		title: "Working: the agent compacts the chat's history",
		seed: arborChat(
			"Redirect audit",
			() => null,
			"Compacting...",
			async ({ world }, chat) => {
				const running = runningTurn(
					"compacting",
					"Go through every route and list the ones that redirect after a form post.",
					(talk, turn) => {
						talk.text(turn, "I'll read the route table first.");
						talk.agent(turn, [{ kind: "notice", notice: "info", text: "Compacting conversation" }]);
					},
				);
				setLiveState(world, chat.id, {});
				deliverEvents(world, chat.id, running.events);
			},
		),
	},
	{
		id: "chat-waiting-agent",
		group: "Workspace chat",
		title: "Working: the turn waits for a subagent",
		seed: arborChat(
			"Review the auth module",
			() => null,
			"Waiting for agent",
			async ({ world }, chat) => {
				const running = runningTurn(
					"waiting-agent",
					"Have a subagent review the auth module while you write the changelog entry.",
					(talk, turn) => {
						talk.tool(turn, {
							tool: "sub_agent",
							rawName: "Task",
							input: { description: "", prompt: "Review src/auth for unsafe redirects." },
							output: null,
						});
					},
				);
				setLiveState(world, chat.id, {
					waitingSince: CATALOGUE_NOW - MINUTE,
					backgroundTasks: [{ id: "review", kind: "sub_agent", description: "" }],
				});
				deliverEvents(world, chat.id, running.events);
			},
		),
	},
	{
		id: "chat-waiting-task",
		group: "Workspace chat",
		title: "Working: the turn waits for a background task",
		seed: arborChat(
			"Run the slow tests",
			() => null,
			"Waiting for background task",
			async ({ world }, chat) => {
				const running = runningTurn(
					"waiting-task",
					"Run the end-to-end tests in the background and tell me when they finish.",
					(talk, turn) => {
						talk.tool(turn, {
							tool: "bash",
							rawName: "Bash",
							input: { command: "pnpm test:e2e", run_in_background: true },
							output: "Command running in background with ID: bash_1",
						});
					},
				);
				setLiveState(world, chat.id, {
					waitingSince: CATALOGUE_NOW - 2 * MINUTE,
					backgroundTasks: [{ id: "bash_1", kind: "shell", description: "" }],
				});
				deliverEvents(world, chat.id, running.events);
			},
		),
	},
	{
		id: "chat-turn-menu",
		group: "Workspace chat",
		title: "A finished turn's More actions menu: fork, reset and copy",
		seed: async (world) => {
			const cast = await seedCast(world);
			return {
				route: chatRoute(cast.arbor, cast.chats.arbor),
				after: async ({ app, document }) => {
					await animateCast(world, cast, app);
					await refreshGit(app, cast.arbor);
					await click(document, "button", "Show message actions");
				},
				ready: (document) => shows(document, "Copy summary"),
			};
		},
	},
	{
		id: "chat-reset-dialog",
		group: "Workspace chat",
		title: "Reset chat? from a finished turn's More actions menu",
		seed: async (world) => {
			const cast = await seedCast(world);
			return {
				route: chatRoute(cast.arbor, cast.chats.arbor),
				after: async ({ app, document }) => {
					await animateCast(world, cast, app);
					await refreshGit(app, cast.arbor);
					await click(document, "button", "Show message actions");
					await click(document, "[role=menuitem]", "Reset chat");
				},
				ready: (document) => shows(document, "Later messages will be deleted."),
			};
		},
	},
	{
		id: "chat-scroll-to-bottom",
		group: "Workspace chat",
		title: "A long chat read from its top, with Scroll to bottom",
		seed: arborChat(
			"Sign-in questions",
			() => longChat(),
			"Where is the session cookie set?",
			async ({ document }) => {
				// A reader scrolls back to the first question once the list has drawn its end.
				const scroller = await waitForElement(document, "[data-testid=virtuoso-scroller]");
				await waitFor(() => scroller.scrollTop > 0);
				for (let frame = 0; frame < 30; frame++) await nextFrame();
				scroller.scrollTop = 0;
				scroller.dispatchEvent(new Event("scroll"));
				await waitFor(() => has(document, "button", "Scroll to bottom"));
			},
		),
	},
];
