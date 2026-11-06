/**
 * @feature REV-10 Workspace artifacts pages, uploads and the newest read
 * Owns: tests for the Artifacts part of WorkspaceFilesService: the pages read from `.context`,
 * appending the next page with the omitted total, copying an upload, refusing a name already in
 * `.context`, a failed copy, an artifact's absolute path, and dropping an older answer that
 * arrives late.
 * Behaviour: services-map.md 5A.5.1, 5A.6.2; docs/engineering.md "Only the newest answer changes state".
 * Test first: two overlapping first-page reads leave the newer workspace's files in the store.
 */
import { ok, type Result, type WorkspaceId } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import { createTestContainer, seedWorkspace, type TestContainer } from "../../test/container.ts";
import { FakeGitRunner, gitOutput } from "../../test/fake-git-runner.ts";
import { WorkspaceFilesService } from "./workspace-files.ts";

const workspaceId = "ws-artifacts" as WorkspaceId;
const root = "/code/workspaces/artifacts";

/** `cp` over the in-memory files, as the real `cp -p` copies one file. */
function scriptCopy(test: TestContainer): void {
	test.memory.controls.scriptShell((command) => {
		if (command.program !== "cp") return null;
		const [, source, target] = command.args;
		const contents = source === undefined ? undefined : test.memory.controls.files.get(source);
		if (contents === undefined || target === undefined) {
			return ok({ exitCode: 1, stdout: "", stderr: `cp: ${source}: No such file or directory` });
		}
		test.memory.controls.files.set(target, contents);
		return ok({ exitCode: 0, stdout: "", stderr: "" });
	});
}

function entriesOf(service: WorkspaceFilesService, id: WorkspaceId = workspaceId): string[] {
	return (service.artifactsStore.getState().byWorkspace[id]?.entries ?? []).map(
		(entry) => entry.path,
	);
}

describe("REV-10 workspace artifacts service", () => {
	it("lists the .context files with paths relative to that folder", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container, { path: root });
			test.memory.controls.files.set(`${root}/.context/notes.md`, "notes");
			test.memory.controls.files.set(`${root}/.context/plans/plan.md`, "plan");
			test.memory.controls.files.set(`${root}/README.md`, "outside");
			const service = test.container.services.workspaceFiles;

			const loaded = await service.loadArtifacts(workspace.id);

			expect(loaded.ok).toBe(true);
			expect(entriesOf(service, workspace.id).sort()).toEqual(["notes.md", "plans/plan.md"]);
		} finally {
			test.close();
		}
	});

	it("appends the next page and stops on the last one", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container, { path: root });
			for (let index = 0; index < 55; index++) {
				test.memory.controls.files.set(
					`${root}/.context/file-${String(index).padStart(3, "0")}.md`,
					String(index),
				);
			}
			const service = test.container.services.workspaceFiles;

			await service.loadArtifacts(workspace.id);
			const first = service.artifactsStore.getState().byWorkspace[workspace.id];
			expect(first?.entries.length).toBe(50);
			expect(first?.hasMore).toBe(true);

			const more = await service.loadMoreArtifacts(workspace.id);
			const second = service.artifactsStore.getState().byWorkspace[workspace.id];

			expect(more.ok).toBe(true);
			expect(second?.entries.length).toBe(55);
			expect(second?.hasMore).toBe(false);
			expect(second?.cursor).toBeNull();
		} finally {
			test.close();
		}
	});

	it("keeps the folder's omitted total when the next page arrives", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container, { path: root });
			for (let index = 0; index < 51; index++) {
				test.memory.controls.files.set(
					`${root}/.context/file-${String(index).padStart(3, "0")}.md`,
					String(index),
				);
			}
			test.memory.controls.files.set(`${root}/.context/todos.md`, "todos");
			test.memory.controls.files.set(`${root}/.context/conductor/settings.json`, "{}");
			const service = test.container.services.workspaceFiles;

			await service.loadArtifacts(workspace.id);
			const first = service.artifactsStore.getState().byWorkspace[workspace.id];
			expect(first?.hasMore).toBe(true);
			expect(first?.omitted).toBe(2);

			const more = await service.loadMoreArtifacts(workspace.id);
			const second = service.artifactsStore.getState().byWorkspace[workspace.id];

			expect(more.ok).toBe(true);
			expect(second?.entries.length).toBe(51);
			expect(second?.omitted).toBe(2);
		} finally {
			test.close();
		}
	});

	it("refuses an upload whose name is already in .context and copies the other files", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container, { path: root });
			test.memory.controls.files.set(`${root}/.context/report.md`, "the agent's report");
			test.memory.controls.files.set("/picked/report.md", "another report");
			test.memory.controls.files.set("/picked/photo.png", "image bytes");
			scriptCopy(test);
			const service = test.container.services.workspaceFiles;

			const uploaded = await service.uploadArtifacts(workspace.id, [
				"/picked/report.md",
				"/picked/photo.png",
			]);

			expect(uploaded.ok).toBe(false);
			if (!uploaded.ok) {
				expect(uploaded.error.code).toBe("artifact_exists");
				expect(uploaded.error.message).toContain('"report.md"');
			}
			expect(test.memory.controls.files.get(`${root}/.context/report.md`)).toBe(
				"the agent's report",
			);
			expect(test.memory.controls.files.get(`${root}/.context/photo.png`)).toBe("image bytes");
			expect(entriesOf(service, workspace.id).sort()).toEqual(["photo.png", "report.md"]);
		} finally {
			test.close();
		}
	});

	it("returns cp's message when a copy fails", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container, { path: root });
			scriptCopy(test);
			const service = test.container.services.workspaceFiles;

			const uploaded = await service.uploadArtifacts(workspace.id, ["/picked/gone.png"]);

			expect(uploaded.ok).toBe(false);
			if (!uploaded.ok) {
				expect(uploaded.error.code).toBe("artifact_copy_failed");
				expect(uploaded.error.message).toBe(
					'Could not copy "gone.png": cp: /picked/gone.png: No such file or directory',
				);
			}
		} finally {
			test.close();
		}
	});

	it("gives an artifact's absolute path and refuses one that climbs out", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container, { path: `${root}/` });
			const service = test.container.services.workspaceFiles;

			expect(await service.artifactPath(workspace.id, "plans/plan.md")).toEqual(
				ok(`${root}/.context/plans/plan.md`),
			);
			const outside = await service.artifactPath(workspace.id, "../secret.txt");
			expect(outside.ok).toBe(false);
		} finally {
			test.close();
		}
	});

	it("copies uploaded files into .context and lists them", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container, { path: root });
			test.memory.controls.files.set("/picked/photo.png", "image bytes");
			test.memory.controls.scriptShell((command) => {
				if (command.program !== "cp") return null;
				const [, source, target] = command.args;
				const contents = source === undefined ? undefined : test.memory.controls.files.get(source);
				if (contents === undefined || target === undefined) {
					return ok({ exitCode: 1, stdout: "", stderr: "missing source" });
				}
				test.memory.controls.files.set(target, contents);
				return ok({ exitCode: 0, stdout: "", stderr: "" });
			});
			const service = test.container.services.workspaceFiles;

			const uploaded = await service.uploadArtifacts(workspace.id, ["/picked/photo.png"]);

			expect(uploaded.ok).toBe(true);
			expect(test.memory.controls.files.get(`${root}/.context/photo.png`)).toBe("image bytes");
			expect(entriesOf(service, workspace.id)).toEqual(["photo.png"]);
		} finally {
			test.close();
		}
	});

	it("keeps only the newest first-page read when two overlap", async () => {
		const test = createTestContainer();
		try {
			test.memory.controls.files.set(`${root}-old/.context/old.md`, "old");
			test.memory.controls.files.set(`${root}-new/.context/new.md`, "new");
			let releaseOld: () => void = () => {};
			const oldRoot = new Promise<Result<string[]>>((resolve) => {
				releaseOld = () => resolve(ok([`${root}-old`]));
			});
			let calls = 0;
			const service = new WorkspaceFilesService({
				fs: test.memory.platform.fs,
				search: test.memory.platform.fileSearch,
				shell: test.memory.platform.shell,
				git: new FakeGitRunner(() => gitOutput()),
				opener: test.memory.platform.opener,
				rootsOf: async () => {
					calls += 1;
					return calls === 1 ? oldRoot : ok([`${root}-new`]);
				},
			});

			const older = service.loadArtifacts(workspaceId);
			const newer = service.loadArtifacts(workspaceId);
			await newer;
			expect(entriesOf(service)).toEqual(["new.md"]);

			releaseOld();
			await older;
			expect(entriesOf(service)).toEqual(["new.md"]);
		} finally {
			test.close();
		}
	});
});
