// @vitest-environment node
/**
 * @feature CLOUD-13 Local copy of cloud data, kept apart by host
 * Owns: the proof that a cloud workspace's rows are reached only through its workspace's host,
 * that the queries local work runs over never return them, and that removing the host takes all
 * of them in one transaction.
 * Behaviour: services-map.md 1.2 (the host picks the record's database) and 2.6.2 (the local copy
 * of a remote host's data). Our design choice: one database, so the host has one home on the
 * workspace and its children follow by reference (D103).
 * Must handle: local queries (ports, folder names, the archive scan, startup repair) leave cloud
 * rows alone; a local row is never removed by a host sweep; a second sweep changes nothing.
 * Test first: removing a cloud host deletes its rows in every table and leaves local rows alone.
 */
import { type Host, idleLiveState } from "@conducted/protocol";
import type { WorkspaceId } from "@conducted/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database, FileSystem } from "../../platform/platform.ts";
import { openTestDatabase } from "../../test/sqlite.ts";
import { runStartupRepair } from "./repair.ts";
import { REPOS_SQL, repoToParams } from "./repos.ts";
import { createRepositories, type Repositories } from "./repositories.ts";
import { sampleRepo, sessionConfig, userMessageEvent } from "./test-fixtures.ts";

const CLOUD: Host = {
	kind: "cloud",
	url: "https://conducted.example.workers.dev",
	vmId: "vm-1",
};

const TABLES = [
	"sessions",
	"session_events",
	"session_live_state",
	"diff_comments",
	"terminals",
	"workspaces",
] as const;

let store: ReturnType<typeof openTestDatabase>;
let database: Database;
let repositories: Repositories;
let nextId: number;

const must = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

beforeEach(async () => {
	store = openTestDatabase();
	database = store.database;
	store.raw
		.prepare(REPOS_SQL.insert)
		.run(
			Object.fromEntries(
				repoToParams(sampleRepo).map((value, index) => [`$${index + 1}`, value]),
			) as never,
		);
	nextId = 0;
	repositories = createRepositories(database, {
		clock: { now: () => 1000 },
		ids: { uuid: () => `cloud-13-${++nextId}` },
	});
});

afterEach(() => {
	store.close();
});

/** A workspace on `host`, ready, with one session, event, live state, comment and terminal. */
async function seed(host: Host, name: string, port: number): Promise<WorkspaceId> {
	const workspace = must(
		await repositories.workspaces.create({
			repoId: sampleRepo.id,
			directoryName: name,
			path: `/code/workspaces/${name}`,
			branch: `jahala/${name}`,
			branchIsPlaceholder: false,
			targetBranch: "origin/main",
			port,
			linkedPaths: [],
			setupLogPath: null,
			host,
		}),
	);
	await database.execute("UPDATE workspaces SET state = 'ready' WHERE id = $1", [workspace.id]);
	const session = must(
		await repositories.sessions.create({
			workspaceId: workspace.id,
			title: name,
			config: sessionConfig,
		}),
	);
	must(
		await repositories.sessionEvents.append(
			session.id,
			userMessageEvent(`event-${name}`, `turn-${name}`, 10),
			10,
		),
	);
	must(
		await repositories.liveStates.upsert(session.id, { ...idleLiveState, status: "working" }, 10),
	);
	must(
		await repositories.diffComments.add({
			workspaceId: workspace.id,
			filePath: "src/app.ts",
			line: 1,
			endLine: null,
			body: `comment on ${name}`,
			author: { kind: "user", name: null, avatarUrl: null },
			side: "additions",
			threadId: null,
			replyToId: null,
			suggestion: null,
			suggestionBaseCode: null,
		}),
	);
	must(
		await repositories.terminals.start({
			workspaceId: workspace.id,
			repoId: null,
			kind: "terminal",
			title: name,
			cwd: `/code/workspaces/${name}`,
			placement: "centre",
			startCommand: null,
		}),
	);
	return workspace.id;
}

/** The workspaces of one host, as a subquery the child tables are counted through. */
const workspacesOf = (host: Host): string =>
	host.kind === "local"
		? "SELECT id FROM workspaces WHERE host_kind = 'local'"
		: "SELECT id FROM workspaces WHERE host_kind = 'cloud' AND host_url = $1 AND host_vm_id = $2";

/** The chats of one host, as a subquery the chat-owned tables are counted through. */
const sessionsOf = (host: Host): string =>
	`SELECT id FROM sessions WHERE workspace_id IN (${workspacesOf(host)})`;

/** A count per table, each reached the way the schema reaches it: through workspaces. */
const countForHost = async (table: string, host: Host): Promise<number> => {
	const chatOwned = table === "session_events" || table === "session_live_state";
	const column = chatOwned ? "session_id" : table === "workspaces" ? "id" : "workspace_id";
	const scope = chatOwned ? sessionsOf(host) : workspacesOf(host);
	const params = host.kind === "local" ? [] : [host.url, host.vmId];
	const rows = await database.select<{ total: number }>(
		`SELECT COUNT(*) AS total FROM ${table} WHERE ${column} IN (${scope})`,
		params,
	);
	return rows[0]?.total ?? 0;
};

describe("CLOUD-13 cloud rows kept apart by host", () => {
	it("a local query never returns cloud rows", async () => {
		const localId = await seed({ kind: "local" }, "oslo", 55100);
		await seed(CLOUD, "lisbon", 55101);

		expect(must(await repositories.workspaces.listPorts())).toEqual([55100]);
		expect(must(await repositories.workspaces.listByState("ready")).map((ws) => ws.id)).toEqual([
			localId,
		]);
	});

	it("the folder names hold every host's rows, because the unique index spans hosts", async () => {
		await seed({ kind: "local" }, "oslo", 55100);
		await seed(CLOUD, "lisbon", 55101);

		// CLOUD-19: a name a cloud workspace holds must not be picked again for either host, or the
		// (repo, directory name) unique index refuses the new row.
		expect(must(await repositories.workspaces.listDirectoryNames(sampleRepo.id)).sort()).toEqual([
			"lisbon",
			"oslo",
		]);
	});

	it("startup repair leaves cloud rows alone", async () => {
		await seed({ kind: "local" }, "oslo", 55100);
		await seed(CLOUD, "lisbon", 55101);

		must(
			await runStartupRepair({
				db: database,
				fs: { exists: async () => false } as unknown as FileSystem,
				clock: { now: () => 2000 },
				ids: { uuid: () => `repair-${++nextId}` },
			}),
		);

		const states = await database.select<{ status: string }>(
			`SELECT json_extract(live_state, '$.status') AS status FROM session_live_state
				WHERE session_id IN (${sessionsOf(CLOUD)})`,
			[CLOUD.url, CLOUD.vmId],
		);
		expect(states).toEqual([{ status: "working" }]);
		const terminals = await database.select<{ ended_at: number | null }>(
			`SELECT ended_at FROM terminals WHERE workspace_id IN (${workspacesOf(CLOUD)})`,
			[CLOUD.url, CLOUD.vmId],
		);
		expect(terminals).toEqual([{ ended_at: null }]);
		const open = await database.select<{ total: number }>(
			`SELECT COUNT(*) AS total FROM session_events
				WHERE session_id IN (${sessionsOf(CLOUD)}) AND type = 'turn_ended'`,
			[CLOUD.url, CLOUD.vmId],
		);
		expect(open[0]?.total).toBe(0);
	});

	it("removing a cloud host deletes its rows in every table and leaves local rows alone", async () => {
		await seed({ kind: "local" }, "oslo", 55100);
		await seed(CLOUD, "lisbon", 55101);
		const localBefore = new Map<string, number>();
		for (const table of TABLES)
			localBefore.set(table, await countForHost(table, { kind: "local" }));
		for (const table of TABLES) expect(await countForHost(table, CLOUD)).toBeGreaterThan(0);

		must(await repositories.hostCopy.remove(CLOUD));

		for (const table of TABLES) {
			expect({ table, total: await countForHost(table, CLOUD) }).toEqual({ table, total: 0 });
			expect({ table, total: await countForHost(table, { kind: "local" }) }).toEqual({
				table,
				total: localBefore.get(table),
			});
		}

		// A second sweep changes nothing.
		must(await repositories.hostCopy.remove(CLOUD));
		expect(await countForHost("workspaces", { kind: "local" })).toBe(1);
	});

	it("a cloud workspace's session_event goes with its host sweep", async () => {
		const cloudId = await seed(CLOUD, "lisbon", 55101);
		const [session] = await database.select<{ id: string }>(
			"SELECT id FROM sessions WHERE workspace_id = $1",
			[cloudId],
		);
		const event = await database.select<{ event_id: string }>(
			"SELECT event_id FROM session_events WHERE session_id = $1",
			[session?.id],
		);
		expect(event.length).toBeGreaterThan(0);

		must(await repositories.hostCopy.remove(CLOUD));

		const left = await database.select<{ total: number }>(
			"SELECT COUNT(*) AS total FROM session_events WHERE event_id = $1",
			[event[0]?.event_id],
		);
		expect(left[0]?.total).toBe(0);
	});

	it("refuses to remove the local host's rows", async () => {
		const removed = await repositories.hostCopy.remove({ kind: "local" });
		expect(removed.ok).toBe(false);
		expect(removed.ok ? null : removed.error.code).toBe("db.invalid_host");
	});
});
