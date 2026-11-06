/**
 * @feature REV-08 File tab wiring
 * Tests the service call that opens a file and the content read that backs the viewer, over the
 * real container and its in-memory file system.
 */
import { describe, expect, it, vi } from "vitest";
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

	it("reveals a workspace file in Finder through the action, and refuses a path outside", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container, { path: "/code/workspaces/reveal" });
			test.memory.controls.files.set(`${workspace.path}/src/a.ts`, "export {};");
			const reveal = vi.spyOn(test.container.platform.opener, "revealInFinder");

			expect(await test.container.actions.files.reveal(workspace.id, "src/a.ts")).toEqual({
				ok: true,
				value: undefined,
			});
			expect(reveal).toHaveBeenCalledWith(`${workspace.path}/src/a.ts`);

			const outside = await test.container.actions.files.reveal(workspace.id, "../other/a.ts");
			expect(outside.ok).toBe(false);
			expect(reveal).toHaveBeenCalledTimes(1);
		} finally {
			test.close();
		}
	});

	it("returns Finder's refusal as an error instead of throwing", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container, { path: "/code/workspaces/refused" });
			vi.spyOn(test.container.platform.opener, "revealInFinder").mockRejectedValue(
				new Error("Finder is not responding"),
			);
			const revealed = await test.container.actions.files.reveal(workspace.id, "a.ts");
			expect(revealed.ok).toBe(false);
			if (!revealed.ok) expect(revealed.error.code).toBe("reveal_failed");
		} finally {
			test.close();
		}
	});

	it("opens a workspace file in the app the Open in menu chose", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container, { path: "/code/workspaces/open-in" });
			test.memory.controls.files.set(`${workspace.path}/clip.mov`, "video");
			const openWith = vi.spyOn(test.container.platform.opener, "openWith");

			expect(
				await test.container.actions.files.openInApp(workspace.id, "clip.mov", "Cursor"),
			).toEqual({
				ok: true,
				value: undefined,
			});
			expect(openWith).toHaveBeenCalledWith("Cursor", `${workspace.path}/clip.mov`);
		} finally {
			test.close();
		}
	});

	it("opens nothing for a path outside the workspace", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container, { path: "/code/workspaces/no-app" });
			const openWith = vi.spyOn(test.container.platform.opener, "openWith");

			const opened = await test.container.actions.files.openInApp(
				workspace.id,
				"../other/clip.mov",
				"Cursor",
			);

			expect(opened.ok).toBe(false);
			if (!opened.ok) expect(opened.error.code).not.toBe("open_in_no_default_app");
			expect(openWith).not.toHaveBeenCalled();
		} finally {
			test.close();
		}
	});
});
