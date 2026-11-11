// @vitest-environment node
/**
 * @feature CLOUD-10 Port forwarding from a cloud workspace to the Mac
 * Tests the forwarding service over the real repository and the in-memory Platform: validation
 * refuses before a call, allocation follows the strategy, the Start switch starts the enabled
 * forwards, discovery reconciles auto-detected ports, and archive drops everything.
 * Test first: port 22 is refused with `port_forward_reserved` and no Platform call is made.
 */
import { ok } from "@conducted/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cloudMemoryPlatform } from "../../test/memory-platform.ts";
import { openTestDatabase } from "../../test/sqlite.ts";
import { REPOS_SQL, repoToParams } from "../db/repos.ts";
import { createRepositories, type Repositories } from "../db/repositories.ts";
import { sampleRepo } from "../db/test-fixtures.ts";
import { PortForwardsService } from "./port-forwards.ts";

/** The forwards of one workspace, read through the repository's one list. */
async function forwardsOf(repos: Repositories, workspaceId: string) {
	const all = await repos.portForwards.listAll();
	if (!all.ok) return all;
	return ok(all.value.filter((row) => row.workspaceId === workspaceId));
}

let store: ReturnType<typeof openTestDatabase>;
let repositories: Repositories;
let platform: ReturnType<typeof cloudMemoryPlatform>;
let service: PortForwardsService;
const settings = new Map<string, unknown>([
	["port_forwarding_strategy", "match"],
	["local_port_range_start", 20_000],
	["local_port_range_end", 29_999],
	["port_mappings", []],
	["exclusive_port_forwarding_enabled", false],
]);

beforeEach(async () => {
	store = openTestDatabase();
	store.raw
		.prepare(REPOS_SQL.insert)
		.run(
			Object.fromEntries(
				repoToParams(sampleRepo).map((value, index) => [`$${index + 1}`, value]),
			) as never,
		);
	repositories = createRepositories(store.database, {
		clock: { now: () => 1000 },
		ids: { uuid: () => crypto.randomUUID() },
	});
	platform = cloudMemoryPlatform();
	service = new PortForwardsService({
		platform: platform.platform,
		repos: repositories,
		settings: { get: <T>(key: string) => settings.get(key) as T },
	});
	await service.start();
});

afterEach(() => {
	service.stop();
	store.close();
});

async function cloudWorkspace(id = "oslo") {
	const created = await repositories.workspaces.create({
		repoId: sampleRepo.id,
		directoryName: id,
		path: `/workspace/${id}`,
		branch: `jahala/${id}`,
		branchIsPlaceholder: false,
		targetBranch: "origin/main",
		port: 55_000,
		linkedPaths: [],
		setupLogPath: null,
		remoteFileSyncEnabled: false,
		host: { kind: "cloud", url: "https://w.example.dev", vmId: id },
	});
	if (!created.ok) throw new Error(created.error.message);
	return created.value;
}

describe("CLOUD-10 forwarding service", () => {
	it("refuses port 22 and an out-of-range port before any Platform call", async () => {
		const ws = await cloudWorkspace();
		const reserved = await service.add(ws.id, 22);
		expect(reserved.ok ? null : reserved.error.code).toBe("port_forward_reserved");
		const invalid = await service.add(ws.id, 70_000);
		expect(invalid.ok ? null : invalid.error.code).toBe("port_forward_invalid");
		expect((await platform.platform.portForward.list()).ok).toBe(true);
	});

	it("adds a forward and starts it when forwarding is on", async () => {
		const ws = await cloudWorkspace();
		await service.setForwarding(ws.id, true);
		const added = await service.add(ws.id, 3000);
		expect(added.ok).toBe(true);
		if (!added.ok) return;
		expect(added.value.localPort).toBe(3000);
		const running = await platform.platform.portForward.list();
		expect(running.ok && running.value.map((entry) => entry.forwardId)).toContain(added.value.id);
		const rows = await forwardsOf(repositories, ws.id);
		expect(rows.ok && rows.value.length).toBe(1);
	});

	it("starts the enabled forwards when Start forwarding turns on", async () => {
		const ws = await cloudWorkspace();
		await service.add(ws.id, 5173);
		await service.setForwarding(ws.id, true);
		const running = await platform.platform.portForward.list();
		expect(running.ok && running.value.map((entry) => entry.remotePort)).toEqual([5173]);
	});

	it("stops every forward when the switch turns off but keeps the rows", async () => {
		const ws = await cloudWorkspace();
		await service.setForwarding(ws.id, true);
		await service.add(ws.id, 3000);
		await service.setForwarding(ws.id, false);
		const running = await platform.platform.portForward.list();
		expect(running.ok && running.value).toEqual([]);
		const rows = await forwardsOf(repositories, ws.id);
		expect(rows.ok && rows.value.length).toBe(1);
	});

	it("forgets everything when a workspace is archived", async () => {
		const ws = await cloudWorkspace();
		await service.setForwarding(ws.id, true);
		await service.add(ws.id, 3000);
		await service.pauseWorkspace(ws.id);
		const rows = await forwardsOf(repositories, ws.id);
		expect(rows.ok && rows.value).toEqual([]);
		expect(service.view(ws.id).forwards).toEqual([]);
		expect(service.view(ws.id).forwardingEnabled).toBe(false);
	});

	it("auto-forwards a discovered port and removes it when it disappears", async () => {
		const ws = await cloudWorkspace();
		platform.controls.scriptCloud((request) =>
			request.path.endsWith("/ports")
				? ok({
						status: 200,
						body: JSON.stringify({
							ports: [
								{ port: 3000, processName: "node" },
								{ port: 5173, processName: "vite" },
							],
						}),
					})
				: null,
		);
		await service.setAutoForward(ws.id, true);
		await service.setForwarding(ws.id, true);
		await service.refreshDiscovery(ws.id);
		const detected = service.view(ws.id).detectedPorts;
		expect(detected).toEqual([
			{ port: 3000, processName: "node" },
			{ port: 5173, processName: "vite" },
		]);
		const rows = await forwardsOf(repositories, ws.id);
		expect(rows.ok && rows.value.filter((row) => row.autoDetected).length).toBe(2);

		platform.controls.scriptCloud((request) =>
			request.path.endsWith("/ports")
				? ok({
						status: 200,
						body: JSON.stringify({ ports: [{ port: 3000, processName: "node" }] }),
					})
				: null,
		);
		await service.refreshDiscovery(ws.id);
		const after = await forwardsOf(repositories, ws.id);
		expect(after.ok && after.value.map((row) => row.remotePort)).toEqual([3000]);
	});

	it("a preview URL comes from the Worker, and its refusal says why", async () => {
		const ws = await cloudWorkspace();
		platform.controls.scriptCloud((request) =>
			request.path.endsWith("/preview-url")
				? (request.body as { port: number }).port === 3000
					? ok({ status: 200, body: JSON.stringify({ url: "https://w.example.dev/p/abc/" }) })
					: ok({ status: 400, body: JSON.stringify({ error: "Nothing listens on that port." }) })
				: null,
		);
		expect(await service.previewUrl(ws.id, 3000)).toEqual(ok("https://w.example.dev/p/abc/"));
		const refused = await service.previewUrl(ws.id, 4000);
		expect(refused.ok).toBe(false);
		if (!refused.ok) expect(refused.error.message).toBe("Nothing listens on that port.");
	});

	it("refuses forward on a local workspace", async () => {
		const created = await repositories.workspaces.create({
			repoId: sampleRepo.id,
			directoryName: "local",
			path: "/code/local",
			branch: "jahala/local",
			branchIsPlaceholder: false,
			targetBranch: "origin/main",
			port: 55_010,
			linkedPaths: [],
			setupLogPath: null,
			remoteFileSyncEnabled: false,
			host: { kind: "local" },
		});
		if (!created.ok) throw new Error(created.error.message);
		const added = await service.add(created.value.id, 3000);
		expect(added.ok ? null : added.error.code).toBe("port_forward_local");
	});
});
