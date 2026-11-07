/**
 * @feature catalogue States of a chat's tool cards
 * Owns: two finished turns with their folded work opened: a review that uses the app's own tools
 * (Workspace diff, Review comments, Code review comments, Get terminal output), a sub-agent, a
 * slash command, Glob, List files and a plain Bash call with its raw input shown; and a design fix
 * that activates a skill, reads a mockup image, asks the user, retries an edit Claude Code refused
 * and opens the edit that worked.
 * Behaviour: ui-map.md 3.3 (chat, tool cards); the cards are features/chat/tools/cards/.
 * Test first: not applicable; the screenshot run opens every state.
 */
import { animateCast, chatRoute, refreshGit, seedCast } from "../cast.ts";
import { conversation } from "../conversation.ts";
import { click, find, shows } from "../dom.ts";
import { addChat, addEvents } from "../seeds.ts";
import type { CatalogueState, Scene } from "../state.ts";
import { CATALOGUE_NOW, MINUTE } from "../time.ts";
import type { World } from "../world.ts";

const ARBOR = "/Users/sam/conducted/workspaces/atlas/arbor";
const CANYON = "/Users/sam/conducted/workspaces/atlas/canyon";

/** Opens the folded row of the turn's work. */
const expandWork = (document: Document): Promise<void> =>
	click(document, "button", "Expand", { prefix: true });

/** Opens the closed tool row whose text starts with `title`; the `nth` one when several do. */
async function openRow(document: Document, title: string, nth = 0): Promise<void> {
	await find(document, "button[aria-expanded=false]", title, { prefix: true });
	const rows = [...document.querySelectorAll<HTMLElement>("button[aria-expanded=false]")].filter(
		(row) => (row.textContent ?? "").trim().startsWith(title),
	);
	const row = rows[nth];
	if (row === undefined) throw new Error(`No closed "${title}" row number ${nth + 1}.`);
	row.click();
}

/** arbor's review of its own change, before the pull request. */
async function reviewChat(world: World): Promise<Scene> {
	const cast = await seedCast(world);
	const chat = await addChat(world, cast.arbor, { title: "Review the sign-in change" });
	const talk = conversation("arbor-review", CATALOGUE_NOW - 8 * MINUTE);
	const turn = talk.user(
		"Review my sign-in change before I open the pull request. Leave a comment on anything risky.",
	);
	talk.tool(turn, {
		tool: "app_tool",
		rawName: "mcp__conducted__GetWorkspaceDiff",
		input: { stat: true },
		output: [
			" src/auth/safe-next.test.ts | 31 +++++++++++++",
			" src/auth/safe-next.ts      | 14 ++++++",
			" src/auth/sign-in.ts        |  4 +-",
			" 3 files changed, 47 insertions(+), 1 deletion(-)",
		].join("\n"),
	});
	talk.tool(turn, {
		tool: "app_tool",
		rawName: "mcp__conducted__GetDiffComments",
		input: {},
		output: "No comments on this diff yet.",
	});
	talk.tool(turn, {
		tool: "glob",
		rawName: "Glob",
		input: { pattern: "src/auth/**/*.ts" },
		output: [
			"src/auth/safe-next.test.ts",
			"src/auth/safe-next.ts",
			"src/auth/session.ts",
			"src/auth/sign-in.test.ts",
			"src/auth/sign-in.ts",
		].join("\n"),
	});
	talk.tool(turn, {
		tool: "list",
		rawName: "LS",
		input: { path: `${ARBOR}/src/http` },
		output: ["middleware.ts", "redirect.ts", "routes/"].join("\n"),
	});
	const audit = talk.tool(turn, {
		tool: "sub_agent",
		rawName: "Task",
		input: {
			description: "Check every redirect for an open redirect",
			prompt: "Find each call to redirect() and say whether its target can come from the request.",
		},
		output:
			"Two calls to redirect(). sign-in.ts now passes its target through safeNext; sign-out.ts always redirects to /. Neither can leave the site.",
	});
	talk.tool(turn, {
		tool: "grep",
		rawName: "Grep",
		input: { pattern: "redirect\\(", path: "src" },
		output: "src/auth/sign-in.ts\nsrc/auth/sign-out.ts",
		parent: audit,
	});
	talk.tool(turn, {
		tool: "read",
		rawName: "Read",
		input: { file_path: `${ARBOR}/src/auth/sign-out.ts` },
		output: "1\texport function signOut() {\n2\t  return redirect('/', { session: null });\n3\t}",
		parent: audit,
	});
	talk.tool(turn, {
		tool: "bash",
		rawName: "Bash",
		input: { command: "pnpm lint src/auth" },
		output: "Checked 6 files in 41ms. No fixes applied.",
	});
	talk.tool(turn, {
		tool: "app_tool",
		rawName: "mcp__conducted__GetTerminalOutput",
		input: { source: "run_script" },
		output: [
			"  VITE v6.0.7  ready in 412 ms",
			"  ➜  Local:   http://localhost:55000/",
			"09:14:02 GET /login?next=%2Fbilling 200",
			"09:14:05 POST /login 303 location=/billing",
		].join("\n"),
	});
	talk.tool(turn, {
		tool: "slash_command",
		rawName: "SlashCommand",
		input: { command: "security-review" },
		output: "No high-severity findings in the changed files.",
	});
	talk.tool(turn, {
		tool: "app_tool",
		rawName: "mcp__conducted__DiffComment",
		input: {
			comments: [
				{
					file: "src/auth/safe-next.ts",
					lineNumber: 6,
					body: "A backslash path such as /\\evil.example is read as protocol-relative by some browsers. Refuse it too.",
				},
			],
		},
		output: "Added 1 comment.",
	});
	talk.usage(turn, 61_000);
	talk.text(
		turn,
		"One comment: `safeNext` should also refuse a path that starts with a backslash. The rest is safe to open as a pull request.",
	);
	talk.end(turn);
	await addEvents(world, chat.id, talk.events);
	return {
		route: chatRoute(cast.arbor, chat),
		after: async ({ app, document }) => {
			await animateCast(world, cast, app);
			await refreshGit(app, cast.arbor);
			await expandWork(document);
			await openRow(document, "Bash");
			await click(document, "button", "Raw");
		},
		ready: (document) => shows(document, "Formatted"),
	};
}

/** canyon's second chat: the settings page brought in line with a mockup. */
async function designChat(world: World): Promise<Scene> {
	const cast = await seedCast(world);
	const chat = await addChat(world, cast.canyon, { title: "Match the settings mockup" });
	const talk = conversation("canyon-design", CATALOGUE_NOW - 25 * MINUTE);
	const page = `${CANYON}/src/settings/settings-page.tsx`;
	const turn = talk.user(
		"Make the settings page match the dark mockup in mockups/settings-dark.png.",
		{
			attachmentPaths: [`${CANYON}/mockups/settings-dark.png`],
		},
	);
	talk.tool(turn, {
		tool: "skill",
		rawName: "Skill",
		input: { skill: "frontend-design" },
		output: "Loaded the frontend-design skill.",
	});
	talk.tool(turn, {
		tool: "read",
		rawName: "Read",
		input: { file_path: `${CANYON}/mockups/settings-dark.png` },
		output: "[image]",
	});
	talk.tool(turn, {
		tool: "ask_user_question",
		rawName: "AskUserQuestion",
		input: {
			questions: [
				{
					header: "Toggle",
					question:
						"The mockup shows a switch for the theme. Keep the system option as a third choice?",
					multiSelect: false,
					options: [
						{ label: "Keep System", description: "Light, Dark and System." },
						{ label: "Two choices", description: "Light and Dark only." },
					],
				},
			],
		},
		output: "1. Keep System",
	});
	const edit = {
		file_path: page,
		old_string: '<select name="theme">',
		new_string: "<ThemeSwitch value={theme} onChange={setTheme} withSystem />",
	};
	talk.tool(turn, {
		tool: "edit",
		rawName: "Edit",
		input: edit,
		output: "File has not been read yet. Read it first before writing to it.",
		isError: true,
	});
	talk.tool(turn, {
		tool: "read",
		rawName: "Read",
		input: { file_path: page },
		output: [
			"1\texport function SettingsPage({ theme, setTheme }: Props) {",
			"2\t  return (",
			'3\t    <select name="theme">',
		].join("\n"),
	});
	talk.tool(turn, { tool: "edit", rawName: "Edit", input: edit, output: "The file was updated." });
	talk.usage(turn, 52_000);
	talk.text(
		turn,
		"The theme select is now the switch from the mockup, with System kept as a third choice.",
	);
	talk.end(turn);
	await addEvents(world, chat.id, talk.events);
	return {
		route: chatRoute(cast.canyon, chat),
		after: async ({ app, document }) => {
			await animateCast(world, cast, app);
			await refreshGit(app, cast.canyon);
			await expandWork(document);
			// The failed edit is open already; open the one that worked, the next Edit row.
			await openRow(document, "Edit");
		},
		ready: (document) => shows(document, "Open in editor"),
	};
}

export const TOOL_STATES: CatalogueState[] = [
	{
		id: "chat-tool-cards-review",
		group: "Workspace chat",
		title:
			"A review turn opened: app tools, a sub-agent, a slash command, Glob, List files and raw Bash",
		seed: reviewChat,
	},
	{
		id: "chat-tool-cards-design",
		group: "Workspace chat",
		title: "A design turn opened: a skill, an image read, a question, a refused edit and its retry",
		seed: designChat,
	},
];
