// @vitest-environment node
import { ok, type SessionId } from "@conducted/shared";
import { afterEach, describe, expect, it } from "vitest";
import {
	conductorChatRows,
	done,
	KNOWN_CHAT,
	manyTurns,
	said,
	text,
	wrote,
} from "../../test/conductor-chat.ts";
import { buildConductorFixture } from "../../test/conductor-fixture.ts";
import { createTestContainer, seedSessionEvent, type TestContainer } from "../../test/container.ts";
import { failingOnExecute } from "../../test/failing-database.ts";
import { answerSidecar, type SidecarCall, sidecarRefuses } from "../../test/sidecar-answers.ts";
import { answerHistory } from "../../test/sidecar-history.ts";
import { DIFF_COMMENTS_SQL } from "../db/diff-comments.ts";
import { SESSION_EVENTS_SQL } from "../db/session-events.ts";
import { userMessageEvent } from "../db/test-fixtures.ts";
import { conductorDatabasePath } from "./plan.ts";

const HOME = "/Users/conducted";
const ROOT = `${HOME}/conductor/repos/alpha`;
const WORKTREES = `${HOME}/conductor/workspaces/alpha`;
const SECRET = "s3cr3t-value-123";
const CLOUD_SECRET = "cloud-secret-456";

const SHARED_TOML = `[scripts]
setup = "npm install && echo $CONDUCTOR_PORT"
archive = "./scripts/cleanup.sh"
run_mode = "nonconcurrent"

[scripts.run.dev]
command = "npm run dev -- --port $CONDUCTOR_PORT"
`;
const LOCAL_TOML = `[scripts]
setup = "pnpm i"
`;
const CLEANUP_SH = "#!/bin/sh\necho $CONDUCTOR_ROOT_PATH\n";

/** The made-up Conductor database. `longChat` gives chat s-3 that many turns of five rows. */
const fixture = (longChat?: number) =>
	buildConductorFixture({
		repos: [
			{
				id: "r-alpha",
				name: "alpha",
				root_path: ROOT,
				default_branch: "main",
				display_order: 2,
				remote_url: "git@github.com:me/alpha.git",
				created_at: "2026-01-01 00:00:00",
				updated_at: "2026-01-02 00:00:00",
			},
			{ id: "r-gone", name: "gone", root_path: `${HOME}/conductor/repos/gone` },
		],
		workspaces: [
			{
				local_id: "w-active",
				repository_id: "r-alpha",
				directory_name: "oslo",
				branch: "me/oslo",
				state: "ready",
				unread: 1,
				intended_target_branch: "develop",
				derived_status: "in-review",
				pinned_at: "2026-01-02 03:04:05",
				workspace_name: "Oslo work",
				user_set_workspace_name: 1,
				linked_directory_paths: '["/tmp/linked"]',
				active_session_id: "s-1",
				created_at: "2026-01-01 10:00:00",
				updated_at: "2026-01-03 10:00:00",
			},
			{
				local_id: "w-archived",
				repository_id: "r-alpha",
				directory_name: "lima",
				branch: "me/lima",
				state: "archived",
				archive_commit: "abc123",
			},
			{
				local_id: "w-setup",
				repository_id: "r-alpha",
				directory_name: "rome",
				branch: "me/rome",
				state: "setting_up",
			},
			{
				local_id: "w-failed",
				repository_id: "r-alpha",
				directory_name: "nice",
				branch: "me/nice",
				state: "failed",
			},
			{
				local_id: "w-cloud",
				repository_id: "r-alpha",
				directory_name: "bonn",
				branch: "me/bonn",
				state: "ready",
				hosting_server_url: "https://cloud.example",
			},
			{
				local_id: "w-missing",
				repository_id: "r-alpha",
				directory_name: "kyiv",
				branch: "me/kyiv",
				state: "ready",
			},
		],
		sessions: [
			{
				id: "s-1",
				workspace_id: "w-active",
				agent_type: "claude",
				model: "opus",
				claude_session_id: "agent-1",
				title: "Fix login",
				permission_mode: "plan",
				claude_effort_level: "max",
				fast_mode: 1,
				context_token_count: 1200,
				created_at: "2026-01-01 11:00:00",
				updated_at: "2026-01-01 12:00:00",
			},
			{
				id: "s-2",
				workspace_id: "w-active",
				agent_type: "codex",
				model: "gpt-5",
				codex_thinking_level: "low",
				is_hidden: 1,
			},
			{ id: "s-3", workspace_id: "w-archived", agent_type: "claude", model: "sonnet" },
			{ id: "s-4", workspace_id: "w-failed", agent_type: "claude", model: "opus" },
			{ id: "s-5", workspace_id: "w-active", agent_type: "acp", model: "x" },
		],
		diff_comments: [
			{
				id: "c-user",
				workspace_id: "w-active",
				file_path: "src/a.ts",
				line_number: 3,
				body: "Rename this",
				state: "pending",
				location: "modified",
				created_at: 1_767_000_000_000,
			},
			{
				id: "c-agent",
				workspace_id: "w-active",
				file_path: "src/b.ts",
				line_number: 9,
				body: "Possible bug",
				state: "pending",
				location: "original",
				author: "Claude Code",
				created_at: 1_767_000_000_001,
			},
			{
				id: "github-T1-11",
				workspace_id: "w-active",
				file_path: "src/c.ts",
				line_number: 1,
				body: "Looks good",
				state: "reviewed",
				location: "modified",
				author: "octocat",
				remote_url: "https://github.com/me/alpha/pull/1#discussion_r11",
				thread_id: "T1",
				is_resolved: 1,
				created_at: 1_767_000_000_002,
			},
			{
				id: "github-general-12",
				workspace_id: "w-active",
				body: "Ship it",
				state: "pending",
				location: "file",
				author: "octocat",
				remote_url: "https://github.com/me/alpha/pull/1#issuecomment-12",
				created_at: 1_767_000_000_003,
			},
			{
				id: "c-legacy",
				workspace_id: "w-active",
				file_path: "src/d.ts",
				body: "old",
				created_at: 1_767_000_000_004,
			},
			{
				id: "c-archived",
				workspace_id: "w-archived",
				file_path: "src/e.ts",
				body: "later",
				state: "pending",
				location: "modified",
				created_at: 1_767_000_000_005,
			},
		],
		navigation_sections: [
			{
				id: "sec-1",
				organization_id: "org",
				user_id: "me",
				name: "Focus",
				emoji: "🎯",
				sort_order: 0,
				created_at: "2026-01-01 00:00:00",
				updated_at: "2026-01-01 00:00:00",
			},
		],
		navigation_section_memberships: [
			{
				id: "m-1",
				section_id: "sec-1",
				workspace_id: "w-active",
				created_at: "2026-01-01 00:00:00",
			},
		],
		favorite_models: [
			{
				id: "fav-1",
				position: 0,
				configuration: '{"type":"built-in","model":"opus","effortLevel":"high","fastMode":false}',
			},
			{
				id: "fav-2",
				position: 1,
				configuration: '{"type":"built-in","model":"mystery-model","effortLevel":"high"}',
			},
			{ id: "fav-3", position: 2, configuration: '{"type":"acp","acpAgentId":"opencode"}' },
		],
		settings: [
			{ key: "default_message_send_mode", value: "queued" },
			{ key: "message_send_key", value: "cmd-enter" },
			{ key: "default_model", value: "opus" },
			{ key: "some_unknown_key", value: "1" },
			{ key: "onboarding_step", value: "4" },
			{ key: "notifications_enabled", value: "false", deprecated_at: "2026-01-01 00:00:00" },
			{ key: "repo_conductor_config_file_migration_v2_complete", value: "true" },
		],
		env_vars: [
			{ key: "API_TOKEN", scope: "shared", context: "local", value: SECRET },
			{ key: "IN_KEYCHAIN", scope: "shared", context: "local", value: null },
			{ key: "CLOUD_ONE", scope: "shared", context: "cloud", value: CLOUD_SECRET },
		],
		session_events: [
			{ session_id: "s-1", session_index: 0, event_id: "e1", event_type: "userMessage" },
			{ session_id: "s-1", session_index: 1, event_id: "e2", event_type: "agent" },
		],
		session_messages: [
			...conductorChatRows("s-1", KNOWN_CHAT),
			// A queued message is not in Conductor's chat, so it never comes over.
			{ id: "s-1-queued", session_id: "s-1", role: "user", content: "Later", turn_id: null },
			...conductorChatRows("s-2", [
				{ turnId: "t-1", rows: [said("Hello Codex"), wrote({ type: "agent_message" })] },
			]),
			...conductorChatRows(
				"s-3",
				longChat === undefined
					? [
							{
								turnId: "t-1",
								rows: [said("Hi"), wrote(text("u-s3", "Hello.")), wrote(done("Hello."))],
							},
						]
					: manyTurns(longChat),
				100,
			),
			// Their chats stay behind (a failed workspace; an ACP chat), so their history does too.
			...conductorChatRows("s-4", [{ turnId: "t-1", rows: [said("Lost")] }], 200),
			...conductorChatRows("s-5", [{ turnId: "t-1", rows: [said("Pi"), said("Again")] }], 300),
		],
		terminal_sessions: [{ session_id: "t-1", workspace_id: "w-active", cwd: "/tmp" }],
	});

const WORKTREE_LIST = [
	`worktree ${ROOT}`,
	"branch refs/heads/main",
	"",
	`worktree ${WORKTREES}/oslo`,
	"branch refs/heads/me/oslo",
	"",
	`worktree ${WORKTREES}/rome`,
	"branch refs/heads/me/rome",
	"",
].join("\n");

const modelInfo = (id: string) => ({
	id,
	label: id,
	status: "picker",
	isNew: false,
	isDefault: false,
	efforts: ["low", "medium", "high"],
	defaultEffort: "high",
	effortAxis: "effort",
	liveEffortChange: true,
	supportsFastMode: true,
});

let current: TestContainer | null = null;

afterEach(async () => {
	await current?.container.stop();
	current?.close();
	current = null;
});

async function setUp(
	options: Parameters<typeof createTestContainer>[0] = {},
	setup: { longChat?: number; answer?: (call: SidecarCall) => unknown } = {},
): Promise<TestContainer> {
	const test = createTestContainer(options);
	current = test;
	const { controls } = test.memory;
	for (const program of ["claude", "codex"] as const) {
		controls.files.set(`${test.memory.platform.fs.paths.appData}/bin/${program}`, "");
		controls.setProgramStatus({
			program,
			state: "ready",
			version: "test",
			bytesDownloaded: 0,
			bytesTotal: null,
			attempt: 0,
			nextAttemptAt: null,
			error: null,
			path: `${test.memory.platform.fs.paths.appData}/bin/${program}`,
		});
	}
	controls.seedConductorDatabase(conductorDatabasePath(HOME), fixture(setup.longChat));
	controls.addFolder(ROOT);
	controls.addFolder(`${WORKTREES}/oslo`);
	controls.addFolder(`${WORKTREES}/rome`);
	controls.files.set(`${ROOT}/.conductor/settings.toml`, SHARED_TOML);
	controls.files.set(`${ROOT}/.conductor/settings.local.toml`, LOCAL_TOML);
	controls.files.set(`${ROOT}/conductor.json`, '{"scripts":{"setup":"old"}}');
	controls.files.set(`${ROOT}/scripts/cleanup.sh`, CLEANUP_SH);
	controls.files.set(`${ROOT}/.git/HEAD`, "ref: refs/heads/main\n");
	const history = answerHistory((call) =>
		call.method === "listModels"
			? { models: call.params.agent === "claude" ? [modelInfo("opus"), modelInfo("sonnet")] : [] }
			: {},
	);
	answerSidecar(test, (call) => setup.answer?.(call) ?? history(call));
	controls.scriptShell((command) => {
		if (command.program === "lsof") return ok({ exitCode: 1, stdout: "", stderr: "" });
		if (command.args.join(" ").endsWith("worktree list --porcelain") && command.cwd === ROOT) {
			return ok({ exitCode: 0, stdout: WORKTREE_LIST, stderr: "" });
		}
		return null;
	});
	const started = await test.container.start();
	if (!started.ok) throw new Error(started.error.message);
	return test;
}

/** Everything of Conductor's the import could touch: its database and the files it reads. */
function conductorState(test: TestContainer): string {
	const { controls } = test.memory;
	const files = [...controls.files.entries()]
		.filter(
			([path]) =>
				path.includes("/com.conductor.app/") ||
				path.includes("/.conductor/") ||
				path.endsWith("/conductor.json") ||
				path.endsWith("/scripts/cleanup.sh"),
		)
		.sort(([a], [b]) => a.localeCompare(b));
	return JSON.stringify({
		database: controls.conductorDatabases.get(conductorDatabasePath(HOME)),
		files,
	});
}

async function countRows(test: TestContainer): Promise<Record<string, number>> {
	const counts: Record<string, number> = {};
	for (const table of [
		"repos",
		"workspaces",
		"sessions",
		"diff_comments",
		"sections",
		"section_members",
		"favorite_models",
		"settings",
		"env_vars",
	]) {
		const rows = await test.database.select<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`);
		counts[table] = rows[0]?.n ?? -1;
	}
	return counts;
}

const must = <T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): T => {
	if (!result.ok) throw new Error(result.error.message);
	return result.value;
};

describe("APP-17 import from Conductor, through the container", () => {
	it("finds Conductor's database without copying it", async () => {
		const test = await setUp();
		const found = must(await test.container.services.conductorImport.find());
		expect(found).not.toBeNull();
		expect(test.memory.controls.conductorDatabases.size).toBe(1);
	});

	it("the dry run lists what comes over and what stays, and changes nothing", async () => {
		const test = await setUp();
		const before = await countRows(test);
		const preview = must(await test.container.services.conductorImport.preview());

		expect(await countRows(test)).toEqual(before);
		expect(test.memory.controls.secrets.size).toBe(0);
		expect(test.memory.controls.files.has(`${ROOT}/.conducted/settings.toml`)).toBe(false);
		expect(preview.kinds.repos).toEqual({ found: 2, toImport: 1, alreadyThere: 0, leftOut: 1 });
		expect(preview.kinds.workspaces).toEqual({
			found: 6,
			toImport: 3,
			alreadyThere: 0,
			leftOut: 3,
		});
		expect(preview.kinds.chats).toEqual({ found: 5, toImport: 3, alreadyThere: 0, leftOut: 2 });
		expect(preview.kinds.reviewComments).toEqual({
			found: 6,
			toImport: 4,
			alreadyThere: 0,
			leftOut: 2,
		});
		expect(preview.kinds.sections).toEqual({ found: 1, toImport: 1, alreadyThere: 0, leftOut: 0 });
		expect(preview.kinds.favoriteModels).toEqual({
			found: 3,
			toImport: 1,
			alreadyThere: 0,
			leftOut: 2,
		});
		expect(preview.kinds.settings.toImport).toBe(2);
		expect(preview.kinds.environmentVariables).toEqual({
			found: 3,
			toImport: 1,
			alreadyThere: 0,
			leftOut: 2,
		});
		expect(preview.leftOut.map((item) => item.label)).toEqual(
			expect.arrayContaining(["gone", "nice", "bonn", "kyiv", "default_model", "IN_KEYCHAIN"]),
		);
		expect(preview.renames).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ from: "CONDUCTOR_PORT", to: "CONDUCTED_PORT" }),
			]),
		);
		expect(preview.scriptMentions).toEqual([
			{
				repoName: "alpha",
				file: "scripts/cleanup.sh",
				line: 2,
				name: "CONDUCTOR_ROOT_PATH",
				newName: "CONDUCTED_ROOT_PATH",
			},
		]);
		expect(preview.notBrought.map((item) => item.what)).toEqual(
			expect.arrayContaining(["Conductor's event log", "terminal tabs"]),
		);
		// s-1 has 23 sent rows (its queued one is not counted) and s-3 has 3.
		expect(preview.history).toEqual({
			comes: { chats: 2, rows: 26 },
			alreadyThere: { chats: 0, rows: 0 },
			notMapped: [
				{ agent: "codex", chats: 1, rows: 2 },
				{ agent: "acp", chats: 1, rows: 2 },
			],
			withChatsLeftOut: { chats: 1, rows: 1 },
		});
	});

	it("imports in one go, checks the counts, and keeps Conductor's files as they were", async () => {
		const test = await setUp();
		const before = conductorState(test);
		const rowsBefore = await countRows(test);
		must(await test.container.services.conductorImport.preview());
		const outcome = must(await test.container.services.conductorImport.run());

		expect(conductorState(test)).toBe(before);
		const added = Object.fromEntries(
			Object.entries(await countRows(test)).map(([table, n]) => [
				table,
				n - (rowsBefore[table] ?? 0),
			]),
		);
		expect(added).toEqual({
			repos: 1,
			workspaces: 3,
			sessions: 3,
			diff_comments: 4,
			sections: 1,
			section_members: 1,
			favorite_models: 1,
			settings: 2,
			env_vars: 1,
		});
		expect(outcome.imported.workspaces).toBe(3);
		expect(test.memory.controls.secrets.get("env:global:API_TOKEN")).toBe(SECRET);
		expect(test.memory.controls.files.get(`${ROOT}/scripts/cleanup.sh`)).toBe(CLEANUP_SH);
		const shared = test.memory.controls.files.get(`${ROOT}/.conducted/settings.toml`) ?? "";
		expect(shared).toContain("CONDUCTED_PORT");
		expect(shared).not.toContain("CONDUCTOR_");
		expect(test.memory.controls.files.get(`${ROOT}/.conducted/settings.local.toml`)).toContain(
			"pnpm i",
		);

		const workspaces = test.container.services.workspace.store.getState().workspacesById;
		const active = workspaces["w-active"];
		expect(active).toMatchObject({
			path: `${WORKTREES}/oslo`,
			branch: "me/oslo",
			branchIsPlaceholder: false,
			targetBranch: "develop",
			kanbanStatus: "in_review",
			displayName: "Oslo work",
			linkedPaths: ["/tmp/linked"],
			activeSessionId: "s-1",
			state: "ready",
		});
		expect(workspaces["w-setup"]?.state).toBe("ready");
		expect(workspaces["w-archived"]?.state).toBe("archived");
		const chat = test.container.services.sessions.store.getState().sessions["s-1"];
		expect(chat).toMatchObject({
			agentSessionId: "agent-1",
			title: "Fix login",
			config: { agent: "claude", model: "opus", effort: "max", fastMode: true, planMode: true },
		});
		expect(
			test.container.services.sessions.store.getState().sessions["s-2"]?.closedAt,
		).not.toBeNull();
		expect(test.container.services.repo.store.getState().reposById["r-alpha"]).toMatchObject({
			name: "alpha",
			displayOrder: 2,
			remoteUrl: "git@github.com:me/alpha.git",
		});
		expect(test.memory.controls.conductorDatabases.size).toBe(1);
	});

	it("a second import adds nothing that is already there", async () => {
		const test = await setUp();
		must(await test.container.services.conductorImport.preview());
		must(await test.container.services.conductorImport.run());
		const first = await countRows(test);

		const again = must(await test.container.services.conductorImport.preview());
		expect(again.kinds.workspaces).toMatchObject({ toImport: 0, alreadyThere: 3 });
		expect(again.kinds.environmentVariables).toMatchObject({ toImport: 0, alreadyThere: 1 });
		must(await test.container.services.conductorImport.run());

		expect(await countRows(test)).toEqual(first);
	});

	it("a failure part-way leaves Conducted's database, Keychain and files as they were", async () => {
		const test = await setUp({
			wrapDatabase: (database) =>
				failingOnExecute(database, DIFF_COMMENTS_SQL.insert, new Error("disk I/O error")),
		});
		const before = await countRows(test);
		const conductor = conductorState(test);
		must(await test.container.services.conductorImport.preview());

		const outcome = await test.container.services.conductorImport.run();

		expect(outcome.ok).toBe(false);
		expect(await countRows(test)).toEqual(before);
		expect(test.memory.controls.secrets.size).toBe(0);
		expect(test.memory.controls.files.has(`${ROOT}/.conducted/settings.toml`)).toBe(false);
		expect(test.memory.controls.files.has(`${ROOT}/.conducted/settings.local.toml`)).toBe(false);
		expect(await test.memory.platform.fs.exists(`${ROOT}/.conducted`)).toBe(false);
		expect(conductorState(test)).toBe(conductor);
	});

	it("no secret value appears in the dry run, the log or an error", async () => {
		const failing = await setUp({
			wrapDatabase: (database) =>
				failingOnExecute(database, DIFF_COMMENTS_SQL.insert, new Error("disk I/O error")),
		});
		const preview = must(await failing.container.services.conductorImport.preview());
		const failed = await failing.container.services.conductorImport.run();
		const seen = JSON.stringify({
			preview,
			failed,
			state: failing.container.services.conductorImport.store.getState(),
			logs: failing.memory.controls.logs,
			reported: failing.reported,
		});
		for (const secret of [SECRET, CLOUD_SECRET]) expect(seen).not.toContain(secret);
	});

	it("a setting Conducted gained since the dry run stops the import, and nothing is replaced", async () => {
		const test = await setUp();
		must(await test.container.services.conductorImport.preview());
		must(await test.container.services.settings.set("message_send_key", "enter"));
		const before = await countRows(test);

		const outcome = await test.container.services.conductorImport.run();

		expect(outcome.ok).toBe(false);
		expect(await countRows(test)).toEqual(before);
		expect(test.container.services.settings.get("message_send_key")).toBe("enter");
		expect(test.memory.controls.secrets.size).toBe(0);
	});

	it("a cancel while the dry run reads drops its copy when the read ends", async () => {
		const test = await setUp();
		const reading = test.container.services.conductorImport.preview();
		must(await test.container.services.conductorImport.cancel());
		const read = await reading;

		expect(read.ok).toBe(false);
		expect(test.memory.controls.conductorDatabases.size).toBe(1);
		expect(test.container.services.conductorImport.store.getState().phase).toBe("idle");
	});

	it("removes its copy when the import ends and when it is cancelled", async () => {
		const test = await setUp();
		must(await test.container.services.conductorImport.preview());
		expect(test.memory.controls.conductorDatabases.size).toBe(2);
		must(await test.container.services.conductorImport.cancel());
		expect(test.memory.controls.conductorDatabases.size).toBe(1);
		must(await test.container.services.conductorImport.preview());
		must(await test.container.services.conductorImport.run());
		expect(test.memory.controls.conductorDatabases.size).toBe(1);
	});
});

/** What our chat shows of each turn: the user's message and steers, the top-level blocks, the end. */
function shown(test: TestContainer, sessionId: string) {
	const view = test.container.services.sessions.chatView(sessionId as SessionId);
	return (view?.turns ?? []).map((turn) => ({
		user: turn.userMessage?.text ?? null,
		steers: turn.steers.map((steer) => steer.text),
		blocks: turn.blocks.map((block) => {
			if (block.kind === "text") return `text: ${block.text}`;
			if (block.kind === "tool") {
				const inside = block.call.blocks.map((child) =>
					child.kind === "text"
						? `text: ${child.text}`
						: child.kind === "tool"
							? `tool: ${child.call.item.rawName}`
							: child.kind,
				);
				return inside.length === 0
					? `tool: ${block.call.item.rawName}`
					: `tool: ${block.call.item.rawName} [${inside.join("; ")}]`;
			}
			if (block.kind === "notice") return `notice: ${block.item.text}`;
			return block.kind;
		}),
		outcome: turn.outcome,
	}));
}

async function eventCount(test: TestContainer, sessionId: string): Promise<number> {
	const rows = await test.database.select<{ n: number }>(
		"SELECT COUNT(*) AS n FROM session_events WHERE session_id = $1",
		[sessionId],
	);
	return Number(rows[0]?.n ?? -1);
}

/** The known chat (conductor-chat.ts) as our chat shows it, worked out by hand. */
const KNOWN_CHAT_SHOWN = [
	{
		user: "Please fix the failing test.",
		steers: ["Also check the other test."],
		blocks: [
			"thinking",
			"text: I will read the test first.",
			"tool: Read",
			"tool: Task [text: Looking at the other test.; tool: Grep]",
			"tool: Edit",
			"text: Fixed. The test passes now.",
		],
		outcome: "success",
	},
	{
		user: null,
		steers: [],
		blocks: ["notice: Compacting...", "notice: Chat history compacted"],
		outcome: "success",
	},
	{ user: "Thanks!", steers: [], blocks: ["text: Glad to help."], outcome: "success" },
];

describe("APP-18 chat history from Conductor, through the container", () => {
	it("brings a Claude chat's history, which our chat shows turn by turn", async () => {
		const test = await setUp();
		must(await test.container.services.conductorImport.preview());
		const outcome = must(await test.container.services.conductorImport.run());

		must(await test.container.services.sessions.open("s-1" as SessionId));
		expect(shown(test, "s-1")).toEqual(KNOWN_CHAT_SHOWN);
		expect(outcome.history).toEqual({ chats: 2, changed: 0, failed: [] });
		// Each imported event is received at the import's time; its own time is Conductor's.
		const times = await test.database.select<{ received_at: number; content: string }>(
			"SELECT received_at, content FROM session_events WHERE session_id = 's-1' ORDER BY idx",
		);
		expect(new Set(times.map((row) => row.received_at))).toEqual(new Set([1_700_000_000_000]));
		expect(JSON.parse(times[0]?.content ?? "{}").at).toBe(Date.UTC(2026, 0, 2, 3, 0, 0));
		// Every turn ended, so startup repair finds nothing to close.
		const open = await test.database.select(SESSION_EVENTS_SQL.findInterruptedTurnsForSession, [
			"s-1",
		]);
		expect(open).toEqual([]);
	});

	it("an imported agent event keeps no raw payload: the original stays in Conductor's database (D132)", async () => {
		const test = await setUp();
		must(await test.container.services.conductorImport.preview());
		must(await test.container.services.conductorImport.run());

		const agent = await test.database.select<{ content: string }>(
			"SELECT content FROM session_events WHERE session_id = 's-1' AND type = 'agent'",
		);
		expect(agent.length).toBeGreaterThan(0);
		const withRaw = agent.filter((row) => "raw" in (JSON.parse(row.content).message ?? {}));
		expect(withRaw).toEqual([]);
	});

	it("a chat of an agent with no mapping comes over without history", async () => {
		const test = await setUp();
		must(await test.container.services.conductorImport.preview());
		must(await test.container.services.conductorImport.run());

		expect(test.container.services.sessions.store.getState().sessions["s-2"]).toBeDefined();
		expect(await eventCount(test, "s-2")).toBe(0);
	});

	it("a chat whose history fails comes without it, is named, and the others are whole", async () => {
		let reads = 0;
		const test = await setUp(
			{},
			{
				longChat: 500,
				// The long chat's second read fails, after its first read's events were written.
				answer: (call) => {
					const forLongChat = String(call.params.historyId).endsWith(":s-3");
					if (call.method !== "mapConductorHistory" || !forLongChat) return undefined;
					reads++;
					return reads === 3 ? sidecarRefuses("The mapping stopped.") : undefined;
				},
			},
		);
		const preview = must(await test.container.services.conductorImport.preview());
		expect(preview.history.comes).toEqual({ chats: 2, rows: 23 + 2500 });
		const outcome = must(await test.container.services.conductorImport.run());

		expect(outcome.history.chats).toBe(1);
		expect(outcome.history.failed).toEqual([
			{
				sessionId: "s-3",
				label: "A chat in lima",
				reason: expect.stringContaining("The mapping stopped."),
			},
		]);
		expect(test.container.services.sessions.store.getState().sessions["s-3"]).toBeDefined();
		expect(await eventCount(test, "s-3")).toBe(0);
		must(await test.container.services.sessions.open("s-1" as SessionId));
		expect(shown(test, "s-1")).toEqual(KNOWN_CHAT_SHOWN);
		expect(test.container.services.conductorImport.store.getState().history?.failed).toHaveLength(
			1,
		);

		// The next import brings the failed chat's history, and adds nothing to the others.
		const s1Events = await eventCount(test, "s-1");
		const again = must(await test.container.services.conductorImport.preview());
		expect(again.history.comes).toEqual({ chats: 1, rows: 2500 });
		expect(again.history.alreadyThere).toEqual({ chats: 1, rows: 23 });
		const retried = must(await test.container.services.conductorImport.run());
		expect(retried.history).toEqual({ chats: 1, changed: 0, failed: [] });
		expect(await eventCount(test, "s-3")).toBe(500 * 5 + 500);
		expect(await eventCount(test, "s-1")).toBe(s1Events);
	});

	it("a second import adds no history", async () => {
		const test = await setUp();
		must(await test.container.services.conductorImport.preview());
		must(await test.container.services.conductorImport.run());
		const before = {
			s1: await eventCount(test, "s-1"),
			s3: await eventCount(test, "s-3"),
		};

		const again = must(await test.container.services.conductorImport.preview());
		expect(again.history).toMatchObject({
			comes: { chats: 0, rows: 0 },
			alreadyThere: { chats: 2, rows: 26 },
		});
		const outcome = must(await test.container.services.conductorImport.run());
		expect(outcome.history).toEqual({ chats: 0, changed: 0, failed: [] });
		expect({ s1: await eventCount(test, "s-1"), s3: await eventCount(test, "s-3") }).toEqual(
			before,
		);
	});

	it("a chat used since the dry run keeps what it has and gains no history", async () => {
		const test = await setUp(
			{},
			{
				answer: (call) =>
					call.method === "mapConductorHistory" && String(call.params.historyId).endsWith(":s-3")
						? sidecarRefuses("The mapping stopped.")
						: undefined,
			},
		);
		must(await test.container.services.conductorImport.preview());
		must(await test.container.services.conductorImport.run());
		expect(await eventCount(test, "s-3")).toBe(0);

		const again = must(await test.container.services.conductorImport.preview());
		expect(again.history.comes).toEqual({ chats: 1, rows: 3 });
		// The user sends a message in the chat before going ahead.
		await seedSessionEvent(
			test.container,
			"s-3" as SessionId,
			userMessageEvent("e-own", "turn-own", 1_700_000_000_000),
			1_700_000_000_000,
		);
		const outcome = must(await test.container.services.conductorImport.run());

		expect(outcome.history).toEqual({ chats: 0, changed: 1, failed: [] });
		expect(await eventCount(test, "s-3")).toBe(1);
	});

	it("a chat with a message too large to carry comes without history, and says why", async () => {
		const test = await setUp();
		const database = fixture();
		const rows = [...(database.session_messages ?? [])];
		const huge = rows.findIndex((row) => row.session_id === "s-3" && row.role === "assistant");
		rows[huge] = { ...rows[huge], content: JSON.stringify(text("u-huge", "y".repeat(6_000_001))) };
		test.memory.controls.seedConductorDatabase(conductorDatabasePath(HOME), {
			...database,
			session_messages: rows,
		});
		must(await test.container.services.conductorImport.preview());
		const outcome = must(await test.container.services.conductorImport.run());

		expect(outcome.history.failed).toEqual([
			expect.objectContaining({
				sessionId: "s-3",
				reason: expect.stringContaining("more than the import can carry"),
			}),
		]);
		expect(await eventCount(test, "s-3")).toBe(0);
		expect(await eventCount(test, "s-1")).toBeGreaterThan(0);
	});
});
