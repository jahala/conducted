/**
 * @feature WS-07 Linked workspaces and extra folders
 * Owns: tests of the workspace service's linked paths: what is stored, what is refused, and that
 * the loaded row and the agents' allowed roots see the new list.
 * Behaviour: services-map.md 2.2 and 2.3.1 (link workspaces and directories), ui-map.md 3.10.
 * Test first: saving a folder stores its absolute path on the workspace and in the loaded row.
 */
import type { SessionConfig } from "@conducted/protocol";
import type { WorkspaceId } from "@conducted/shared";
import { afterEach, describe, expect, it } from "vitest";
import { createTestContainer, seedWorkspace, type TestContainer } from "../../test/container.ts";
import { normaliseLinkedPaths } from "./workspace.ts";

const CONFIG: SessionConfig = {
	agent: "claude",
	model: "claude-sonnet-4-5",
	effort: "high",
	fastMode: false,
	planMode: false,
	requireToolApproval: false,
	additionalDirectories: [],
	appTools: { diffComments: true, progressUpdates: true, setTargetBranch: true },
};

let active: TestContainer | undefined;

afterEach(() => {
	active?.close();
	active = undefined;
});

const linkedPathsInDatabase = async (test: TestContainer, id: string): Promise<string> => {
	const rows = await test.database.select<{ linked_paths: string }>(
		"SELECT linked_paths FROM workspaces WHERE id = $1",
		[id],
	);
	return rows[0]?.linked_paths ?? "";
};

describe("WS-07 linked paths", () => {
	it("stores a folder on the workspace and the loaded row, and hands it to the agents", async () => {
		const test = createTestContainer();
		active = test;
		const workspace = await seedWorkspace(test.container);

		const saved = await test.container.actions.workspaces.setLinkedPaths(workspace.id, [
			"/code/shared",
		]);

		expect(saved.ok).toBe(true);
		expect(JSON.parse(await linkedPathsInDatabase(test, workspace.id))).toEqual(["/code/shared"]);
		expect(
			test.container.services.workspace.store.getState().workspacesById[workspace.id]?.linkedPaths,
		).toEqual(["/code/shared"]);
		const roots = test.container.lookups.allowedRoots(workspace.id);
		expect(roots.ok).toBe(true);
		if (!roots.ok) return;
		expect(roots.value).toEqual([workspace.path, "/code/shared"]);
	});

	it("puts the folders in every open chat's config for its next message", async () => {
		const test = createTestContainer();
		active = test;
		const workspace = await seedWorkspace(test.container);
		const created = await test.container.services.sessions.create(workspace.id, CONFIG);
		if (!created.ok) throw new Error(created.error.message);

		await test.container.actions.workspaces.setLinkedPaths(workspace.id, ["/code/shared"]);

		expect(
			test.container.services.sessions.store.getState().sessions[created.value.id]?.config
				.additionalDirectories,
		).toEqual(["/code/shared"]);
		const rows = await test.database.select<{ config: string }>(
			"SELECT config FROM sessions WHERE id = $1",
			[created.value.id],
		);
		expect(JSON.parse(rows[0]?.config ?? "{}").additionalDirectories).toEqual(["/code/shared"]);
	});

	it("stores a linked workspace as its folder path", async () => {
		const test = createTestContainer();
		active = test;
		const workspace = await seedWorkspace(test.container);
		const other = await seedWorkspace(test.container, { repoId: workspace.repoId });

		const saved = await test.container.actions.workspaces.setLinkedPaths(workspace.id, [
			other.path,
		]);

		expect(saved.ok).toBe(true);
		expect(JSON.parse(await linkedPathsInDatabase(test, workspace.id))).toEqual([other.path]);
	});

	it("drops empty entries and duplicates, and removes a trailing slash", async () => {
		const test = createTestContainer();
		active = test;
		const workspace = await seedWorkspace(test.container);

		await test.container.actions.workspaces.setLinkedPaths(workspace.id, [
			" /code/shared/ ",
			"",
			"/code/shared",
			"/code/other/",
		]);

		expect(JSON.parse(await linkedPathsInDatabase(test, workspace.id))).toEqual([
			"/code/shared",
			"/code/other",
		]);
	});

	it("refuses a relative path and changes nothing", async () => {
		const test = createTestContainer();
		active = test;
		const workspace = await seedWorkspace(test.container, { linkedPaths: ["/code/kept"] });

		const saved = await test.container.actions.workspaces.setLinkedPaths(workspace.id, [
			"not/absolute",
		]);

		expect(saved.ok).toBe(false);
		if (saved.ok) return;
		expect(saved.error.code).toBe("linked_path_invalid");
		expect(JSON.parse(await linkedPathsInDatabase(test, workspace.id))).toEqual(["/code/kept"]);
	});

	it("refuses an unknown workspace", async () => {
		const test = createTestContainer();
		active = test;

		const saved = await test.container.actions.workspaces.setLinkedPaths("missing" as WorkspaceId, [
			"/code/shared",
		]);

		expect(saved.ok).toBe(false);
		if (saved.ok) return;
		expect(saved.error.code).toBe("workspace_unknown");
	});

	it("cleans one list the same way the dialog and the service do", () => {
		const cleaned = normaliseLinkedPaths([" /a/ ", "/a", "/"]);

		expect(cleaned.ok).toBe(true);
		if (!cleaned.ok) return;
		expect(cleaned.value).toEqual(["/a", "/"]);
	});
});
