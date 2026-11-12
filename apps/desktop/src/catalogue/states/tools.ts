/**
 * @feature catalogue States of a chat's tool cards
 * Owns: two finished turns with their folded work opened: a review that uses the app's own tools
 * (Workspace diff, Review comments, Code review comments, Get terminal output), a sub-agent, a
 * slash command, Glob, List files and a plain Bash call with its raw input shown; and a design fix
 * that activates a skill, reads a mockup image, asks the user, retries an edit Claude Code refused
 * and opens the edit that worked; a turn that keeps a task list, runs JavaScript in a Node
 * REPL and generates an image; a turn whose todo list is empty, started and done; a turn that
 * enters plan mode and proposes a plan, with the plan's menu open; a reply with a
 * Mermaid diagram; and a background helper whose work
 * arrives in the next turn, shown inside the card of the turn that started it (D129).
 * Behaviour: ui-map.md 3.3 (chat, tool cards); the cards are features/chat/tools/cards/.
 * Test first: not applicable; the screenshot run opens every state.
 */
import { animateCast, chatRoute, refreshGit, seedCast } from "../cast.ts";
import { conversation } from "../conversation.ts";
import { click, find, rightClick, shows } from "../dom.ts";
import { deliverEvents, setLiveState } from "../live.ts";
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

/** Opens the closed rows whose title starts with `title`; a row already open is left alone. */
async function openClosedRow(document: Document, title: string): Promise<void> {
	const rows = [...document.querySelectorAll<HTMLElement>("button[aria-expanded=false]")].filter(
		(row) => (row.textContent ?? "").trim().startsWith(title),
	);
	for (const row of rows) {
		row.click();
		await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
	}
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

/** A turn in grove that tracks its tasks, checks a value in a Node REPL and draws an image. */
async function taskToolsChat(world: World): Promise<Scene> {
	const cast = await seedCast(world);
	const chat = await addChat(world, cast.grove, { title: "Release notes for Node 24" });
	const talk = conversation("grove-tools", CATALOGUE_NOW - 12 * MINUTE);
	const turn = talk.user(
		"Write the release notes for the Node 24 upgrade, check the new minimum version, and make a small banner image for the post.",
	);
	talk.tool(turn, {
		tool: "task_create",
		rawName: "TaskCreate",
		input: {
			subject: "Write the Node 24 release notes",
			description: "List the runtime change, the Dockerfile change and the url.parse fix.",
		},
		output: "Task #1 created successfully: Write the Node 24 release notes",
	});
	talk.tool(turn, {
		tool: "task_get",
		rawName: "TaskGet",
		input: { taskId: "1" },
		output: [
			"Task #1: Write the Node 24 release notes",
			"Status: in_progress",
			"Description: List the runtime change, the Dockerfile change and the url.parse fix.",
		].join("\n"),
	});
	talk.tool(turn, {
		tool: "task_list",
		rawName: "TaskList",
		input: {},
		output: "No tasks",
	});
	talk.tool(turn, {
		tool: "task_list",
		rawName: "TaskList",
		input: {},
		output: "Task #1: Write the Node 24 release notes\nTask #2: Check the minimum Node version",
	});
	talk.tool(turn, {
		tool: "image_view",
		rawName: "Read",
		input: { file_path: `${CANYON}/docs/release/node-24-banner.png` },
		output: "Loaded the image.",
	});
	talk.tool(turn, {
		tool: "send_message",
		rawName: "SendMessage",
		input: { chat: "Release checklist", message: "The banner is ready for the post." },
		output: "Message sent.",
	});
	talk.tool(turn, {
		tool: "sub_agent",
		rawName: "Task",
		input: {
			description: "Check the release notes for missing steps",
			prompt: "Read docs/release/node-24.md and list any step without a test.",
		},
		output: "Every step has a test except the Dockerfile change.",
	});
	talk.tool(turn, {
		tool: "node_repl",
		rawName: "node_repl",
		input: { code: "process.versions.node.split('.')[0]" },
		output: "'24'",
	});
	talk.tool(turn, {
		tool: "image_generation",
		rawName: "image_generation",
		input: { prompt: "A flat banner with a green hexagon and the words Node 24" },
		output: "Saved the image to docs/release/node-24-banner.png",
	});
	talk.tool(turn, {
		tool: "image_generation",
		rawName: "image_generation",
		input: { prompt: "A small square icon of the Node 24 hexagon" },
		output: null,
	});
	talk.usage(turn, 31_000);
	talk.text(
		turn,
		"The release notes are in `docs/release/node-24.md`, the minimum version is 24, and the banner is beside them.",
	);
	talk.end(turn);
	await addEvents(world, chat.id, talk.events);
	return {
		route: chatRoute(cast.grove, chat),
		after: async ({ app, document }) => {
			await animateCast(world, cast, app);
			await refreshGit(app, cast.grove);
			// The turn's work shows open, as the only work of the chat; open every card it names.
			await openRow(document, "Task created");
			await openClosedRow(document, "Task details");
			await openClosedRow(document, "Tasks");
			await openClosedRow(document, "Preview image");
			await openClosedRow(document, "Send message");
			await openClosedRow(document, "Subagent");
			await openRow(document, "Node REPL");
			await openClosedRow(document, "Loading image");
		},
		ready: (document) => shows(document, "process.versions.node"),
	};
}

/** A turn that writes the agent's todo list three times: empty, one item started, all done. */
async function todoToolsChat(world: World): Promise<Scene> {
	const cast = await seedCast(world);
	const chat = await addChat(world, cast.grove, { title: "Plan the Node 24 upgrade" });
	const talk = conversation("grove-todos", CATALOGUE_NOW - 9 * MINUTE);
	const turn = talk.user("Plan the Node 24 upgrade as a todo list and work through it.");
	const steps = [
		[],
		[
			{ label: "Bump .node-version to 24", status: "in_progress" },
			{ label: "Update the Dockerfile's base image", status: "pending" },
		],
		[
			{ label: "Bump .node-version to 24", status: "done" },
			{ label: "Update the Dockerfile's base image", status: "done" },
		],
	];
	for (const items of steps) {
		talk.tool(turn, {
			tool: "todo",
			rawName: "TodoWrite",
			input: { items },
			output: "Todos updated.",
		});
	}
	talk.usage(turn, 18_000);
	talk.text(
		turn,
		"Both steps are done: `.node-version` reads 24 and the Dockerfile uses node:24-slim.",
	);
	talk.end(turn);
	await addEvents(world, chat.id, talk.events);
	return {
		route: chatRoute(cast.grove, chat),
		after: async ({ app, document }) => {
			await animateCast(world, cast, app);
			await refreshGit(app, cast.grove);
			// The turn's work is folded into one row; open it to show each todo card's title.
			await click(document, "button", "Expand", { prefix: true });
		},
		ready: (document) =>
			shows(document, "No todos") &&
			shows(document, "Todo started") &&
			shows(document, "Todo completed"),
	};
}

/** A turn that enters plan mode and proposes a plan the user approved; the plan's menu open. */
async function planModeChat(world: World): Promise<Scene> {
	const cast = await seedCast(world);
	const chat = await addChat(world, cast.grove, { title: "Plan the cache change" });
	const talk = conversation("grove-plan-mode", CATALOGUE_NOW - 7 * MINUTE);
	const turn = talk.user("Plan how to invalidate the price cache before changing anything.");
	talk.tool(turn, {
		tool: "enter_plan_mode",
		rawName: "EnterPlanMode",
		input: {},
		output: "Entered plan mode.",
	});
	talk.tool(turn, {
		tool: "exit_plan_mode",
		rawName: "ExitPlanMode",
		input: {
			plan: "1. Clear PriceCache on every price write.\n2. Add a test that writes, then reads.",
		},
		output: "The user approved the plan.",
	});
	talk.usage(turn, 9_000);
	talk.text(turn, "The plan is approved; I will start with the cache.");
	talk.end(turn);
	await addEvents(world, chat.id, talk.events);
	return {
		route: chatRoute(cast.grove, chat),
		after: async ({ app, document }) => {
			await animateCast(world, cast, app);
			await refreshGit(app, cast.grove);
			await click(document, "button", "Expand", { prefix: true });
			await rightClick(document, "button", "Propose plan", { prefix: true });
		},
		ready: (document) => shows(document, "Enter plan mode") && shows(document, "Copy plan"),
	};
}

/** A reply in arbor that explains the sign-in redirect with a Mermaid sequence diagram. */
async function mermaidChat(world: World): Promise<Scene> {
	const cast = await seedCast(world);
	const chat = await addChat(world, cast.arbor, { title: "How the redirect works" });
	const talk = conversation("arbor-mermaid", CATALOGUE_NOW - 6 * MINUTE);
	const turn = talk.user("Draw how a sign-in keeps the page the user asked for.");
	talk.text(
		turn,
		[
			"Here is the path a request takes now:",
			"",
			"```mermaid",
			"sequenceDiagram",
			"  Browser->>Server: GET /billing",
			"  Server-->>Browser: 303 /login?next=/billing",
			"  Browser->>Server: POST /login",
			"  Server-->>Browser: 303 /billing",
			"```",
			"",
			"`safeNext` refuses any `next` that leaves the site, so the last step falls back to `/` for those.",
		].join("\n"),
	);
	talk.usage(turn, 18_000);
	talk.end(turn);
	await addEvents(world, chat.id, talk.events);
	return {
		route: chatRoute(cast.arbor, chat),
		after: async ({ app }) => {
			await animateCast(world, cast, app);
			await refreshGit(app, cast.arbor);
		},
		ready: (document) => shows(document, "Mermaid diagram"),
	};
}

/**
 * canyon's helper chat: the first turn starts a background helper and ends; the helper's work
 * arrives while the second turn runs, naming the first turn's Task call as its parent.
 */
async function backgroundHelperChat(world: World): Promise<Scene> {
	const cast = await seedCast(world);
	const chat = await addChat(world, cast.canyon, { title: "Audit the settings copy" });
	const talk = conversation("canyon-helper", CATALOGUE_NOW - 14 * MINUTE);
	const first = talk.user(
		"Start a helper that checks every settings label against the copy deck, then keep going.",
	);
	const helper = talk.tool(first, {
		tool: "sub_agent",
		rawName: "Task",
		input: {
			description: "Check the settings labels against the copy deck",
			prompt:
				"Compare each label in src/settings with docs/copy-deck.md and list the ones that differ.",
			run_in_background: true,
		},
		output: "Async agent launched. It reports back when it finishes.",
	});
	talk.text(first, "The helper is checking the labels in the background.");
	talk.end(first);
	const second = talk.user("While it runs, rename the Danger zone heading to Delete workspace.");
	talk.agent(second, [{ kind: "text", text: "Reading the copy deck first." }], helper);
	talk.tool(second, {
		tool: "grep",
		rawName: "Grep",
		input: { pattern: "label=", path: "src/settings" },
		output: "src/settings/general.tsx:14\nsrc/settings/danger-zone.tsx:9",
		parent: helper,
	});
	talk.tool(second, {
		tool: "edit",
		rawName: "Edit",
		input: {
			file_path: `${CANYON}/src/settings/danger-zone.tsx`,
			old_string: "Danger zone",
			new_string: "Delete workspace",
		},
		output: "The file was edited.",
	});
	talk.agent(
		second,
		[{ kind: "text", text: "Two labels differ from the deck: Danger zone and Sync now." }],
		helper,
	);
	talk.text(second, "The heading now reads Delete workspace.");
	talk.end(second);
	await addEvents(world, chat.id, talk.events);
	return {
		route: chatRoute(cast.canyon, chat),
		after: async ({ app, document }) => {
			await animateCast(world, cast, app);
			await refreshGit(app, cast.canyon);
			await openRow(document, "Subagent");
		},
		ready: (document) => shows(document, "Two labels differ from the deck"),
	};
}

/** A running turn whose task and image are still being worked on, so both cards say they load. */
async function loadingToolsChat(world: World): Promise<Scene> {
	const cast = await seedCast(world);
	const chat = await addChat(world, cast.grove, { title: "Start the release work" });
	const talk = conversation("grove-loading", CATALOGUE_NOW - 2 * MINUTE, 10_000);
	const turn = talk.user("Start the release task and make its banner image.");
	talk.tool(turn, {
		tool: "task_get",
		rawName: "TaskGet",
		input: { taskId: "1" },
		output: null,
	});
	talk.tool(turn, {
		tool: "image_generation",
		rawName: "image_generation",
		input: { prompt: "A flat banner with a green hexagon and the words Node 24" },
		output: null,
	});
	return {
		route: chatRoute(cast.grove, chat),
		after: async ({ app }) => {
			await refreshGit(app, cast.grove);
			setLiveState(world, chat.id, {});
			deliverEvents(world, chat.id, talk.events, 10);
		},
		ready: (document) => shows(document, "Loading task..."),
	};
}

export const TOOL_STATES: CatalogueState[] = [
	{
		id: "chat-tools-loading",
		group: "Workspace chat",
		title: "A running turn: its task and its image are still being made",
		seed: loadingToolsChat,
	},
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
	{
		id: "chat-tool-cards-tasks",
		group: "Workspace chat",
		title: "A turn opened: a task created and read, a Node REPL and a generated image",
		seed: taskToolsChat,
	},
	{
		id: "chat-tool-cards-todos",
		group: "Workspace chat",
		title: "A turn's todo cards: an empty list, one item started, all done",
		seed: todoToolsChat,
	},
	{
		id: "chat-tool-cards-plan-mode",
		group: "Workspace chat",
		title: "A turn that entered plan mode and proposed a plan, the plan's right-click menu open",
		seed: planModeChat,
	},
	{
		id: "chat-mermaid",
		group: "Workspace chat",
		title: "A reply with a Mermaid sequence diagram",
		seed: mermaidChat,
	},
	{
		id: "chat-subagent-late-work",
		group: "Workspace chat",
		title:
			"A background helper's work from the next turn, opened inside the card of the turn that started it",
		seed: backgroundHelperChat,
	},
];
