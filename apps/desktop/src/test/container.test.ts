// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Services } from "../core/container.ts";
import { sessionConfig } from "../core/db/test-fixtures.ts";
import { createTestContainer, seedRepo, seedWorkspace } from "./container.ts";

const SERVICE_NAMES: readonly (keyof Services)[] = [
	"settings",
	"repo",
	"workspace",
	"sections",
	"favoriteModels",
	"agentCatalog",
	"mcp",
	"linear",
	"git",
	"github",
	"localGitForge",
	"checkpoint",
	"fileDiff",
	"workspaceFiles",
	"review",
	"sessions",
	"followUpQueue",
	"composer",
	"runScripts",
	"spotlight",
	"ports",
	"terminals",
	"notifications",
	"updates",
	"system",
	"commands",
];

describe("test container", () => {
	it("builds every service without starting the container", () => {
		const test = createTestContainer();
		try {
			for (const name of SERVICE_NAMES) expect(test.container.services[name]).toBeDefined();
			expect(test.container.services.repo.store.getState().loaded).toBe(false);
		} finally {
			test.close();
		}
	});

	it("seedRepo makes a project visible through the repo store", async () => {
		const test = createTestContainer();
		try {
			const repo = await seedRepo(test.container, {
				name: "Conducted",
				rootPath: "/code/conducted",
			});

			const state = test.container.services.repo.store.getState();
			expect(state.loaded).toBe(true);
			expect(state.reposById[repo.id]).toEqual(repo);
			expect(state.order).toContain(repo.id);
		} finally {
			test.close();
		}
	});

	it("seedWorkspace makes a workspace visible through the workspace store", async () => {
		const test = createTestContainer();
		try {
			const repo = await seedRepo(test.container);
			const workspace = await seedWorkspace(test.container, {
				repoId: repo.id,
				directoryName: "lisbon",
				path: "/code/workspaces/lisbon",
			});

			const state = test.container.services.workspace.store.getState();
			expect(state.loaded).toBe(true);
			expect(state.workspacesById[workspace.id]).toEqual(workspace);
		} finally {
			test.close();
		}
	});

	it("hands out a new id on every call", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container);
			const first = await test.container.services.sessions.create(workspace.id, sessionConfig);
			const second = await test.container.services.sessions.create(workspace.id, sessionConfig);
			if (!first.ok || !second.ok) throw new Error("could not create a session");
			expect(first.value.id).not.toBe(second.value.id);
		} finally {
			test.close();
		}
	});
});
