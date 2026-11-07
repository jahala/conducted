/**
 * @feature WS-10 Delete a workspace
 * Owns: the real composition root's delete paths, reached through the app's actions.
 * Behaviour: services-map.md 2.3.1 (workspace delete) and 3.5 (removing a repository).
 * Test first: removing a workspace through the container deletes its chat, attachment file and row.
 */
import { describe, expect, it } from "vitest";
import { createTestContainer, seedRepo, seedWorkspace } from "../test/container.ts";
import { cursorStoreFolder, setupLogFile, viewedFilesFile } from "./app-paths.ts";
import { createRepositories } from "./db/repositories.ts";
import { sessionConfig } from "./db/test-fixtures.ts";

const must = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

describe("WS-10 delete a workspace through the container", () => {
	it("removes the workspace, its chats, its attachment file and its app data files", async () => {
		const { container, memory, close } = createTestContainer();
		try {
			const repo = await seedRepo(container);
			const workspace = await seedWorkspace(container, {
				repoId: repo.id,
				path: "/code/workspaces/delete-me",
			});
			const chat = must(await container.services.sessions.create(workspace.id, sessionConfig));
			const repositories = createRepositories(container.platform.db, {
				clock: { now: () => 1000 },
				ids: { uuid: () => crypto.randomUUID() },
			});
			const attachmentPath = "/app/draft-attachments/one/a.txt";
			must(
				await repositories.attachments.addDraft({
					sessionId: chat.id,
					kind: "file",
					originalName: "a.txt",
					path: attachmentPath,
					commentId: null,
				}),
			);
			await memory.platform.fs.writeTextAtomic(attachmentPath, "hello");
			const viewed = viewedFilesFile(memory.platform.fs.paths, workspace.id);
			const setupLog = setupLogFile(memory.platform.fs.paths, workspace.id);
			await memory.platform.fs.writeTextAtomic(viewed, "{}");
			await memory.platform.fs.writeTextAtomic(setupLog, "log");

			const removed = await container.actions.workspaces.remove(workspace.id);

			expect(removed.ok).toBe(true);
			expect(
				container.services.workspace.store.getState().workspacesById[workspace.id],
			).toBeUndefined();
			expect(container.services.sessions.store.getState().sessions[chat.id]).toBeUndefined();
			expect(await memory.platform.fs.exists(attachmentPath)).toBe(false);
			expect(await memory.platform.fs.exists(viewed)).toBe(false);
			expect(await memory.platform.fs.exists(setupLog)).toBe(false);

			must(await container.services.workspace.start());
			expect(container.services.workspace.store.getState().workspacesById).toEqual({});
			must(await container.services.sessions.start());
			expect(container.services.sessions.store.getState().sessions).toEqual({});
		} finally {
			close();
		}
	});

	it("moves the workspace's Cursor run store to the Trash and keeps another workspace's", async () => {
		const { container, memory, close } = createTestContainer();
		try {
			const repo = await seedRepo(container);
			const workspace = await seedWorkspace(container, {
				repoId: repo.id,
				path: "/code/workspaces/oslo",
			});
			const other = await seedWorkspace(container, {
				repoId: repo.id,
				path: "/code/workspaces/bergen",
			});
			const paths = memory.platform.fs.paths;
			// The folder name is the sidecar's rule (cursor-runner.ts cursorStoreFolder): the first 16
			// hex digits of the SHA-256 of the workspace path. The sidecar's test checks the same value.
			const store = `${paths.appData}/cursor-sdk-store/7b65ddb1510ad78c`;
			expect(await cursorStoreFolder(paths, workspace.path)).toBe(store);
			const otherStore = await cursorStoreFolder(paths, other.path);
			await memory.platform.fs.writeTextAtomic(`${store}/runs.sqlite`, "runs");
			await memory.platform.fs.writeTextAtomic(`${otherStore}/runs.sqlite`, "runs");

			expect((await container.actions.workspaces.remove(workspace.id)).ok).toBe(true);

			expect(await memory.platform.fs.exists(store)).toBe(false);
			expect(await memory.platform.fs.exists(`${otherStore}/runs.sqlite`)).toBe(true);
		} finally {
			close();
		}
	});

	it("removing a project removes its workspaces and chats", async () => {
		const { container, close } = createTestContainer();
		try {
			const repo = await seedRepo(container);
			const workspace = await seedWorkspace(container, {
				repoId: repo.id,
				path: "/code/workspaces/in-a-project",
			});
			const chat = must(await container.services.sessions.create(workspace.id, sessionConfig));

			const removed = await container.actions.projects.remove(repo.id);

			expect(removed.ok).toBe(true);
			expect(container.services.repo.store.getState().reposById[repo.id]).toBeUndefined();
			expect(
				container.services.workspace.store.getState().workspacesById[workspace.id],
			).toBeUndefined();
			expect(container.services.sessions.store.getState().sessions[chat.id]).toBeUndefined();

			must(await container.services.repo.start());
			must(await container.services.workspace.start());
			must(await container.services.sessions.start());
			expect(container.services.repo.store.getState().reposById).toEqual({});
			expect(container.services.workspace.store.getState().workspacesById).toEqual({});
			expect(container.services.sessions.store.getState().sessions).toEqual({});
		} finally {
			close();
		}
	});
});
