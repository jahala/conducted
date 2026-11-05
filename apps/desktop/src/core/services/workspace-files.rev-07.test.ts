/**
 * @feature REV-07 Quick open and search in files
 * Owns: tests for the workspace file service's fuzzy quick open and content grep.
 * Behaviour: services-map.md 5A.5.1 (fuzzy_filter_files, grep_workspace), 5A.5.1 rule (minimum 2
 * characters, case, whole word, regex and pattern errors).
 * Test first: Typing 'appshell' lists 'src/app/AppShell.tsx'; a one-character query lists nothing.
 */
import { describe, expect, it } from "vitest";
import { createTestContainer, seedWorkspace } from "../../test/container.ts";

async function setup() {
	const test = createTestContainer();
	const workspace = await seedWorkspace(test.container, { path: "/code/workspaces/rev-07" });
	const files = test.memory.controls.files;
	files.set(`${workspace.path}/src/app/AppShell.tsx`, "export function AppShell() {}\n");
	files.set(`${workspace.path}/src/retry.ts`, "retry now\nretrying later\nRetry again\n");
	files.set(`${workspace.path}/src/other.ts`, "const answer = 42;\n");
	return { test, workspace };
}

describe("REV-07 WorkspaceFilesService.quickOpen", () => {
	it("lists a file by part of its name, relative to the workspace", async () => {
		const { test, workspace } = await setup();
		try {
			const result = await test.container.services.workspaceFiles.quickOpen(
				workspace.id,
				"appshell",
				50,
			);
			if (!result.ok) throw new Error(result.error.message);
			expect(result.value.map((entry) => entry.path)).toContain("src/app/AppShell.tsx");
		} finally {
			test.close();
		}
	});

	it("returns nothing for a query shorter than two characters", async () => {
		const { test, workspace } = await setup();
		try {
			const result = await test.container.services.workspaceFiles.quickOpen(workspace.id, "a", 50);
			expect(result).toEqual({ ok: true, value: [] });
		} finally {
			test.close();
		}
	});

	it("keeps the limit it is given", async () => {
		const { test, workspace } = await setup();
		try {
			const result = await test.container.services.workspaceFiles.quickOpen(workspace.id, "ts", 1);
			if (!result.ok) throw new Error(result.error.message);
			expect(result.value).toHaveLength(1);
		} finally {
			test.close();
		}
	});
});

describe("REV-07 WorkspaceFilesService.grep", () => {
	it("finds every line with the text", async () => {
		const { test, workspace } = await setup();
		try {
			const result = await test.container.services.workspaceFiles.grep(workspace.id, "retry", {
				caseSensitive: false,
				wholeWord: false,
				regex: false,
			});
			if (!result.ok) throw new Error(result.error.message);
			expect(result.value).toHaveLength(3);
			expect(result.value[0]).toMatchObject({ path: "src/retry.ts", line: 1 });
		} finally {
			test.close();
		}
	});

	it("removes a longer word when Whole word is on", async () => {
		const { test, workspace } = await setup();
		try {
			const result = await test.container.services.workspaceFiles.grep(workspace.id, "retry", {
				caseSensitive: false,
				wholeWord: true,
				regex: false,
			});
			if (!result.ok) throw new Error(result.error.message);
			expect(result.value.map((match) => match.preview)).toEqual(["retry now", "Retry again"]);
		} finally {
			test.close();
		}
	});

	it("respects Match case", async () => {
		const { test, workspace } = await setup();
		try {
			const result = await test.container.services.workspaceFiles.grep(workspace.id, "Retry", {
				caseSensitive: true,
				wholeWord: false,
				regex: false,
			});
			if (!result.ok) throw new Error(result.error.message);
			expect(result.value.map((match) => match.line)).toEqual([3]);
		} finally {
			test.close();
		}
	});

	it("treats the query as a regular expression when asked", async () => {
		const { test, workspace } = await setup();
		try {
			const result = await test.container.services.workspaceFiles.grep(
				workspace.id,
				"retry|answer",
				{ caseSensitive: true, wholeWord: false, regex: true },
			);
			if (!result.ok) throw new Error(result.error.message);
			expect(result.value.length).toBeGreaterThanOrEqual(3);
			expect(result.value.some((match) => match.path === "src/other.ts")).toBe(true);
		} finally {
			test.close();
		}
	});

	it("returns the pattern error for an invalid regular expression", async () => {
		const { test, workspace } = await setup();
		try {
			const result = await test.container.services.workspaceFiles.grep(workspace.id, "([a", {
				caseSensitive: true,
				wholeWord: false,
				regex: true,
			});
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.error.message).toContain("Invalid pattern");
		} finally {
			test.close();
		}
	});

	it("returns nothing for a query shorter than two characters", async () => {
		const { test, workspace } = await setup();
		try {
			const result = await test.container.services.workspaceFiles.grep(workspace.id, "r", {
				caseSensitive: true,
				wholeWord: false,
				regex: false,
			});
			expect(result).toEqual({ ok: true, value: [] });
		} finally {
			test.close();
		}
	});
});
