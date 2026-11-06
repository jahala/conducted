/**
 * @feature REV-08 File tab wiring
 * Tests the service call that opens a file and the content read that backs the viewer, over the
 * real container and its in-memory file system.
 */
import { describe, expect, it } from "vitest";
import { createTestContainer, seedWorkspace } from "../../test/container.ts";

describe("REV-08 WorkspaceFilesService open and read", () => {
	it("sends an open request to the mounted workspace screen", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container, { path: "/code/workspaces/open" });
			const requests: unknown[] = [];
			const stop = test.container.services.workspaceFiles.onOpen((request) => {
				requests.push(request);
			});
			const opened = await test.container.services.workspaceFiles.open(
				workspace.id,
				"src/a.ts",
				"edit",
				{ kind: "branch" },
			);
			expect(opened.ok).toBe(true);
			expect(requests).toEqual([
				{
					workspaceId: workspace.id,
					path: "src/a.ts",
					mode: "edit",
					scope: { kind: "branch" },
				},
			]);
			stop();
		} finally {
			test.close();
		}
	});

	it("reports an error when no workspace screen listens", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container, { path: "/code/workspaces/none" });
			const opened = await test.container.services.workspaceFiles.open(
				workspace.id,
				"a.ts",
				"diff",
				{ kind: "branch" },
			);
			expect(opened.ok).toBe(false);
			if (!opened.ok) expect(opened.error.code).toBe("file_open_unavailable");
		} finally {
			test.close();
		}
	});

	it("reads text and reports a missing file", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container, { path: "/code/workspaces/read" });
			test.memory.controls.files.set(`${workspace.path}/notes.md`, "# Hello");
			const content = await test.container.services.workspaceFiles.readContent(
				workspace.id,
				"notes.md",
			);
			expect(content).toEqual({
				ok: true,
				value: { kind: "text", text: "# Hello", modifiedAt: 0, sizeBytes: 7 },
			});
			const missing = await test.container.services.workspaceFiles.readContent(
				workspace.id,
				"gone.md",
			);
			expect(missing).toEqual({ ok: true, value: { kind: "missing" } });
		} finally {
			test.close();
		}
	});
});
