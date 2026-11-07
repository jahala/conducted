// @vitest-environment node
/**
 * @feature CLOUD-13 Local copy of cloud data, kept apart by host
 * Owns: the composition-root proof that a cloud workspace's rows are a local copy reached
 * through its workspace's host: the cloud workspace still appears in the merged list, local
 * startup work never touches its folder, and its chat leaves with a host sweep.
 * Behaviour: services-map.md 1.2 (the host picks the record's database) and 2.6.2 (the local copy
 * of everything that belongs to a remote host). Our design choice: one database (D103).
 * Must handle: a cloud workspace's folder is not registered with the local file commands, while
 * both hosts still fill the workspace store; the chat a cloud workspace holds is written through
 * the real container and is removed with that host's workspaces.
 * Test first: local startup registers only the local workspace folders.
 */
import type { Host, SessionConfig } from "@conducted/protocol";
import { describe, expect, it } from "vitest";
import { createTestContainer, seedWorkspace } from "../test/container.ts";
import { createRepositories } from "./db/repositories.ts";

const CONFIG: SessionConfig = {
	agent: "claude",
	model: "default",
	effort: "high",
	fastMode: false,
	planMode: false,
	requireToolApproval: false,
	additionalDirectories: [],
	appTools: { diffComments: true, progressUpdates: true, setTargetBranch: true },
};

const CLOUD: Host = {
	kind: "cloud",
	url: "https://conducted.example.workers.dev",
	vmId: "vm-1",
};

const must = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

describe("CLOUD-13 the cloud copy in the real container", () => {
	it("local startup registers only the local workspace folders", async () => {
		const test = createTestContainer();
		try {
			const local = await seedWorkspace(test.container, { host: { kind: "local" } });
			const cloud = await seedWorkspace(test.container, { host: CLOUD });

			const roots = test.memory.controls.registeredRoots;
			expect(roots).toContain(local.path);
			expect(roots).not.toContain(cloud.path);
			// The merged list still holds both hosts, with their own values.
			const held = test.container.services.workspace.store.getState().workspacesById;
			expect(held[local.id]?.host).toEqual({ kind: "local" });
			expect(held[cloud.id]?.host).toEqual(CLOUD);
		} finally {
			test.container.services.repo.dispose();
			test.close();
		}
	});

	it("a chat made on a cloud workspace leaves with that host's sweep", async () => {
		const test = createTestContainer();
		try {
			const cloud = await seedWorkspace(test.container, { host: CLOUD });
			const session = must(await test.container.services.sessions.create(cloud.id, CONFIG));
			const repositories = createRepositories(test.database, {
				clock: { now: () => 1_700_000_000_000 },
				ids: { uuid: () => crypto.randomUUID() },
			});

			const held = must(await repositories.workspaces.get(cloud.id));
			expect(held?.host).toEqual(CLOUD);
			expect(
				must(await repositories.sessions.listByWorkspace(cloud.id, { includeClosed: true })).map(
					(row) => row.id,
				),
			).toEqual([session.id]);

			must(await repositories.hostCopy.remove(CLOUD));

			const rows = await test.database.select<{ total: number }>(
				"SELECT COUNT(*) AS total FROM sessions WHERE id = $1",
				[session.id],
			);
			expect(rows[0]?.total).toBe(0);
		} finally {
			test.container.services.repo.dispose();
			test.close();
		}
	});
});
