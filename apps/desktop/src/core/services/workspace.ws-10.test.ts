// @vitest-environment node
/**
 * @feature WS-10 Delete a workspace
 * Owns: deleting one workspace and every workspace of a repository.
 * Behaviour: services-map.md 2.3.1 (workspace delete) and 3.16 (archive refs).
 * Test first: removing a workspace deletes its worktree, archive ref, app data files, chats and row.
 */
import { appError, err, ok, type Result } from "@conducted/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryPlatform } from "../../platform/memory.ts";
import { FakeGitRunner, gitOutput } from "../../test/fake-git-runner.ts";
import { openTestDatabase } from "../../test/sqlite.ts";
import { setupLogFile, viewedFilesFile } from "../app-paths.ts";
import { createRepositories, type Repositories } from "../db/repositories.ts";
import type { Workspace } from "../model.ts";
import { WorkspaceService, type WorkspaceServiceDeps } from "./workspace.ts";

interface WorkspaceSpec {
	directoryName: string;
	path: string;
	branch: string;
	branchIsPlaceholder: boolean;
	targetBranch: string;
	port: number;
	linkedPaths: string[];
	state?: Workspace["state"];
	archiveCommit?: string | null;
}

const must = <T>(result: Result<T>): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

const sameArgs = (args: readonly string[], expected: readonly string[]): boolean =>
	args.length === expected.length && expected.every((arg, index) => args[index] === arg);

let openDatabase: ReturnType<typeof openTestDatabase> | null = null;

afterEach(() => {
	openDatabase?.close();
	openDatabase = null;
});

async function harness(
	options: { rows?: WorkspaceSpec[]; cancelFails?: boolean; stopFails?: boolean } = {},
) {
	const store = openTestDatabase();
	openDatabase = store;
	let nextId = 0;
	const repositories: Repositories = createRepositories(store.database, {
		clock: { now: () => 7000 },
		ids: { uuid: () => `id-${++nextId}` },
	});
	const memory = createMemoryPlatform({
		clock: { now: () => 7000 },
		ids: { uuid: () => `id-${++nextId}` },
		database: store.database,
	});
	const repo = must(
		await repositories.repos.create({
			name: "Project",
			rootPath: "/repo",
			remoteUrl: "git@github.com:me/project.git",
			defaultBranch: "main",
			icon: null,
			hidden: false,
		}),
	);

	const rows: Workspace[] = [];
	for (const spec of options.rows ?? [
		{
			directoryName: "oslo",
			path: "/worktrees/oslo",
			branch: "feature/oslo",
			branchIsPlaceholder: false,
			targetBranch: "main",
			port: 55_000,
			linkedPaths: [],
		},
	]) {
		const created = must(
			await repositories.workspaces.create({
				repoId: repo.id,
				directoryName: spec.directoryName,
				path: spec.path,
				branch: spec.branch,
				branchIsPlaceholder: spec.branchIsPlaceholder,
				remoteFileSyncEnabled: false,
				host: { kind: "local" },
				targetBranch: spec.targetBranch,
				port: spec.port,
				linkedPaths: spec.linkedPaths,
				setupLogPath: null,
			}),
		);
		must(await repositories.workspaces.transitionState(created.id, "initializing", "ready"));
		if (spec.state === "archived") {
			must(await repositories.workspaces.transitionState(created.id, "ready", "archiving"));
			must(await repositories.workspaces.markArchived(created.id, spec.archiveCommit ?? "sha-1"));
		}
		rows.push(must(await repositories.workspaces.get(created.id)) as Workspace);
	}

	const git = new FakeGitRunner((command) =>
		command.args[0] === "worktree" && command.args[1] === "remove"
			? gitOutput("", "", 0)
			: gitOutput(),
	);
	const cancelAll = vi.fn(async () =>
		options.cancelFails === true
			? err(appError("cancel_failed", "The chat could not be cancelled."))
			: ok(undefined),
	);
	const deleteAll = vi.fn(async () => ok(undefined));
	const stopWorkspace = vi.fn(async () =>
		options.stopFails === true
			? err(appError("run_stop_failed", "The process could not be stopped."))
			: ok(undefined),
	);
	const stopAllForRepository = vi.fn(
		async (_ids: readonly Workspace["id"][]): Promise<Result<void>> => ok(undefined),
	);
	const clearRuns = vi.fn();

	const deps: WorkspaceServiceDeps = {
		platform: memory.platform,
		git,
		repos: repositories,
		placeNames: { pick: () => "oslo" },
		sessions: {
			createFirstChat: vi.fn(),
			firstDraftOf: vi.fn(),
			cancelAll,
			hasWorkingChats: () => false,
			markAllRead: vi.fn(),
			deleteAll,
		},
		scripts: {
			runSetup: vi.fn(),
			runArchive: vi.fn(),
			stopWorkspace,
			stopAllForRepository,
			clearRuns,
		},
		checkpointerPath: "/res/bin/checkpointer.sh",
		repoConfig: async () => ok({} as never),
		setting: <T>(key: string) => (key === "conductor_root_path" ? "~/conducted" : undefined) as T,
		now: () => 7000,
	};

	const service = new WorkspaceService(deps);
	must(await service.start());

	return {
		service,
		memory,
		git,
		repositories,
		repo,
		rows,
		cancelAll,
		deleteAll,
		stopWorkspace,
		stopAllForRepository,
		clearRuns,
	};
}

const seedFolder = async (memory: ReturnType<typeof createMemoryPlatform>, path: string) => {
	await memory.platform.fs.writeTextAtomic(`${path}/README.md`, "hello");
};

describe("WS-10 delete a workspace", () => {
	it("removes the worktree, archive ref, app data files, chats and row", async () => {
		const h = await harness();
		const workspace = h.rows[0] as Workspace;
		await seedFolder(h.memory, workspace.path);
		await seedFolder(h.memory, h.repo.rootPath);
		const setupLog = setupLogFile(h.memory.platform.fs.paths, workspace.id);
		const viewed = viewedFilesFile(h.memory.platform.fs.paths, workspace.id);
		await h.memory.platform.fs.writeTextAtomic(setupLog, "{}");
		await h.memory.platform.fs.writeTextAtomic(viewed, "{}");

		const removed = await h.service.remove(workspace.id);

		expect(removed.ok).toBe(true);
		expect(h.cancelAll).toHaveBeenCalledWith(workspace.id);
		expect(h.stopWorkspace).toHaveBeenCalledWith(workspace.id);
		expect(
			h.git.commands.some((command) =>
				sameArgs(command.args, ["worktree", "remove", "--force", "--force", workspace.path]),
			),
		).toBe(true);
		expect(
			h.git.commands.some((command) =>
				sameArgs(command.args, ["update-ref", "-d", `refs/conducted/archive/${workspace.id}`]),
			),
		).toBe(true);
		expect(await h.memory.platform.fs.exists(setupLog)).toEqual(ok(false));
		expect(await h.memory.platform.fs.exists(viewed)).toEqual(ok(false));
		expect(h.deleteAll).toHaveBeenCalledWith(workspace.id);
		expect(must(await h.repositories.workspaces.get(workspace.id))).toBeNull();
		expect(h.clearRuns).toHaveBeenCalledWith(workspace.id);
		expect(h.service.store.getState().workspacesById[workspace.id]).toBeUndefined();
	});

	it("removes an archived workspace whose folder is already gone, including its archive ref", async () => {
		const h = await harness({
			rows: [
				{
					directoryName: "oslo",
					path: "/worktrees/oslo",
					branch: "feature/oslo",
					branchIsPlaceholder: false,
					targetBranch: "main",
					port: 55_000,
					linkedPaths: [],
					state: "archived",
					archiveCommit: "sha-1",
				},
			],
		});
		await seedFolder(h.memory, h.repo.rootPath);
		const workspace = h.rows[0] as Workspace;

		const removed = await h.service.remove(workspace.id);

		expect(removed.ok).toBe(true);
		expect(
			h.git.commands.some((command) =>
				sameArgs(command.args, ["worktree", "remove", "--force", "--force", workspace.path]),
			),
		).toBe(false);
		expect(
			h.git.commands.some((command) =>
				sameArgs(command.args, ["update-ref", "-d", `refs/conducted/archive/${workspace.id}`]),
			),
		).toBe(true);
		expect(must(await h.repositories.workspaces.get(workspace.id))).toBeNull();
	});

	it("keeps the workspace when its chats cannot be cancelled", async () => {
		const h = await harness({ cancelFails: true });
		const workspace = h.rows[0] as Workspace;

		const removed = await h.service.remove(workspace.id);

		expect(removed.ok).toBe(false);
		expect(h.stopWorkspace).not.toHaveBeenCalled();
		expect(h.deleteAll).not.toHaveBeenCalled();
		expect(must(await h.repositories.workspaces.get(workspace.id))).not.toBeNull();
		expect(h.service.store.getState().workspacesById[workspace.id]).toBeDefined();
	});

	it("keeps the workspace when its processes cannot be stopped", async () => {
		const h = await harness({ stopFails: true });
		const workspace = h.rows[0] as Workspace;

		const removed = await h.service.remove(workspace.id);

		expect(removed.ok).toBe(false);
		expect(h.deleteAll).not.toHaveBeenCalled();
		expect(must(await h.repositories.workspaces.get(workspace.id))).not.toBeNull();
	});

	it("does nothing for a workspace that is already gone", async () => {
		const h = await harness();

		const removed = await h.service.remove("missing" as Workspace["id"]);

		expect(removed.ok).toBe(true);
		expect(h.deleteAll).not.toHaveBeenCalled();
		expect(h.git.commands).toEqual([]);
	});
});

describe("WS-10 delete every workspace of a repository", () => {
	it("stops every workspace's processes and removes each one", async () => {
		const h = await harness({
			rows: [
				{
					directoryName: "one",
					path: "/worktrees/one",
					branch: "feature/one",
					branchIsPlaceholder: false,
					targetBranch: "main",
					port: 55_001,
					linkedPaths: [],
				},
				{
					directoryName: "two",
					path: "/worktrees/two",
					branch: "feature/two",
					branchIsPlaceholder: false,
					targetBranch: "main",
					port: 55_002,
					linkedPaths: [],
				},
			],
		});
		const ids = h.rows.map((workspace) => workspace.id);

		const removed = await h.service.removeWorkspacesOf(h.repo.id);

		expect(removed.ok).toBe(true);
		expect(h.stopAllForRepository).toHaveBeenCalledWith(ids);
		expect(h.stopWorkspace).not.toHaveBeenCalled();
		expect(must(await h.repositories.workspaces.listByRepo(h.repo.id))).toEqual([]);
		expect(h.service.store.getState().workspacesById).toEqual({});
	});

	it("removes nothing when one workspace's processes cannot be stopped", async () => {
		const h = await harness({
			rows: [
				{
					directoryName: "one",
					path: "/worktrees/one",
					branch: "feature/one",
					branchIsPlaceholder: false,
					targetBranch: "main",
					port: 55_001,
					linkedPaths: [],
				},
				{
					directoryName: "two",
					path: "/worktrees/two",
					branch: "feature/two",
					branchIsPlaceholder: false,
					targetBranch: "main",
					port: 55_002,
					linkedPaths: [],
				},
			],
		});
		h.stopAllForRepository.mockResolvedValueOnce(
			err(appError("run_stop_failed", "The process could not be stopped.")),
		);

		const removed = await h.service.removeWorkspacesOf(h.repo.id);

		expect(removed.ok).toBe(false);
		expect(h.deleteAll).not.toHaveBeenCalled();
		expect(must(await h.repositories.workspaces.listByRepo(h.repo.id))).toHaveLength(2);
	});
});
