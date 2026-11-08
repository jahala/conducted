// @vitest-environment node
/**
 * @feature WS-11 Backlog workspaces: add now, start later
 * Owns: the composition-root tests that a backlog draft outlives its removed project and gets a
 * project again through the real container's actions.
 * Behaviour: ui-map.md 3.9 (a saved workspace starts later; "No ready repository. Pick one to start
 * this workspace.").
 * Test first: removing a project keeps its backlog draft with no repository, and Start says to
 * pick one.
 */
import { describe, expect, it } from "vitest";
import { createTestContainer, seedRepo } from "../../test/container.ts";
import { sessionConfig } from "../db/test-fixtures.ts";
import { NO_READY_REPOSITORY_MESSAGE } from "../workspace-helpers.ts";
import { WorkspaceService } from "./workspace.ts";

describe("WS-11 a backlog draft outlives its project", () => {
	it("keeps the draft when its project is removed, refuses Start, and takes a new project", async () => {
		const test = createTestContainer();
		try {
			const removedRepo = await seedRepo(test.container, { name: "old" });
			const otherRepo = await seedRepo(test.container, { name: "new" });
			const actions = test.container.actions;
			const saved = await actions.workspaces.addToBacklog({
				repoId: removedRepo.id,
				from: { kind: "default" },
				prompt: "Finish the report",
				attachmentPaths: [],
				config: { ...sessionConfig },
				sectionId: null,
			});
			if (!saved.ok) throw new Error(saved.error.message);

			expect((await actions.projects.remove(removedRepo.id)).ok).toBe(true);

			const backlog = () => test.container.services.workspace.store.getState().backlogById;
			expect(backlog()[saved.value.id]).toMatchObject({
				repoId: null,
				prompt: "Finish the report",
			});
			const started = await actions.workspaces.startFromBacklog(saved.value.id);
			expect(started.ok).toBe(false);
			if (!started.ok) {
				expect(started.error.message).toBe(NO_READY_REPOSITORY_MESSAGE);
			}

			expect((await actions.workspaces.setBacklogRepo(saved.value.id, otherRepo.id)).ok).toBe(true);
			expect(backlog()[saved.value.id]?.repoId).toBe(otherRepo.id);
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("refuses a project that does not exist", async () => {
		const test = createTestContainer();
		try {
			const repo = await seedRepo(test.container);
			const saved = await test.container.actions.workspaces.addToBacklog({
				repoId: repo.id,
				from: { kind: "default" },
				prompt: "Later",
				attachmentPaths: [],
				config: { ...sessionConfig },
				sectionId: null,
			});
			if (!saved.ok) throw new Error(saved.error.message);

			const set = await test.container.actions.workspaces.setBacklogRepo(
				saved.value.id,
				"gone" as typeof repo.id,
			);

			expect(set.ok).toBe(false);
			if (!set.ok) expect(set.error.code).toBe("repo_unknown");
		} finally {
			await test.container.stop();
			test.close();
		}
	});
});
