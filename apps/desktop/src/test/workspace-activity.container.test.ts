// @vitest-environment node
/**
 * @feature NAV-03 Sidebar grouping, filtering and sorting
 * Owns: the composition-root test that a stored user message moves its workspace's recent
 * activity forward, in the database and in the store, and so changes the sidebar's order.
 * Behaviour: services-map.md 2.3.1 "touch activity" and the sessions store watch Conductor runs
 * (main bundle @1054957, @1054147); ui-map.md 4 (the main list sorts by last activity).
 * Test first: before the wire, a message leaves the workspace at its creation time and the list
 * keeps its old order.
 */
import { LOCAL_HOST } from "@conducted/protocol";
import type { WorkspaceId } from "@conducted/shared";
import { describe, expect, it, vi } from "vitest";
import { createRepositories } from "../core/db/repositories.ts";
import { sessionConfig, userMessageEvent } from "../core/db/test-fixtures.ts";
import {
	buildSidebarGroups,
	orderedWorkspaceIds,
	type SidebarView,
} from "../features/sidebar/sidebar-view.ts";
import { createTestContainer } from "./container.ts";

const must = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

describe("a workspace's recent activity moves forward", () => {
	it("moves the store and the database when a user message is stored, and reorders the sidebar", async () => {
		let now = 1_000;
		const clock = { now: () => now };
		const test = createTestContainer({ clock });
		let seeded = 0;
		const repositories = createRepositories(test.database, {
			clock,
			ids: { uuid: () => `seed-${++seeded}` },
		});
		try {
			must(await test.container.services.settings.start());
			const repo = must(
				await repositories.repos.create({
					name: "project",
					rootPath: "/code/project",
					remoteUrl: null,
					defaultBranch: "main",
					icon: null,
				}),
			);
			now = 1_000;
			const older = must(
				await repositories.workspaces.create({
					repoId: repo.id,
					directoryName: "older",
					path: "/code/workspaces/older",
					branch: "jahala/older",
					branchIsPlaceholder: true,
					targetBranch: "origin/main",
					port: 55_101,
					linkedPaths: [],
					setupLogPath: null,
					remoteFileSyncEnabled: false,
					host: LOCAL_HOST,
				}),
			);
			now = 2_000;
			const newer = must(
				await repositories.workspaces.create({
					repoId: repo.id,
					directoryName: "newer",
					path: "/code/workspaces/newer",
					branch: "jahala/newer",
					branchIsPlaceholder: true,
					targetBranch: "origin/main",
					port: 55_102,
					linkedPaths: [],
					setupLogPath: null,
					remoteFileSyncEnabled: false,
					host: LOCAL_HOST,
				}),
			);
			const session = must(
				await repositories.sessions.create({
					workspaceId: older.id,
					title: null,
					config: sessionConfig,
				}),
			);
			must(await test.container.services.workspace.start());
			must(await test.container.services.sessions.start());
			must(await test.container.sidecar.start());

			const view: SidebarView = {
				groupBy: "project",
				sortBy: "updated",
				manualOrder: false,
				projectFilter: [],
			};
			const order = (): WorkspaceId[] =>
				orderedWorkspaceIds(
					buildSidebarGroups({
						repos: [repo],
						workspaces: Object.values(
							test.container.services.workspace.store.getState().workspacesById,
						),
						sections: [],
						view,
						manualOrder: new Map<string, WorkspaceId[]>(),
					}),
				);
			expect(order()).toEqual([newer.id, older.id]);

			now = 5_000;
			test.memory.controls.emitSidecarLine(
				JSON.stringify({
					jsonrpc: "2.0",
					method: "sessionEvent",
					params: {
						sessionId: session.id,
						sequence: 0,
						event: userMessageEvent("event-1", "turn-1", 5_000),
					},
				}),
			);

			await vi.waitFor(async () => {
				const stored = must(await repositories.workspaces.get(older.id));
				expect(stored?.lastActivityAt).toBe(5_000);
			});
			expect(
				test.container.services.workspace.store.getState().workspacesById[older.id]?.lastActivityAt,
			).toBe(5_000);
			expect(order()).toEqual([older.id, newer.id]);
		} finally {
			await test.container.stop();
			test.close();
		}
	});
});
