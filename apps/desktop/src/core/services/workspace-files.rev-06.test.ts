import { appError, err, ok, type WorkspaceId } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import { createTestContainer } from "../../test/container.ts";
import { FakeGitRunner, gitOutput } from "../../test/fake-git-runner.ts";
import { WorkspaceFilesService } from "./workspace-files.ts";

const workspaceId = "ws-1" as WorkspaceId;
const root = "/code/workspaces/ws-1";
const unusedGit = () => new FakeGitRunner(() => gitOutput());

function serviceFor(test: ReturnType<typeof createTestContainer>) {
	return new WorkspaceFilesService({
		fs: test.memory.platform.fs,
		search: test.memory.platform.fileSearch,
		shell: test.memory.platform.shell,
		git: unusedGit(),
		opener: test.memory.platform.opener,
		searchOn: async () => ok(undefined),
		rootsOf: async () => ok([root]),
		searchRootOf: async () => ok(root),
		hostKindOf: () => "local",
		cloudOpen: async () => ok({ path: root, downloaded: false }),
	});
}

describe("REV-06 workspace files service", () => {
	it("lists the workspace tree with paths relative to its root", async () => {
		const test = createTestContainer();
		try {
			test.memory.controls.files.set(`${root}/src/a.ts`, "export const a = 1;");
			test.memory.controls.files.set(`${root}/README.md`, "# Read me");
			const result = await serviceFor(test).tree(workspaceId);
			expect(result).toEqual({
				ok: true,
				value: [
					{ path: "README.md", isDirectory: false },
					{ path: "src", isDirectory: true },
					{ path: "src/a.ts", isDirectory: false },
				],
			});
		} finally {
			test.close();
		}
	});

	it("finds files for quick open and returns them relative to the root", async () => {
		const test = createTestContainer();
		try {
			test.memory.controls.files.set(`${root}/src/app.ts`, "");
			test.memory.controls.files.set(`${root}/README.md`, "");
			const service = serviceFor(test);
			expect(await service.quickOpen(workspaceId, "read", 10)).toEqual({
				ok: true,
				value: [{ path: "README.md", isDirectory: false }],
			});
			expect(await service.quickOpen(workspaceId, "  ", 10)).toEqual({ ok: true, value: [] });
		} finally {
			test.close();
		}
	});

	it("refuses to read a path outside the workspace", async () => {
		const test = createTestContainer();
		try {
			const result = await serviceFor(test).readFile(workspaceId, "../outside");
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.error.code).toBe("path_outside_workspace");
			const absolute = await serviceFor(test).readFile(workspaceId, "/etc/passwd");
			expect(absolute.ok).toBe(false);
			if (!absolute.ok) expect(absolute.error.code).toBe("path_outside_workspace");
		} finally {
			test.close();
		}
	});

	it("reads a file and saves it only while its modified time still matches", async () => {
		const test = createTestContainer();
		try {
			test.memory.controls.files.set(`${root}/note.md`, "first");
			const service = serviceFor(test);
			const read = await service.readFile(workspaceId, "note.md");
			expect(read).toEqual({ ok: true, value: { text: "first", modifiedAt: 0 } });
			if (!read.ok) return;

			const saved = await service.saveFile(workspaceId, "note.md", "second", read.value.modifiedAt);
			expect(saved.ok).toBe(true);
			expect(await service.readFile(workspaceId, "note.md")).toEqual({
				ok: true,
				value: { text: "second", modifiedAt: 1_700_000_000_000 },
			});

			const stale = await service.saveFile(workspaceId, "note.md", "third", 1);
			expect(stale.ok).toBe(false);
			if (!stale.ok) expect(stale.error.code).toBe("changed_on_disk");
		} finally {
			test.close();
		}
	});

	it("reports a workspace with no folder the same way for the tree, quick open and search", async () => {
		const test = createTestContainer();
		try {
			const service = new WorkspaceFilesService({
				fs: test.memory.platform.fs,
				search: test.memory.platform.fileSearch,
				shell: test.memory.platform.shell,
				git: unusedGit(),
				opener: test.memory.platform.opener,
				searchOn: async () => ok(undefined),
				rootsOf: async () => ok([]),
				searchRootOf: async () =>
					err(appError("workspace_path_missing", "That workspace has no folder on this Mac.")),
				hostKindOf: () => "local",
				cloudOpen: async () => ok({ path: root, downloaded: false }),
			});
			const tree = await service.tree(workspaceId);
			const quickOpen = await service.quickOpen(workspaceId, "readme", 10);
			const grep = await service.grep(workspaceId, "retry", {
				caseSensitive: false,
				wholeWord: false,
				regex: false,
			});
			expect(tree.ok ? null : tree.error.code).toBe("workspace_path_missing");
			expect(quickOpen.ok ? null : quickOpen.error.code).toBe("workspace_path_missing");
			expect(grep.ok ? null : grep.error.code).toBe("workspace_path_missing");
		} finally {
			test.close();
		}
	});
});
