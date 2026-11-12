/**
 * @feature WS-10 Delete a workspace
 * @feature SET-04 Environment variables, stored in the Keychain
 * Owns: the real composition root's delete paths, reached through the app's actions, including the
 * Keychain entries of a removed project's environment variables.
 * Behaviour: services-map.md 2.3.1 (workspace delete) and 3.5 (removing a repository).
 * Test first: removing a workspace through the container deletes its chat, attachment file and row.
 */
import { appError, err, ok } from "@conducted/shared";
import { describe, expect, it, vi } from "vitest";
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
			memory.controls.addFile(attachmentPath, "hello");
			const viewed = viewedFilesFile(memory.platform.fs.paths, workspace.id);
			const setupLog = setupLogFile(memory.platform.fs.paths, workspace.id);
			memory.controls.addFile(viewed, "{}");
			memory.controls.addFile(setupLog, "log");

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
			memory.controls.addFile(`${store}/runs.sqlite`, "runs");
			memory.controls.addFile(`${otherStore}/runs.sqlite`, "runs");

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

	it("removing a project removes its environment variables' Keychain entries (SET-04)", async () => {
		const { container, memory, close } = createTestContainer();
		try {
			const repo = await seedRepo(container);
			const settings = container.services.settings;
			must(await settings.setEnvVar("PROJECT_TOKEN", "project-secret", { repoId: repo.id }));
			must(await settings.setEnvVar("SHARED_TOKEN", "shared-secret", "global"));
			const repoKey = `env:repo:${repo.id}:PROJECT_TOKEN`;
			expect(await memory.platform.keychain.get(repoKey)).toEqual(ok("project-secret"));

			must(await container.actions.projects.remove(repo.id));

			expect(await memory.platform.keychain.get(repoKey)).toEqual(ok(null));
			// A global variable belongs to every project, so removing one keeps its secret.
			expect(await memory.platform.keychain.get("env:global:SHARED_TOKEN")).toEqual(
				ok("shared-secret"),
			);
		} finally {
			close();
		}
	});

	it("keeps a project and reports the error when a variable's Keychain entry cannot be removed", async () => {
		const { container, memory, close } = createTestContainer();
		let deny: { mockRestore(): void } | undefined;
		try {
			const repo = await seedRepo(container);
			must(
				await container.services.settings.setEnvVar("PROJECT_TOKEN", "project-secret", {
					repoId: repo.id,
				}),
			);
			const repoKey = `env:repo:${repo.id}:PROJECT_TOKEN`;
			// seam: SET-04 the Keychain is an outside world; this one entry's delete must fail.
			deny = vi
				.spyOn(memory.platform.keychain, "delete")
				.mockImplementation(async (ref) =>
					ref === repoKey ? err(appError("keychain_denied", "Access was denied.")) : ok(undefined),
				);

			const removed = await container.actions.projects.remove(repo.id);

			expect(removed.ok).toBe(false);
			expect(await memory.platform.keychain.get(repoKey)).toEqual(ok("project-secret"));
			expect(container.services.repo.store.getState().reposById[repo.id]).toBeDefined();
		} finally {
			deny?.mockRestore();
			close();
		}
	});
});
