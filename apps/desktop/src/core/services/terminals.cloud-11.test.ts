/**
 * @feature CLOUD-11 Local mirror and file sync for a cloud workspace
 * Owns: a Mac terminal in a cloud workspace. The scripts panel's Local terminal opens a PTY on
 * this Mac in the workspace's mirror, as Conductor does; without a mirror it is refused with
 * "Local terminal unavailable" (D111, D120).
 * Test first: a local terminal in a cloud workspace starts in the mirror folder on this Mac.
 */
import type { Host } from "@conducted/protocol";
import { ok, type WorkspaceId } from "@conducted/shared";
import { afterEach, describe, expect, it } from "vitest";
import {
	createTestContainer,
	seedRepo,
	seedWorkspace,
	type TestContainer,
} from "../../test/container.ts";

const CLOUD: Host = { kind: "cloud", url: "https://w.example.dev", vmId: "vm-1" };

const containers: TestContainer[] = [];

afterEach(() => {
	for (const test of containers.splice(0)) test.close();
});

async function cloudWorkspace(test: TestContainer): Promise<WorkspaceId> {
	const repo = await seedRepo(test.container);
	const workspace = await seedWorkspace(test.container, {
		repoId: repo.id,
		path: "/workspace/oslo",
		host: CLOUD,
	});
	await test.database.execute("UPDATE workspaces SET state = 'ready' WHERE id = $1", [
		workspace.id,
	]);
	return workspace.id;
}

describe("CLOUD-11 a local terminal in a cloud workspace", () => {
	it("starts the PTY on this Mac in the mirror folder", async () => {
		const test = createTestContainer();
		containers.push(test);
		const workspaceId = await cloudWorkspace(test);
		// The sync lists an empty workspace, which creates the mirror folder on this Mac.
		test.memory.controls.scriptCloud((request) =>
			request.path === "/w/vm-1/files"
				? ok({ status: 200, body: JSON.stringify({ entries: [], truncated: false }) })
				: null,
		);
		const terminals = test.container.services.terminals;
		const mirror = test.container.services.cloudFileSync.mirrorPathOf(workspaceId);
		if (!mirror.ok) throw new Error(mirror.error.message);

		const created = await terminals.create(workspaceId, { hostKind: "local" });

		expect(created.ok).toBe(true);
		expect(test.memory.controls.ptySpawns).toHaveLength(1);
		expect(test.memory.controls.ptySpawns[0]?.cwd).toBe(mirror.value);
		expect(terminals.store.getState().byWorkspace[workspaceId]?.[0]).toMatchObject({
			cwd: mirror.value,
			hostKind: "local",
		});
	});

	it("refuses with Local terminal unavailable when the mirror folder is gone", async () => {
		const test = createTestContainer();
		containers.push(test);
		const workspaceId = await cloudWorkspace(test);

		const created = await test.container.services.terminals.create(workspaceId, {
			hostKind: "local",
		});

		expect(created).toMatchObject({
			ok: false,
			error: { code: "run_local_mirror_unavailable", message: "Local terminal unavailable" },
		});
		expect(test.memory.controls.ptySpawns).toHaveLength(0);
	});
});
