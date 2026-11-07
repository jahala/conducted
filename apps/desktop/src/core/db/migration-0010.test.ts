// @vitest-environment node
/**
 * @feature CLOUD-13 Local copy of cloud data, kept apart by host
 * Tests migration 0010 and the row codecs: a row stored before the migration reads back as
 * local, a row of a cloud workspace carries that workspace's host, and a half-written host is
 * refused instead of read as local.
 * Test first: a session row stored without host columns reads back as local.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openTestDatabase } from "../../test/sqlite.ts";
import { REPOS_SQL, repoToParams } from "./repos.ts";
import { createRepositories, type Repositories } from "./repositories.ts";
import { SESSIONS_SQL, sessionFromRow } from "./sessions.ts";
import { sampleRepo, sampleWorkspace, sessionConfig } from "./test-fixtures.ts";
import { WORKSPACES_SQL, workspaceToParams } from "./workspaces.ts";

let store: ReturnType<typeof openTestDatabase>;
let repositories: Repositories;
let nextId: number;

/** node:sqlite binds `$1..$n` by name, so a positional list becomes `{ $1: ... }`. */
const bind = (params: readonly unknown[]): Record<string, never> =>
	Object.fromEntries(params.map((value, index) => [`$${index + 1}`, value])) as never;

const must = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

const CLOUD = {
	id: "ws-cloud",
	url: "https://conducted.example.workers.dev",
	vmId: "vm-1",
} as const;

beforeEach(() => {
	store = openTestDatabase();
	store.raw.prepare(REPOS_SQL.insert).run(bind(repoToParams(sampleRepo)));
	nextId = 0;
	repositories = createRepositories(store.database, {
		clock: { now: () => 1000 },
		ids: { uuid: () => `cloud-13-${++nextId}` },
	});
});

afterEach(() => {
	store.close();
});

describe("CLOUD-13 migration 0010", () => {
	it("a session row stored without host columns reads back as local", async () => {
		store.raw.prepare(WORKSPACES_SQL.insert).run(bind(must(workspaceToParams(sampleWorkspace))));
		// The insert of a version before 0010: no host columns.
		store.raw
			.prepare(
				`INSERT INTO sessions (id, workspace_id, config, created_at, updated_at)
				VALUES ('chat-old', $1, $2, 1, 1)`,
			)
			.run(bind([sampleWorkspace.id, JSON.stringify(sessionConfig)]));

		const rows = await store.database.select<Parameters<typeof sessionFromRow>[0]>(
			SESSIONS_SQL.get,
			["chat-old"],
		);
		const session = sessionFromRow(rows[0] as Parameters<typeof sessionFromRow>[0]);

		expect(session.ok).toBe(true);
	});

	it("marks a session with its cloud workspace's host", async () => {
		const workspace = await repositories.workspaces.create({
			repoId: sampleRepo.id,
			directoryName: "lisbon",
			path: "/code/workspaces/lisbon",
			branch: "jahala/lisbon",
			branchIsPlaceholder: false,
			targetBranch: "origin/main",
			port: 55101,
			linkedPaths: [],
			setupLogPath: null,
			host: { kind: "cloud", url: CLOUD.url, vmId: CLOUD.vmId },
		});
		const created = await repositories.sessions.create({
			workspaceId: must(workspace).id,
			title: null,
			config: sessionConfig,
		});
		const sessionId = must(created).id;

		const rows = await store.database.select<{
			host_kind: string;
			host_url: string | null;
			host_vm_id: string | null;
		}>("SELECT host_kind, host_url, host_vm_id FROM sessions WHERE id = $1", [sessionId]);

		expect(rows).toEqual([{ host_kind: "cloud", host_url: CLOUD.url, host_vm_id: CLOUD.vmId }]);
	});

	it("refuses a session row whose host columns are half written", async () => {
		store.raw.prepare(WORKSPACES_SQL.insert).run(bind(must(workspaceToParams(sampleWorkspace))));

		expect(() =>
			store.raw
				.prepare(
					`INSERT INTO sessions (id, workspace_id, config, created_at, updated_at, host_kind)
					VALUES ('chat-half', $1, $2, 1, 1, 'cloud')`,
				)
				.run(bind([sampleWorkspace.id, JSON.stringify(sessionConfig)])),
		).toThrow(/CHECK constraint failed/);
	});
});
