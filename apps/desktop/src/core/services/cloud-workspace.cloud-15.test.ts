// @vitest-environment node
/**
 * @feature CLOUD-15 Cloud workspace header: status, resources, cost, restart
 * Tests the service behind the header over the real repository and the in-memory Platform: a
 * refresh reads the Worker's state and the workspace's recorded agent cost, a local workspace is
 * left alone, and a Worker failure is shown instead of being thrown.
 * Test first: a cloud workspace's state and cost are read into one view.
 */
import type { DatabaseSync } from "node:sqlite";
import { ok } from "@conducted/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cloudMemoryPlatform } from "../../test/memory-platform.ts";
import { openTestDatabase } from "../../test/sqlite.ts";
import { REPOS_SQL, repoToParams } from "../db/repos.ts";
import { createRepositories, type Repositories } from "../db/repositories.ts";
import { SESSIONS_SQL, sessionToParams } from "../db/sessions.ts";
import {
	agentEvent,
	sampleRepo,
	sampleSession,
	sampleWorkspace,
	sessionId,
} from "../db/test-fixtures.ts";
import { WORKSPACES_SQL, workspaceToParams } from "../db/workspaces.ts";
import { CloudWorkspaceService } from "./cloud-workspace.ts";

const bind = (params: readonly unknown[]): Record<string, never> =>
	Object.fromEntries(params.map((value, index) => [`$${index + 1}`, value])) as never;

const must = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

const cloudWorkspace = {
	...sampleWorkspace,
	host: { kind: "cloud" as const, url: "https://cloud.example.dev", vmId: "oslo" },
};

const GIB = 1024 ** 3;

let store: ReturnType<typeof openTestDatabase>;
let raw: DatabaseSync;
let repositories: Repositories;
let platform: ReturnType<typeof cloudMemoryPlatform>;
let service: CloudWorkspaceService;

beforeEach(() => {
	store = openTestDatabase();
	raw = store.raw;
	repositories = createRepositories(store.database, {
		clock: { now: () => 1000 },
		ids: { uuid: () => crypto.randomUUID() },
	});
	platform = cloudMemoryPlatform();
	service = new CloudWorkspaceService({
		platform: platform.platform,
		repos: repositories,
	});
	raw.prepare(REPOS_SQL.insert).run(bind(repoToParams(sampleRepo)));
	raw.prepare(WORKSPACES_SQL.insert).run(bind(must(workspaceToParams(cloudWorkspace))));
	raw.prepare(SESSIONS_SQL.insert).run(bind(must(sessionToParams(sampleSession))));
});

afterEach(() => {
	service.stop();
	store.close();
});

describe("CLOUD-15 the cloud workspace service", () => {
	it("reads a running workspace's status, meters and agent cost", async () => {
		must(
			await repositories.sessionEvents.append(
				sessionId,
				agentEvent("e1", "turn-1", 100, [
					{
						kind: "usage",
						inputTokens: 10,
						outputTokens: 5,
						cacheReadTokens: 0,
						cacheWriteTokens: 0,
						costUsd: 0.75,
					},
				]),
				100,
			),
		);
		platform.controls.scriptCloud((request) =>
			request.path.endsWith("/state")
				? ok({
						status: 200,
						body: JSON.stringify({
							running: true,
							resources: {
								cpu: { capacityCores: 0.25, usedPercent: 40 },
								memory: { totalBytes: GIB, usedPercent: 25 },
								disk: { totalBytes: 4 * GIB, availableBytes: GIB, usedPercent: 75 },
							},
						}),
					})
				: null,
		);
		await service.start();
		const refreshed = await service.refresh(cloudWorkspace.id);
		expect(refreshed.ok).toBe(true);
		const view = service.view(cloudWorkspace.id);
		expect(view.status).toBe("running");
		expect(view.resources.memory).toEqual({ totalBytes: GIB, usedPercent: 25 });
		expect(view.agentCostUsd).toBe(0.75);
		expect(view.error).toBeNull();
	});

	it("shows a Worker failure without throwing, and keeps the last status", async () => {
		await service.start();
		await service.refresh(cloudWorkspace.id);
		const view = service.view(cloudWorkspace.id);
		expect(view.status).toBe("unknown");
		expect(view.error).not.toBeNull();
	});

	it("makes no cloud call for a local workspace", async () => {
		raw
			.prepare("UPDATE workspaces SET host_kind = 'local', host_url = NULL, host_vm_id = NULL")
			.run();
		await service.start();
		await service.refresh(cloudWorkspace.id);
		expect(platform.controls.cloudRequests).toEqual([]);
		expect(service.view(cloudWorkspace.id).status).toBe("unknown");
	});

	it("starts with a view for every cloud workspace, and never for a local one", async () => {
		const local = must(
			await repositories.workspaces.create({
				repoId: sampleRepo.id,
				directoryName: "lisbon",
				path: "/code/workspaces/lisbon",
				branch: "jahala/lisbon",
				branchIsPlaceholder: false,
				remoteFileSyncEnabled: false,
				host: { kind: "local" },
				targetBranch: "origin/main",
				port: 55101,
				linkedPaths: [],
				setupLogPath: null,
			}),
		);
		await service.start();
		expect(service.view(cloudWorkspace.id).status).toBe("unknown");
		expect(service.view(local.id)).toEqual({
			status: "unknown",
			resources: { cpu: null, memory: null, disk: null },
			agentCostUsd: null,
			error: null,
		});
	});
});
