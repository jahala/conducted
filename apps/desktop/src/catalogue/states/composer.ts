/**
 * @feature catalogue States of the composer
 * Owns: a new chat with an empty composer (the empty chat, and one offering an earlier chat as
 * context), the composer with a draft and two attached
 * files, the @ menu (and a search with no match), the chat's find bar, the auto-accept chip, the composer with the model
 * picker open (searched with no match, and switching the model of
 * a started chat), the slash command menu after typing "/" (Claude,
 * Codex, and with a Skills group), a typed command that cannot run here, the "+" menu, the Create
 * snippet dialog, the snippet picker with no snippets yet, the Link issue dialog with atlas's
 * GitHub issues and Linear not connected (and with no open issues), and the warning when fast mode
 * cannot be paid for.
 * Behaviour: ui-map.md 3.5 (composer and its "+" menu), 3.10 (Link issue), 5.1 and 5.2 (snippets),
 * COMP-01 (drafts and attachments).
 * Test first: not applicable; the screenshot run opens every state.
 */
import type { Session, Workspace } from "../../core/model.ts";
import { chatRoute, type GitWorld, refreshGit, seedCast } from "../cast.ts";
import { conversation } from "../conversation.ts";
import { click, find, has, hover, pressUntilTaken, shows, typeInto } from "../dom.ts";
import { setLiveState } from "../live.ts";
import { addChat, addEvents, CLAUDE_CONFIG, must, setSetting } from "../seeds.ts";
import type { AfterContext, CatalogueState, Scene } from "../state.ts";
import { CATALOGUE_NOW, DAY, HOUR } from "../time.ts";
import type { World } from "../world.ts";

/** The cast, with a new, empty chat open in arbor. */
async function newChat(
	world: World,
	after: (context: AfterContext, chat: Session) => Promise<void>,
	ready: Scene["ready"],
	git: GitWorld = {},
): Promise<Scene> {
	const cast = await seedCast(world, git);
	const chat = await addChat(world, cast.arbor, { title: null });
	const workspace: Workspace = cast.arbor;
	return {
		route: chatRoute(workspace, chat),
		after: async (context) => {
			await refreshGit(context.app, workspace);
			await after(context, chat);
		},
		ready,
	};
}

const NOTES = `# Sign-in redirect notes

- Keep \`next\` only when it is a path on this site.
- Log a warning when an outside URL is refused.
`;

const LOG = `09:12:04 GET /login?next=%2Fbilling 200
09:12:09 POST /login 303 location=/
09:12:09 GET / 200
`;

/** The composer's "+" button. */
const PLUS_MENU = "Add attachments, link issues, and more";

/** Types into the composer as a keyboard does: the editor reads the browser's own text input. */
async function typeInComposer(document: Document, text: string): Promise<void> {
	const editor = await find(document, '[contenteditable="true"]', "composer");
	editor.focus();
	document.execCommand("insertText", false, text);
}

/** Types a slash command and presses Enter, so the composer says why it cannot run. */
async function submitSlash(document: Document, text: string): Promise<void> {
	await typeInComposer(document, text);
	// A frame lets the suggestion menu open, as a keyboard's Enter would find it.
	await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
	const editor = await find(document, '[contenteditable="true"]', "composer");
	editor.dispatchEvent(
		new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
	);
}

/** arbor's chat with a finished turn whose usage the context wheel can show. */
async function contextUsageChat(world: World, holdDetails = false): Promise<Scene> {
	const cast = await seedCast(world);
	await setSetting(world, "always_show_context_wheel", true);
	must(await world.repositories.modelContextWindows.record("claude", "claude-opus-4-7", 200_000));
	const chat = await addChat(world, cast.arbor, {
		title: "How the redirect keeps its page",
		config: { ...CLAUDE_CONFIG, model: "claude-opus-4-7", fastMode: true },
	});
	const talk = conversation("arbor-usage", CATALOGUE_NOW - 10 * 60_000);
	const turn = talk.user("Explain how a sign-in keeps the page the user asked for.");
	talk.usage(turn, 150_000, { fastMode: true, serviceTier: "priority" });
	talk.text(
		turn,
		"The login form carries `next`, and `safeNext` keeps it only when it is a path on this site.",
	);
	talk.end(turn);
	await addEvents(world, chat.id, talk.events);
	if (holdDetails) world.holdSidecar("getContextUsage");
	return {
		route: chatRoute(cast.arbor, chat),
		after: async ({ app, document }) => {
			await refreshGit(app, cast.arbor);
			await hover(document, "button", "Context usage");
		},
		ready: (document) => shows(document, holdDetails ? "Loading details…" : "Window used"),
	};
}

/** A chat with no reported window (or a Cursor chat), so the card shows the matching note. */
async function contextNoteChat(world: World, agent: "claude" | "cursor"): Promise<Scene> {
	const cast = await seedCast(world);
	await setSetting(world, "always_show_context_wheel", true);
	const chat = await addChat(world, cast.arbor, {
		title: agent === "cursor" ? "Cursor context" : "Context size not reported",
		config: { ...CLAUDE_CONFIG, agent },
	});
	return {
		route: chatRoute(cast.arbor, chat),
		after: async ({ app, document }) => {
			await refreshGit(app, cast.arbor);
			await hover(document, "button", "Context usage");
		},
		ready: (document) =>
			shows(
				document,
				agent === "cursor"
					? "Context usage is unavailable for Cursor."
					: "Context window size not yet available.",
			),
	};
}

export const COMPOSER_STATES: CatalogueState[] = [
	{
		id: "chat-context-unknown",
		group: "Composer",
		title: "The context card before any window size was reported",
		seed: (world) => contextNoteChat(world, "claude"),
	},
	{
		id: "chat-context-cursor",
		group: "Composer",
		title: "The context card for a Cursor chat, which has no usage to show",
		seed: (world) => contextNoteChat(world, "cursor"),
	},
	{
		id: "chat-context-usage",
		group: "Composer",
		title: "The context usage card open: window used, token breakdown, model and service tier",
		seed: (world) => contextUsageChat(world),
	},
	{
		id: "chat-context-loading",
		group: "Composer",
		title: "The context usage card while its details are still loading",
		seed: (world) => contextUsageChat(world, true),
	},
	{
		id: "composer-empty",
		group: "Composer",
		title: "New chat: the empty chat and an empty composer",
		seed: (world) => newChat(world, async () => {}, undefined),
	},
	{
		id: "composer-draft",
		group: "Composer",
		title: "Composer with text and two attached files",
		seed: (world) =>
			newChat(
				world,
				async ({ app }, chat) => {
					const { files } = world.memory.controls;
					files.set("/Users/sam/Desktop/redirect-notes.md", NOTES);
					files.set("/Users/sam/Desktop/server.log", LOG);
					const added = await app.container.actions.attachments.add(chat.id, [
						"/Users/sam/Desktop/redirect-notes.md",
						"/Users/sam/Desktop/server.log",
					]);
					if (!added.ok) throw new Error(`Attaching failed: ${added.error.message}`);
					app.container.actions.sessions.saveDraft(chat.id, {
						text: "The log shows the redirect still drops `next` after a POST. Check the form handler too, and keep the notes in mind.",
						attachmentPaths: added.value,
					});
				},
				(document) => shows(document, "server.log"),
			),
	},
	{
		id: "composer-slash-menu",
		group: "Composer",
		title: "Composer with the slash command menu open",
		seed: (world) =>
			newChat(
				world,
				({ document }) => typeInComposer(document, "/"),
				(document) => shows(document, "Manage hooks (opens terminal)"),
			),
	},
	{
		id: "composer-file-mention",
		group: "Composer",
		title: "Composer with the @ menu open: files, folders and the composer's own rows",
		seed: (world) =>
			newChat(
				world,
				({ document }) => typeInComposer(document, "@"),
				(document) => shows(document, "Attach current terminal output"),
			),
	},
	{
		id: "composer-file-mention-no-match",
		group: "Composer",
		title: "Composer with the @ menu searched for a file the workspace lacks",
		seed: (world) =>
			newChat(
				world,
				({ document }) => typeInComposer(document, "@quarterly-report"),
				(document) => shows(document, "No files found"),
			),
	},
	{
		id: "composer-auto-accept",
		group: "Composer",
		title: "A chat accepting edits by itself: its chip, pointed at",
		seed: (world) =>
			newChat(
				world,
				async ({ app, document }, chat) => {
					must(await app.container.actions.sessions.setAutoApproveEdits(chat.id, true));
					await hover(document, "button", "Auto-accept edits");
				},
				(document) => shows(document, "Disable auto-accept edits"),
			),
	},
	{
		id: "chat-find",
		group: "Composer",
		title: "A chat's find bar, opened with Cmd+F",
		seed: (world) =>
			newChat(
				world,
				// Find belongs to the chat's area, so the key is pressed with the composer focused.
				({ document }) => pressUntilTaken(document, "f", { meta: true }, '[aria-label="composer"]'),
				(document) =>
					document.querySelector('[placeholder="Find in messages and thinking"]') !== null,
			),
	},
	{
		id: "composer-model-picker",
		group: "Composer",
		title: "Composer with the model picker open",
		seed: (world) =>
			newChat(
				world,
				async ({ app, document }) => {
					// Four loadout rows, as on the owner's capture of Conductor's menu: the default model,
					// then three favourites.
					const favorites = app.container.services.favoriteModels;
					for (const [agent, model] of [
						["claude", "sonnet"],
						["codex", "gpt-5.5"],
						["claude", "haiku"],
					] as const) {
						const added = await favorites.add({ agent, model, effort: "high", fastMode: false });
						if (!added.ok) throw new Error(`Adding a favourite failed: ${added.error.message}`);
					}
					await click(document, "button", "Model picker");
				},
				(document) => shows(document, "Cycle effort"),
			),
	},
	{
		id: "composer-model-search-empty",
		group: "Composer",
		title: "The model picker searched for a model no agent has",
		seed: (world) =>
			newChat(
				world,
				async ({ document }) => {
					await click(document, "button", "Model picker");
					await typeInto(document, "input", "Search models", "gemini");
				},
				(document) => shows(document, "No models found"),
			),
	},
	{
		id: "composer-model-switch-mid-chat",
		group: "Composer",
		title: "Switching the model in a chat that has started: the toast about the next reply",
		seed: async (world): Promise<Scene> => {
			const cast = await seedCast(world);
			// The chat has started: the user sent its first message.
			must(
				await world.repositories.sessions.recordUserMessage(
					cast.chats.arbor.id,
					CATALOGUE_NOW - HOUR,
				),
			);
			return {
				route: chatRoute(cast.arbor, cast.chats.arbor),
				after: async ({ app, document }) => {
					await refreshGit(app, cast.arbor);
					const added = await app.container.services.favoriteModels.add({
						agent: "claude",
						model: "sonnet",
						effort: "high",
						fastMode: false,
					});
					if (!added.ok) throw new Error(`Adding a favourite failed: ${added.error.message}`);
					await click(document, "button", "Model picker");
					await click(document, "button", "Select Claude Code · sonnet");
				},
				ready: (document) =>
					shows(
						document,
						"FYI: When you switch models mid-chat, your next response will be slower",
					),
			};
		},
	},
	{
		id: "composer-empty-shelves",
		group: "Composer",
		title: "A new chat offering the workspace's earlier chat as context",
		seed: async (world): Promise<Scene> => {
			const cast = await seedCast(world);
			// arbor's first chat has the user's message, so the new chat can offer its transcript.
			must(
				await world.repositories.sessions.recordUserMessage(
					cast.chats.arbor.id,
					CATALOGUE_NOW - HOUR,
				),
			);
			const chat = await addChat(world, cast.arbor, { title: null });
			return {
				route: chatRoute(cast.arbor, chat),
				after: ({ app }) => refreshGit(app, cast.arbor),
				ready: (document) => shows(document, "Add chat transcripts:"),
			};
		},
	},
	{
		id: "composer-plus-menu",
		group: "Composer",
		title: "Composer with its + menu open",
		seed: (world) =>
			newChat(
				world,
				({ document }) => click(document, "button", PLUS_MENU),
				(document) => shows(document, "Add snippet"),
			),
	},
	{
		id: "composer-create-snippet",
		group: "Composer",
		title: "The Create snippet dialog, from the + menu",
		seed: (world) =>
			newChat(
				world,
				async ({ document }) => {
					await click(document, "button", PLUS_MENU);
					await click(document, "[role=menuitem]", "Add snippet");
				},
				(document) => shows(document, "Create snippet"),
			),
	},
	{
		id: "composer-snippet-picker",
		group: "Composer",
		title: "The snippet picker with no snippets saved yet",
		seed: (world) =>
			newChat(
				world,
				async ({ document }) => {
					await click(document, "button", PLUS_MENU);
					await click(document, "[role=menuitem]", "Insert snippet", { prefix: true });
				},
				(document) => shows(document, "No saved snippets yet."),
			),
	},
	{
		id: "composer-link-issue",
		group: "Composer",
		title: "The Link issue dialog: atlas's GitHub issues, and Linear not connected",
		seed: (world) =>
			newChat(
				world,
				async ({ document }) => {
					await click(document, "button", PLUS_MENU);
					await click(document, "[role=menuitem]", "Link issue", { prefix: true });
				},
				(document) => shows(document, "Recent issues"),
				{
					issues: [
						{
							number: 412,
							title: "Sign-in drops the page the user asked for",
							updatedAt: CATALOGUE_NOW - 2 * HOUR,
						},
						{
							number: 398,
							title: "Session cookie is not renewed on activity",
							updatedAt: CATALOGUE_NOW - 3 * DAY,
						},
					],
				},
			),
	},
	{
		id: "composer-link-issue-empty",
		group: "Composer",
		title: "The Link issue dialog when atlas has no open GitHub issues",
		seed: (world) =>
			newChat(
				world,
				async ({ document }) => {
					await click(document, "button", PLUS_MENU);
					await click(document, "[role=menuitem]", "Link issue", { prefix: true });
				},
				(document) => shows(document, "No open issues found"),
				{
					issues: [],
				},
			),
	},
	{
		id: "composer-model-effort-menu",
		group: "Composer",
		title: "The model picker's Effort submenu, with Ultracode",
		seed: (world) =>
			newChat(
				world,
				async ({ document }) => {
					await click(document, "button", "Model picker");
					await click(document, "button", "Effort");
				},
				(document) => shows(document, "Ultracode"),
			),
	},
	{
		id: "composer-model-load-failed",
		group: "Composer",
		title: "The model picker's Model submenu when the model list fails",
		seed: async (world): Promise<Scene> => {
			const cast = await seedCast(world);
			world.failSidecar("listModels");
			const chat = await addChat(world, cast.arbor, { title: null });
			return {
				route: chatRoute(cast.arbor, chat),
				after: async ({ app, document }) => {
					await refreshGit(app, cast.arbor);
					await click(document, "button", "Model picker");
					await click(document, "button", "Model");
				},
				ready: (document) => shows(document, "Could not load models."),
			};
		},
	},
	{
		id: "composer-model-effort-unsupported",
		group: "Composer",
		title: "The Effort submenu for a level the model does not support",
		seed: async (world): Promise<Scene> => {
			const cast = await seedCast(world);
			const chat = await addChat(world, cast.arbor, {
				title: null,
				// Sonnet's efforts stop at high in the catalogue's model list.
				config: { ...CLAUDE_CONFIG, model: "sonnet", effort: "max" },
			});
			return {
				route: chatRoute(cast.arbor, chat),
				after: async ({ app, document }) => {
					await refreshGit(app, cast.arbor);
					await click(document, "button", "Model picker");
					await click(document, "button", "Effort");
				},
				ready: (document) => shows(document, "Not supported for this model"),
			};
		},
	},
	{
		id: "composer-fast-mode",
		group: "Composer",
		title: "A chat with fast mode on",
		seed: async (world): Promise<Scene> => {
			const cast = await seedCast(world);
			const chat = await addChat(world, cast.arbor, {
				title: null,
				config: { ...CLAUDE_CONFIG, fastMode: true },
			});
			return {
				route: chatRoute(cast.arbor, chat),
				after: async ({ app }) => refreshGit(app, cast.arbor),
				ready: (document) => has(document, "[role=img]", "Fast mode on"),
			};
		},
	},
	{
		id: "composer-fast-mode-unavailable",
		group: "Composer",
		title: "A chat with fast mode on that the account's credits cannot pay for",
		seed: async (world): Promise<Scene> => {
			const cast = await seedCast(world);
			const chat = await addChat(world, cast.arbor, {
				title: null,
				config: { ...CLAUDE_CONFIG, fastMode: true },
			});
			return {
				route: chatRoute(cast.arbor, chat),
				after: async ({ app }) => {
					await refreshGit(app, cast.arbor);
					// The agent reported that fast mode needs extra usage the account has run out of.
					setLiveState(world, chat.id, { status: "idle", fastModeAvailable: false });
				},
				ready: (document) =>
					shows(document, "Fast mode is disabled because extra usage is out of credits."),
			};
		},
	},
	{
		id: "composer-slash-menu-codex",
		group: "Composer",
		title: "A Codex chat with the slash command menu open",
		seed: async (world): Promise<Scene> => {
			const cast = await seedCast(world);
			const config = { ...CLAUDE_CONFIG, agent: "codex" as const, model: "gpt-5.5" };
			const chat = await addChat(world, cast.arbor, { title: null, config });
			return {
				route: chatRoute(cast.arbor, chat),
				after: async ({ app, document }) => {
					await refreshGit(app, cast.arbor);
					await typeInComposer(document, "/");
				},
				ready: (document) =>
					shows(document, "Choose Codex's personality for this session and future ones"),
			};
		},
	},
	{
		id: "composer-slash-skills",
		group: "Composer",
		title: "The slash command menu with a Skills group",
		seed: async (world): Promise<Scene> => {
			const cast = await seedCast(world);
			world.answerSidecar({
				listSlashCommands: () => ({
					commands: [
						{ name: "skill-creator", description: "Create a skill", source: "user", kind: "skill" },
						{ name: "deploy", description: "Deploy the app", source: "project", kind: "command" },
					],
					fromCache: false,
				}),
			});
			const chat = await addChat(world, cast.arbor, { title: null });
			return {
				route: chatRoute(cast.arbor, chat),
				after: async ({ app, document }) => {
					await refreshGit(app, cast.arbor);
					await typeInComposer(document, "/");
				},
				ready: (document) => shows(document, "Create a skill"),
			};
		},
	},
	{
		id: "composer-slash-goal-unavailable",
		group: "Composer",
		title: "Typing /goal in a Claude chat says Codex goals are not available",
		seed: async (world): Promise<Scene> => {
			const cast = await seedCast(world);
			const chat = await addChat(world, cast.arbor, { title: null });
			return {
				route: chatRoute(cast.arbor, chat),
				after: async ({ app, document }) => {
					await refreshGit(app, cast.arbor);
					await submitSlash(document, "/goal");
				},
				ready: (document) => shows(document, "Codex goals are not available in this chat."),
			};
		},
	},
	{
		id: "composer-slash-plan-unavailable",
		group: "Composer",
		title: "Typing /plan for an agent without plan mode says so",
		seed: async (world): Promise<Scene> => {
			const cast = await seedCast(world);
			const config = { ...CLAUDE_CONFIG, agent: "cursor" as const };
			const chat = await addChat(world, cast.arbor, { title: null, config });
			return {
				route: chatRoute(cast.arbor, chat),
				after: async ({ app, document }) => {
					await refreshGit(app, cast.arbor);
					await submitSlash(document, "/plan");
				},
				ready: (document) => shows(document, "Plan mode is not available in this chat."),
			};
		},
	},
	{
		id: "composer-slash-command-unavailable",
		group: "Composer",
		title: "A typed slash command this workspace does not offer says so",
		seed: async (world): Promise<Scene> => {
			const cast = await seedCast(world);
			const chat = await addChat(world, cast.arbor, { title: null });
			return {
				route: chatRoute(cast.arbor, chat),
				after: async ({ app, document }) => {
					await refreshGit(app, cast.arbor);
					await submitSlash(document, "/deploy");
				},
				ready: (document) => shows(document, "This command isn't available in this workspace."),
			};
		},
	},
];
