// @vitest-environment node
/**
 * @feature CLOUD-10 Port forwarding from a cloud workspace to the Mac
 * Tests migration 0014 and the port-forward repository: a workspace starts with forwarding off,
 * local ports are unique on the machine, a remote port is unique per workspace, and stale rows are
 * removed at startup.
 * Test first: a second row with the same local port is refused.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openTestDatabase } from "../../test/sqlite.ts";
import { REPOS_SQL, repoToParams } from "./repos.ts";
import { createRepositories, type Repositories } from "./repositories.ts";
import { sampleRepo } from "./test-fixtures.ts";

let store: ReturnType<typeof openTestDatabase>;
let repositories: Repositories;

beforeEach(() => {
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
		ids: { uuid: () => `pf-${Math.random().toString(36).slice(2)}` },
	});
});

afterEach(() => {
	store.close();
});

async function workspace(id: string) {
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
		host: { kind: "cloud", url: "https://worker.example.dev", vmId: id },
	});
	if (!created.ok) throw new Error(created.error.message);
	return created.value;
}

describe("CLOUD-10 migration 0014", () => {
	it("a workspace starts with both forwarding switches off", async () => {
		const ws = await workspace("oslo");
		const flags = await repositories.portForwards.flags(ws.id);
		expect(flags.ok && flags.value).toEqual({
			forwardingEnabled: false,
			autoForwardEnabled: false,
		});
	});

	it("saves and reads the two switches", async () => {
		const ws = await workspace("oslo");
		await repositories.portForwards.setForwardingEnabled(ws.id, true);
		await repositories.portForwards.setAutoForwardEnabled(ws.id, true);
		const flags = await repositories.portForwards.flags(ws.id);
		expect(flags.ok && flags.value).toEqual({
			forwardingEnabled: true,
			autoForwardEnabled: true,
		});
	});

	it("keeps the local port unique across the machine", async () => {
		const oslo = await workspace("oslo");
		const lisbon = await workspace("lisbon");
		const first = await repositories.portForwards.add({
			workspaceId: oslo.id,
			remotePort: 3000,
			localPort: 20_000,
			label: null,
			autoDetected: false,
			enabled: true,
		});
		expect(first.ok).toBe(true);
		const second = await repositories.portForwards.add({
			workspaceId: lisbon.id,
			remotePort: 3000,
			localPort: 20_000,
			label: null,
			autoDetected: false,
			enabled: true,
		});
		expect(second.ok).toBe(false);
	});

	it("keeps one row per remote port in a workspace", async () => {
		const ws = await workspace("oslo");
		await repositories.portForwards.add({
			workspaceId: ws.id,
			remotePort: 3000,
			localPort: 20_000,
			label: null,
			autoDetected: false,
			enabled: true,
		});
		const again = await repositories.portForwards.add({
			workspaceId: ws.id,
			remotePort: 3000,
			localPort: 20_001,
			label: null,
			autoDetected: false,
			enabled: true,
		});
		expect(again.ok).toBe(false);
	});

	it("removes rows of archived workspaces and keeps live ones", async () => {
		const oslo = await workspace("oslo");
		const lisbon = await workspace("lisbon");
		await repositories.portForwards.add({
			workspaceId: oslo.id,
			remotePort: 3000,
			localPort: 20_000,
			label: null,
			autoDetected: false,
			enabled: true,
		});
		await repositories.portForwards.add({
			workspaceId: lisbon.id,
			remotePort: 3000,
			localPort: 20_001,
			label: null,
			autoDetected: false,
			enabled: true,
		});
		store.raw.prepare("UPDATE workspaces SET state = 'archived' WHERE id = ?").run(oslo.id);

		const cleaned = await repositories.portForwards.removeArchivedOrMissing();

		expect(cleaned.ok).toBe(true);
		const all = await repositories.portForwards.listAll();
		expect(all.ok && all.value.map((forward) => forward.workspaceId)).toEqual([lisbon.id]);
	});

	it("removes a workspace's rows with the workspace", async () => {
		const ws = await workspace("oslo");
		await repositories.portForwards.add({
			workspaceId: ws.id,
			remotePort: 3000,
			localPort: 20_000,
			label: null,
			autoDetected: false,
			enabled: true,
		});
		store.raw.prepare("DELETE FROM workspaces WHERE id = ?").run(ws.id);
		const all = await repositories.portForwards.listAll();
		expect(all.ok && all.value).toEqual([]);
	});
});
