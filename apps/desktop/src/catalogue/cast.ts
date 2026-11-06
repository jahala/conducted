/**
 * @feature catalogue The shared cast: two projects and their workspaces
 * Owns: the one seed most states share, so the sidebar looks the same behind every screen. Project
 * "atlas" has arbor (a finished chat, idle), beacon (working, with a follow-up queued), canyon (waiting for
 * a tool approval) and delta (archived). Project "relay" has ember (waiting for an answer), fjord (waiting
 * for a plan review) and grove (idle, with an open pull request and unread messages).
 * Behaviour: ui-map.md 3.8 (workspace status: working, needs permission, needs answer, needs plan review,
 * idle, archived).
 * Must handle: a chat that is working gets its running turn after the app starts (see live.ts); the
 * waiting chats get the interaction request and the live state that shows it.
 * Test first: not applicable; the screenshot run opens every state that uses it.
 */
import type { Interaction } from "@conducted/protocol";
import type { ToolUseId } from "@conducted/shared";
import type { Repo, Session, Workspace } from "../core/model.ts";
import type { StartedApp } from "../main.tsx";
import { type Conversation, conversation } from "./conversation.ts";
import { type ScriptedFile, type ScriptedRepo, scriptRepo } from "./git-repo.ts";
import { type ScriptedPr, scriptGitHub } from "./github.ts";
import { deliverEvents, openInteraction, setLiveState } from "./live.ts";
import { addChat, addEvents, addRepo, addWorkspace } from "./seeds.ts";
import { CATALOGUE_NOW, DAY, HOUR, MINUTE } from "./time.ts";
import type { World } from "./world.ts";

export interface Cast {
	atlas: Repo;
	relay: Repo;
	arbor: Workspace;
	beacon: Workspace;
	canyon: Workspace;
	delta: Workspace;
	ember: Workspace;
	fjord: Workspace;
	grove: Workspace;
	chats: {
		arbor: Session;
		beacon: Session;
		canyon: Session;
		ember: Session;
		fjord: Session;
		grove: Session;
	};
}

/** The route of a workspace, optionally with a chat tab open. */
export function workspaceRoute(workspace: Workspace, search: Record<string, string> = {}): string {
	const query = new URLSearchParams(search).toString();
	return `/repository/${workspace.repoId}/workspace/${workspace.id}${query === "" ? "" : `?${query}`}`;
}

/** The chat tab of a workspace's chat. */
export function chatRoute(workspace: Workspace, chat: Session): string {
	return workspaceRoute(workspace, { tab: "session", sessionId: chat.id });
}

/** arbor's finished chat: a login redirect fix with thinking, Read, Bash and Edit cards and a file summary. */
function finishedLoginFix(start: number): Conversation {
	const chat = conversation("arbor", start);
	const turn = chat.user(
		"After signing in, users land on the home page instead of the page they asked for. Fix the redirect and add a test.",
	);
	chat.thinking(
		turn,
		"The sign-in handler probably drops the `next` parameter. I'll read the handler first, then check how the redirect URL is built.",
	);
	chat.tool(turn, {
		tool: "read",
		rawName: "Read",
		input: { file_path: "/Users/sam/conducted/workspaces/atlas/arbor/src/auth/sign-in.ts" },
		output: [
			"1\timport { redirect } from '../http/redirect';",
			"2\timport { createSession } from './session';",
			"3\t",
			"4\texport async function signIn(request: Request) {",
			"5\t  const session = await createSession(request);",
			"6\t  return redirect('/', { session });",
			"7\t}",
		].join("\n"),
	});
	chat.text(
		turn,
		"Found it. `signIn` always redirects to `/` and never reads the `next` parameter. I'll read it from the URL, keep it on this site only, and fall back to `/`.",
	);
	chat.tool(turn, {
		tool: "edit",
		rawName: "Edit",
		input: {
			file_path: "/Users/sam/conducted/workspaces/atlas/arbor/src/auth/sign-in.ts",
			old_string: "  return redirect('/', { session });",
			new_string: [
				"  const next = new URL(request.url).searchParams.get('next');",
				"  return redirect(safeNext(next), { session });",
			].join("\n"),
		},
		output: "The file src/auth/sign-in.ts has been updated.",
	});
	chat.tool(turn, {
		tool: "bash",
		rawName: "Bash",
		input: { command: "pnpm test src/auth", description: "Run the auth tests" },
		output: [
			" ✓ src/auth/safe-next.test.ts (4 tests) 6ms",
			" ✓ src/auth/sign-in.test.ts (3 tests) 21ms",
			"",
			" Test Files  2 passed (2)",
			"      Tests  7 passed (7)",
		].join("\n"),
	});
	chat.usage(turn, 48_200);
	chat.text(
		turn,
		[
			"The redirect now keeps the page the user asked for.",
			"",
			"- `signIn` reads `next` from the sign-in URL and passes it through `safeNext`.",
			"- `safeNext` accepts only paths on this site, so `next=https://evil.example` falls back to `/`.",
			"- Four new tests cover a normal path, an empty value, an outside URL and a protocol-relative URL.",
		].join("\n"),
	);
	chat.end(turn, [
		{
			path: "src/auth/sign-in.ts",
			status: "modified",
			linesAdded: 3,
			linesRemoved: 1,
			binary: false,
		},
		{
			path: "src/auth/safe-next.ts",
			status: "added",
			linesAdded: 14,
			linesRemoved: 0,
			binary: false,
		},
		{
			path: "src/auth/safe-next.test.ts",
			status: "added",
			linesAdded: 31,
			linesRemoved: 0,
			binary: false,
		},
	]);
	return chat;
}

/** A finished first turn for a chat, so it has history above whatever it waits on now. */
function oneTurn(prefix: string, start: number, ask: string, answer: string): Conversation {
	const chat = conversation(prefix, start);
	const turn = chat.user(ask);
	chat.text(turn, answer);
	chat.usage(turn, 22_000);
	chat.end(turn);
	return chat;
}

/**
 * Writes the cast and scripts its git and GitHub answers. Call `animateCast` from the scene's after-step
 * to make chats work and wait.
 */
export async function seedCast(world: World, git: GitWorld = {}): Promise<Cast> {
	const atlas = await addRepo(world, { name: "atlas" });
	const relay = await addRepo(world, { name: "relay" });

	const arbor = await addWorkspace(world, atlas, {
		name: "arbor",
		branch: "sam/fix-login-redirect",
		lastActivityAt: CATALOGUE_NOW - 12 * MINUTE,
	});
	const beacon = await addWorkspace(world, atlas, {
		name: "beacon",
		branch: "sam/rate-limit-api",
		lastActivityAt: CATALOGUE_NOW - 2 * MINUTE,
	});
	const canyon = await addWorkspace(world, atlas, {
		name: "canyon",
		branch: "sam/dark-mode-settings",
		lastActivityAt: CATALOGUE_NOW - 6 * MINUTE,
	});
	const delta = await addWorkspace(world, atlas, {
		name: "delta",
		branch: "sam/old-search-experiment",
		state: "archived",
		lastActivityAt: CATALOGUE_NOW - 9 * DAY,
	});
	const ember = await addWorkspace(world, relay, {
		name: "ember",
		branch: "sam/retry-webhooks",
		lastActivityAt: CATALOGUE_NOW - 20 * MINUTE,
	});
	const fjord = await addWorkspace(world, relay, {
		name: "fjord",
		branch: "sam/cache-invalidation",
		lastActivityAt: CATALOGUE_NOW - 45 * MINUTE,
	});
	const grove = await addWorkspace(world, relay, {
		name: "grove",
		branch: "sam/upgrade-node-24",
		pr: { number: 218, title: "Upgrade to Node 24" },
		lastActivityAt: CATALOGUE_NOW - 3 * HOUR,
	});

	const chats = {
		arbor: await addChat(world, arbor, { title: "Fix the login redirect" }),
		beacon: await addChat(world, beacon, { title: "Rate-limit the public API" }),
		canyon: await addChat(world, canyon, { title: "Dark mode on the settings page" }),
		ember: await addChat(world, ember, { title: "Retry failed webhooks" }),
		fjord: await addChat(world, fjord, { title: "Invalidate the cache on writes" }),
		grove: await addChat(world, grove, { title: "Upgrade to Node 24", unread: 2 }),
	};

	await addEvents(world, chats.arbor.id, finishedLoginFix(CATALOGUE_NOW - 15 * MINUTE).events);
	await addEvents(
		world,
		chats.beacon.id,
		oneTurn(
			"beacon",
			CATALOGUE_NOW - 40 * MINUTE,
			"Where do we handle API requests before they reach the routes?",
			"In `src/http/middleware.ts`. Every request passes `authenticate` and then `parseBody` before routing.",
		).events,
	);
	await addEvents(
		world,
		chats.canyon.id,
		oneTurn(
			"canyon",
			CATALOGUE_NOW - 30 * MINUTE,
			"Does the settings page read the theme from the user's profile?",
			"No. It reads `prefers-color-scheme` only. The profile has a `theme` field that nothing reads yet.",
		).events,
	);
	await addEvents(
		world,
		chats.ember.id,
		oneTurn(
			"ember",
			CATALOGUE_NOW - 50 * MINUTE,
			"Webhook deliveries that fail are dropped. Make them retry.",
			"I'll add a retry queue. One thing to settle first, which I'll ask in a moment.",
		).events,
	);
	await addEvents(
		world,
		chats.fjord.id,
		oneTurn(
			"fjord",
			CATALOGUE_NOW - 70 * MINUTE,
			"Stale prices show for up to five minutes after an edit. Plan a fix before changing anything.",
			"I'll look at how prices are cached and come back with a plan.",
		).events,
	);
	await addEvents(
		world,
		chats.grove.id,
		oneTurn(
			"grove",
			CATALOGUE_NOW - 4 * HOUR,
			"Upgrade the service to Node 24 and fix whatever breaks.",
			"Done. Node 24 is in `.node-version` and the Dockerfile, and the one failing test used a removed `url.parse` call. The pull request is open.",
		).events,
	);

	const cast = { atlas, relay, arbor, beacon, canyon, delta, ember, fjord, grove, chats };
	plantGit(world, cast, git);
	return cast;
}

const APPROVAL: Interaction = {
	kind: "tool_approval",
	toolUseId: "canyon-approval-tool" as ToolUseId,
	toolName: "Bash",
	input: { command: "pnpm add @radix-ui/react-switch", description: "Add the switch component" },
	reason: "Adding a dependency changes package.json and the lockfile.",
	suggestedRules: ["Allow pnpm add in this project"],
};

const QUESTION: Interaction = {
	kind: "question",
	questions: [
		{
			header: "Retries",
			question: "How long should a failed webhook keep retrying?",
			multiSelect: false,
			options: [
				{ label: "One hour", description: "Five tries, doubling the wait each time." },
				{ label: "One day", description: "Twelve tries, the last one 24 hours after the first." },
				{ label: "Until it succeeds", description: "Keep trying every hour; never give up." },
			],
		},
	],
};

const PLAN: Interaction = {
	kind: "plan_approval",
	plan: [
		"# Invalidate cached prices on write",
		"",
		"Prices are cached for five minutes in `PriceCache` and nothing clears an entry when a price changes.",
		"",
		"1. Give `PriceCache` a `forget(productId)` method.",
		"2. Call it from `updatePrice` and `bulkImport` after the database write commits.",
		"3. Add a test that edits a price and reads the new value at once.",
		"",
		"No schema change. The five-minute expiry stays as a safety net.",
	].join("\n"),
};

/**
 * Makes the cast's chats work and wait: beacon is working on a turn with a queued follow-up; canyon,
 * ember and fjord wait for an approval, an answer and a plan review.
 */
export async function animateCast(world: World, cast: Cast, app: StartedApp): Promise<void> {
	const running = conversation("beacon-live", CATALOGUE_NOW - 3 * MINUTE, 20_000);
	const turn = running.user(
		"Rate-limit the public API: 100 requests a minute per key, with a clear error when a client goes over.",
	);
	running.thinking(
		turn,
		"A token bucket per API key in the middleware fits. I'll check what store the app already uses for counters.",
	);
	running.tool(turn, {
		tool: "grep",
		rawName: "Grep",
		input: { pattern: "redis", path: "src" },
		output: "src/cache/redis.ts\nsrc/jobs/queue.ts",
	});
	running.tool(turn, {
		tool: "bash",
		rawName: "Bash",
		input: { command: "pnpm test src/http", description: "Run the HTTP tests" },
		output: null,
	});
	setLiveState(world, cast.chats.beacon.id, {});
	deliverEvents(world, cast.chats.beacon.id, running.events, 10);
	await waitForWorking(app, cast.chats.beacon.id);
	const queued = await app.container.actions.sessions.send(
		cast.chats.beacon.id,
		"Also return a Retry-After header with the number of seconds to wait.",
		[],
		"queue",
	);
	if (!queued.ok) throw new Error(`Queueing the follow-up failed: ${queued.error.message}`);

	openInteraction(world, cast.chats.canyon.id, "canyon-approval", APPROVAL);
	openInteraction(world, cast.chats.ember.id, "ember-question", QUESTION);
	openInteraction(world, cast.chats.fjord.id, "fjord-plan", PLAN);
}

/** Resolves once the app has taken in the working state, so a send queues instead of sending. */
function waitForWorking(app: StartedApp, sessionId: Session["id"]): Promise<void> {
	const { store } = app.container.services.sessions;
	const isWorking = (): boolean => store.getState().liveStates[sessionId]?.status === "working";
	if (isWorking()) return Promise.resolve();
	return new Promise((resolve) => {
		const stop = store.subscribe(() => {
			if (!isWorking()) return;
			stop();
			resolve();
		});
	});
}

/**
 * Loads the workspace's project settings, then runs one full git refresh and one pull request poll
 * through the app's own services.
 * The app polls git every five seconds once the clock moves on; the catalogue's clock stands still, so
 * the first poll would be the only one and could run before the settings are read.
 */
export async function refreshGit(app: StartedApp, workspace: Workspace): Promise<void> {
	const { repo, git } = app.container.services;
	const config = await repo.loadConfig(workspace.repoId);
	if (!config.ok) throw new Error(`Loading the project settings failed: ${config.error.message}`);
	const refreshed = await git.refresh(workspace.id, "full");
	if (!refreshed.ok) console.info("[catalogue] git refresh failed:", refreshed.error.message);
	const polled = await app.container.services.github.pollNow(workspace.id);
	if (!polled.ok) console.info("[catalogue] pull request poll failed:", polled.error.message);
}

const SIGN_IN_BEFORE = `import { redirect } from '../http/redirect';
import { createSession } from './session';

export async function signIn(request: Request) {
  const session = await createSession(request);
  return redirect('/', { session });
}
`;

const SIGN_IN_AFTER = `import { redirect } from '../http/redirect';
import { createSession } from './session';
import { safeNext } from './safe-next';

export async function signIn(request: Request) {
  const session = await createSession(request);
  const next = new URL(request.url).searchParams.get('next');
  return redirect(safeNext(next), { session });
}
`;

const SAFE_NEXT = `/** The page to open after signing in: a path on this site, or the home page. */
export function safeNext(next: string | null): string {
  if (next === null || next === '') return '/';
  // A protocol-relative URL such as //evil.example leaves the site.
  if (!next.startsWith('/') || next.startsWith('//')) return '/';
  try {
    const url = new URL(next, 'https://atlas.local');
    return url.origin === 'https://atlas.local' ? url.pathname + url.search : '/';
  } catch {
    return '/';
  }
}
`;

const SAFE_NEXT_TEST = `import { describe, expect, it } from 'vitest';
import { safeNext } from './safe-next';

describe('safeNext', () => {
  it('keeps a path on this site', () => {
    expect(safeNext('/billing?tab=invoices')).toBe('/billing?tab=invoices');
  });

  it('falls back to the home page when empty', () => {
    expect(safeNext(null)).toBe('/');
    expect(safeNext('')).toBe('/');
  });

  it('refuses another site', () => {
    expect(safeNext('https://evil.example')).toBe('/');
  });

  it('refuses a protocol-relative URL', () => {
    expect(safeNext('//evil.example')).toBe('/');
  });
});
`;

const README_BEFORE = `# Atlas

The customer dashboard.

## Development

    pnpm install
    pnpm dev
`;

const README_AFTER = `# Atlas

The customer dashboard.

## Development

    pnpm install
    pnpm dev

## Signing in

After signing in, the app opens the page in the \`next\` parameter when it is on this site.
`;

/** arbor's working tree: the login fix committed, a README note not yet committed, one new file. */
export const ARBOR_FILES: ScriptedFile[] = [
	{
		path: "src/auth/sign-in.ts",
		status: "modified",
		before: SIGN_IN_BEFORE,
		after: SIGN_IN_AFTER,
		committed: true,
	},
	{ path: "src/auth/safe-next.ts", status: "added", before: "", after: SAFE_NEXT, committed: true },
	{
		path: "src/auth/safe-next.test.ts",
		status: "added",
		before: "",
		after: SAFE_NEXT_TEST,
		committed: true,
	},
	{
		path: "README.md",
		status: "modified",
		before: README_BEFORE,
		after: README_AFTER,
		committed: false,
	},
	{
		path: "docs/redirects.md",
		status: "untracked",
		before: "",
		after: "# Redirects\n\nWhich redirects the app makes after signing in, and why.\n",
		committed: false,
	},
];

/** The files every catalogue project has besides what a workspace changed. */
const PROJECT_FILES: Record<string, string> = {
	"package.json": `{
  "name": "atlas",
  "private": true,
  "scripts": { "dev": "vite", "test": "vitest run" }
}
`,
	"src/http/redirect.ts": `export function redirect(to: string, init: { session: unknown }) {
  return new Response(null, { status: 303, headers: { location: to } });
}
`,
	"src/auth/session.ts": `export async function createSession(request: Request) {
  return { id: crypto.randomUUID(), createdAt: Date.now(), userAgent: request.headers.get('user-agent') };
}
`,
};

/** Each project's shared settings: a setup script and two run actions. */
const PROJECT_SETTINGS = `[scripts]
setup = "pnpm install"

[scripts.run.dev]
command = "pnpm dev"
default = true

[scripts.run.test]
command = "pnpm test"
`;

/** The folders the shell answers for: each workspace, and each project's own clone. */
function cleanRepo(path: string, branch: string): ScriptedRepo {
	return {
		path,
		branch,
		target: "origin/main",
		files: [],
		commits: [],
		upstream: { ahead: 0, behind: 0 },
		behindTarget: 0,
	};
}

export interface GitWorld {
	/** arbor's changes; the cast's other workspaces are clean. */
	arborFiles?: ScriptedFile[];
	/** Pull requests GitHub knows, by head branch. */
	prs?: ScriptedPr[];
}

/**
 * Scripts git and GitHub for the cast and writes arbor's files to the Mac's (in-memory) disk, so the
 * file tree and the file viewer have something to open.
 */
export function plantGit(world: World, cast: Cast, options: GitWorld = {}): void {
	const arborFiles = options.arborFiles ?? ARBOR_FILES;
	world.scriptShell((command) =>
		command.program === "xcodebuild"
			? { ok: true, value: { stdout: "", stderr: "", exitCode: 0 } }
			: null,
	);
	for (const repo of [cast.atlas, cast.relay]) {
		world.scriptShell(scriptRepo(cleanRepo(repo.rootPath, repo.defaultBranch)));
	}
	for (const workspace of [
		cast.beacon,
		cast.canyon,
		cast.delta,
		cast.ember,
		cast.fjord,
		cast.grove,
	]) {
		world.scriptShell(scriptRepo(cleanRepo(workspace.path, workspace.branch)));
	}
	world.scriptShell(
		scriptRepo({
			path: cast.arbor.path,
			branch: cast.arbor.branch,
			target: "origin/main",
			files: arborFiles,
			commits: [
				{
					sha: "5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f",
					subject: "Keep the requested page after sign-in",
					at: (CATALOGUE_NOW - 10 * MINUTE) / 1000,
				},
				{
					sha: "9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d",
					subject: "Add safeNext with tests",
					at: (CATALOGUE_NOW - 11 * MINUTE) / 1000,
				},
			],
			upstream: { ahead: 1, behind: 0 },
			behindTarget: 2,
		}),
	);
	world.scriptShell(scriptGitHub(options.prs ?? []));
	for (const repo of [cast.atlas, cast.relay]) {
		world.memory.controls.files.set(`${repo.rootPath}/.conducted/settings.toml`, PROJECT_SETTINGS);
	}
	for (const [path, text] of Object.entries(PROJECT_FILES)) {
		world.memory.controls.files.set(`${cast.arbor.path}/${path}`, text);
	}
	for (const file of arborFiles) {
		if (file.status !== "deleted")
			world.memory.controls.files.set(`${cast.arbor.path}/${file.path}`, file.after);
	}
}
