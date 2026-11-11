// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildConductorFixture, type ConductorFixtureRows } from "../../test/conductor-fixture.ts";
import type { Repo } from "../model.ts";
import { parseSettingsDocument } from "../services/settings.ts";
import { tomlCodec } from "../services/toml-codec.ts";
import {
	type ConductedState,
	type PlanInput,
	planConductorImport,
	type RepoFolder,
} from "./plan.ts";

const ROOT = "/Users/me/conductor/repos/alpha";
const NOW = 1_800_000_000_000;

const folder = (overrides: Partial<RepoFolder> = {}): RepoFolder => ({
	exists: true,
	worktrees: [{ path: ROOT, branch: "main" }],
	shared: null,
	local: null,
	unreadable: [],
	conductorJson: false,
	conductedShared: false,
	conductedLocal: false,
	scriptFiles: {},
	...overrides,
});

const nothing = (): ConductedState => ({
	repos: [],
	workspaces: [],
	sessionIds: new Set(),
	sessionIdsWithEvents: new Set(),
	commentIds: new Set(),
	sectionIds: new Set(),
	sectionCount: 0,
	favorites: [],
	settingKeys: new Set(),
	globalEnvVarNames: new Set(),
	keychainKeysInUse: new Set(),
});

const DEFAULTS: PlanInput["chatDefaults"] = {
	agent: "claude",
	model: "default",
	effort: "high",
	fastMode: false,
	planMode: false,
	requireToolApproval: false,
	additionalDirectories: [],
	appTools: {
		diffComments: true,
		progressUpdates: true,
		setTargetBranch: true,
		localExecution: false,
	},
};

/** Each chat's sent `session_messages` rows, as the copy's read counts them. */
function sentRowsByChat(
	database: ReturnType<typeof buildConductorFixture>,
): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const row of database.session_messages ?? []) {
		if (row.sent_at === null || typeof row.session_id !== "string") continue;
		counts[row.session_id] = (counts[row.session_id] ?? 0) + 1;
	}
	return counts;
}

function plan(
	rows: ConductorFixtureRows,
	options: { conducted?: ConductedState; folders?: Record<string, RepoFolder> } = {},
) {
	const database = buildConductorFixture({
		repos: [{ id: "r-alpha", name: "alpha", root_path: ROOT }],
		...rows,
	});
	return planConductorImport({
		snapshot: { tables: database, counts: {}, messageRows: sentRowsByChat(database) },
		workspacesRoot: "/Users/me/conducted",
		conducted: options.conducted ?? nothing(),
		folders: options.folders ?? { [ROOT]: folder() },
		offeredModels: { claude: ["opus"], codex: ["gpt-5"], cursor: [] },
		chatDefaults: DEFAULTS,
		now: NOW,
	});
}

describe("APP-17 the import's plan", () => {
	it("a workspace whose folder is not among the repository's worktrees is left out with the reason", () => {
		const planned = plan({
			workspaces: [
				{
					local_id: "w-1",
					repository_id: "r-alpha",
					directory_name: "oslo",
					branch: "b",
					state: "ready",
				},
			],
		});
		expect(planned.rows.workspaces).toEqual([]);
		expect(planned.preview.leftOut).toEqual([
			{
				kind: "workspaces",
				label: "oslo",
				reason: "Its folder is not a worktree of the project any more.",
			},
		]);
	});

	it("leaves out a row whose id could not be a file or ref name", () => {
		const planned = plan({
			workspaces: [
				{
					local_id: "../escape",
					repository_id: "r-alpha",
					directory_name: "oslo",
					state: "archived",
				},
			],
		});
		expect(planned.rows.workspaces).toEqual([]);
		expect(planned.preview.leftOut[0]?.reason).toBe("Its id cannot be used as a Conducted id.");
	});

	it("reuses a project Conducted already has in the same folder", () => {
		const ours: Repo = {
			id: "ours" as Repo["id"],
			name: "alpha",
			rootPath: ROOT,
			remoteUrl: null,
			defaultBranch: "trunk",
			icon: null,
			displayOrder: 0,
			hidden: false,
			createdAt: 1,
			updatedAt: 1,
		};
		const planned = plan(
			{
				workspaces: [
					{
						local_id: "w-1",
						repository_id: "r-alpha",
						directory_name: "lima",
						branch: "b",
						state: "archived",
					},
				],
			},
			{ conducted: { ...nothing(), repos: [ours] } },
		);
		expect(planned.rows.repos).toEqual([]);
		expect(planned.preview.kinds.repos).toMatchObject({ alreadyThere: 1, toImport: 0 });
		expect(planned.rows.workspaces[0]).toMatchObject({
			repoId: "ours",
			targetBranch: "trunk",
			path: "/Users/me/conducted/workspaces/alpha/lima",
			state: "archived",
		});
	});

	it("keeps at most four favourites, counting the ones Conducted has", () => {
		const favorites = Array.from({ length: 3 }, (_, index) => ({
			id: `ours-${index}`,
			config: {
				agent: "codex" as const,
				model: `m-${index}`,
				effort: "low" as const,
				fastMode: false,
			},
			position: index,
		}));
		const planned = plan(
			{
				favorite_models: [
					{
						id: "f-1",
						position: 0,
						configuration: '{"type":"built-in","model":"opus","effortLevel":"max"}',
					},
					{ id: "f-2", position: 1, configuration: '{"type":"built-in","model":"gpt-5"}' },
				],
			},
			{ conducted: { ...nothing(), favorites } },
		);
		expect(planned.rows.favoriteModels).toEqual([
			{
				id: "f-1",
				config: { agent: "claude", model: "opus", effort: "max", fastMode: false },
				position: 3,
			},
		]);
		expect(planned.preview.leftOut.map((item) => item.reason)).toEqual([
			"Conducted keeps at most 4 favourites.",
		]);
	});

	it("never replaces a Keychain value Conducted already holds", () => {
		const planned = plan(
			{ env_vars: [{ key: "TOKEN", scope: "shared", context: "local", value: "v" }] },
			{ conducted: { ...nothing(), keychainKeysInUse: new Set(["env:global:TOKEN"]) } },
		);
		expect(planned.secretMoves).toEqual([]);
		expect(planned.rows.envVars).toEqual([]);
		expect(planned.preview.kinds.environmentVariables.leftOut).toBe(1);
	});

	it("shows an unread workspace through its newest chat", () => {
		const planned = plan(
			{
				workspaces: [
					{
						local_id: "w-1",
						repository_id: "r-alpha",
						directory_name: "oslo",
						branch: "b",
						state: "ready",
						unread: 1,
					},
				],
				sessions: [
					{ id: "s-old", workspace_id: "w-1", created_at: "2026-01-01 00:00:00" },
					{ id: "s-new", workspace_id: "w-1", created_at: "2026-02-01 00:00:00" },
				],
			},
			{ folders: { [ROOT]: folder({ worktrees: [{ path: `${ROOT}-wt/oslo`, branch: "b" }] }) } },
		);
		expect(planned.rows.sessions.map((session) => [session.id, session.unreadCount])).toEqual([
			["s-old", 0],
			["s-new", 1],
		]);
	});

	it("takes repository scripts from Conductor's files, or from its columns before its migration", () => {
		const shared = tomlCodec.parse('[scripts]\nsetup = "make $CONDUCTOR_PORT"\n');
		if (!shared.ok) throw new Error(shared.error.message);
		const withFile = plan(
			{ settings: [{ key: "repo_conductor_config_file_migration_v2_complete", value: "true" }] },
			{
				folders: {
					[ROOT]: folder({
						shared: parseSettingsDocument(shared.value, `${ROOT}/.conductor/settings.toml`),
					}),
				},
			},
		);
		expect(withFile.files).toEqual([
			{
				path: `${ROOT}/.conducted/settings.toml`,
				repoRootPath: ROOT,
				scope: "shared",
				scripts: { values: { setup_script: "make $CONDUCTED_PORT" }, actions: [] },
			},
		]);
		const fromColumns = plan({
			repos: [{ id: "r-alpha", name: "alpha", root_path: ROOT, setup_script: "npm ci" }],
		});
		expect(fromColumns.files.map((file) => [file.scope, file.scripts.values])).toEqual([
			["local", { setup_script: "npm ci", run_script_mode: "concurrent" }],
		]);
		const migrated = plan({
			repos: [{ id: "r-alpha", name: "alpha", root_path: ROOT, setup_script: "npm ci" }],
			settings: [{ key: "repo_conductor_config_file_migration_v2_complete", value: "true" }],
		});
		expect(migrated.files).toEqual([]);
	});
});
