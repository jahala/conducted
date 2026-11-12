// @vitest-environment node
/**
 * @feature CLOUD-01 Host interface: each workspace reaches git, shell, files, terminals and its sidecar through a local or cloud host
 * Tests migration 0009 and the workspace row codec: a workspace stored without host columns is
 * local, a cloud workspace keeps its Worker URL and sandbox id, and a half-written cloud row is an
 * error instead of a local workspace.
 * Test first: a workspace row written before migration 0009 reads back as local.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openTestDatabase } from "../../test/sqlite.ts";
import { REPOS_SQL, repoToParams } from "./repos.ts";
import { createRepositories, type Repositories } from "./repositories.ts";
import { sampleRepo, type sampleWorkspace } from "./test-fixtures.ts";
import { hostFromRow } from "./workspaces.ts";

let store: ReturnType<typeof openTestDatabase>;
let repositories: Repositories;
let nextId: number;

/** node:sqlite binds `$1..$n` by name, so a positional list becomes `{ $1: ... }`. */
const bind = (params: readonly unknown[]): Record<string, never> =>
	Object.fromEntries(params.map((value, index) => [`$${index + 1}`, value])) as never;

beforeEach(() => {
	store = openTestDatabase();
	store.raw.prepare(REPOS_SQL.insert).run(bind(repoToParams(sampleRepo)));
	nextId = 0;
	repositories = createRepositories(store.database, {
		clock: { now: () => 1000 },
		ids: { uuid: () => `ws-new-${++nextId}` },
	});
});

afterEach(() => {
	store.close();
});

describe("CLOUD-01 migration 0009", () => {
	it("a workspace row written before migration 0009 reads back as local", async () => {
		// The insert of every version before 0009: no host columns.
		store.raw
			.prepare(
				`INSERT INTO workspaces (id, repo_id, directory_name, path, branch, target_branch, state,
					port, last_activity_at, created_at, updated_at)
				VALUES ('ws-old', $1, 'oslo', '/code/oslo', 'jahala/oslo', 'origin/main', 'ready',
					55000, 1, 1, 1)`,
			)
			.run(bind([sampleRepo.id]));

		const read = await repositories.workspaces.get("ws-old" as typeof sampleWorkspace.id);

		expect(read.ok && read.value?.host).toEqual({ kind: "local" });
	});

	it("keeps a cloud workspace's Worker URL and sandbox id", async () => {
		const host = {
			kind: "cloud",
			url: "https://conducted.example.workers.dev",
			vmId: "vm-1",
		} as const;
		const created = await repositories.workspaces.create({
			repoId: sampleRepo.id,
			directoryName: "lisbon",
			path: "/code/workspaces/lisbon",
			branch: "jahala/lisbon",
			branchIsPlaceholder: false,
			targetBranch: "origin/main",
			port: 55101,
			linkedPaths: [],
			setupLogPath: null,
			remoteFileSyncEnabled: false,
			host,
		});
		if (!created.ok) throw new Error(created.error.message);

		const read = await repositories.workspaces.get(created.value.id);

		expect(read.ok && read.value?.host).toEqual(host);
	});

	it("refuses a host kind other than local or cloud", () => {
		expect(() =>
			store.raw
				.prepare(
					`INSERT INTO workspaces (id, repo_id, directory_name, path, branch, target_branch, state,
						port, last_activity_at, created_at, updated_at, host_kind)
					VALUES ('ws-odd', $1, 'oslo', '/code/oslo', 'jahala/oslo', 'origin/main', 'ready',
						55000, 1, 1, 1, 'ssh')`,
				)
				.run(bind([sampleRepo.id])),
		).toThrow(/CHECK constraint failed/);
	});

	it("reads a half-written cloud row as an error, never as local", () => {
		const half = {
			host_kind: "cloud",
			host_url: "https://w.example.dev",
			host_vm_id: null,
		} as const;
		const read = hostFromRow(half);
		expect(read.ok).toBe(false);
		expect(read.ok ? null : read.error.code).toBe("db.invalid_host");
		expect(
			hostFromRow({ host_kind: "local", host_url: "https://w.example.dev", host_vm_id: null }).ok,
		).toBe(false);
	});
});
