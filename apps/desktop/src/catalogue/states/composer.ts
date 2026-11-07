/**
 * @feature catalogue States of the composer
 * Owns: a new chat with an empty composer (the empty chat), the composer with a draft and two attached
 * files, the composer with the model picker open, and the slash command menu after typing "/".
 * Behaviour: ui-map.md 3.5 (composer), COMP-01 (drafts and attachments).
 * Test first: not applicable; the screenshot run opens every state.
 */
import type { Session, Workspace } from "../../core/model.ts";
import { chatRoute, refreshGit, seedCast } from "../cast.ts";
import { click, find, shows } from "../dom.ts";
import { addChat } from "../seeds.ts";
import type { AfterContext, CatalogueState, Scene } from "../state.ts";
import type { World } from "../world.ts";

/** The cast, with a new, empty chat open in arbor. */
async function newChat(
	world: World,
	after: (context: AfterContext, chat: Session) => Promise<void>,
	ready: Scene["ready"],
): Promise<Scene> {
	const cast = await seedCast(world);
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

/** Types into the composer as a keyboard does: the editor reads the browser's own text input. */
async function typeInComposer(document: Document, text: string): Promise<void> {
	const editor = await find(document, '[contenteditable="true"]', "composer");
	editor.focus();
	document.execCommand("insertText", false, text);
}

export const COMPOSER_STATES: CatalogueState[] = [
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
];
