/**
 * @feature REV-11 Resolve conflicts inline: current, incoming or both
 * Owns: tests for the workspace files service's conflict resolution: the current, incoming and
 * both choices, the diff3 base marker, malformed markers and a choice count that does not match,
 * and the `git add` after a save leaves no markers.
 * Behaviour: inventory-controls.md "Resolve merge conflict hunks inline" and
 * inventory-messages-sidecar.md "Merge conflicts in the editor".
 * Test first: one "current" choice replaces the conflict's markers with the current side and
 * stages the file.
 */
import { ok } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import { createTestContainer, seedWorkspace } from "../../test/container.ts";

const conflict = (current: string, incoming: string): string =>
	`<<<<<<< HEAD\n${current}\n=======\n${incoming}\n>>>>>>> feature\n`;

async function setup(text: string) {
	const test = createTestContainer();
	const workspace = await seedWorkspace(test.container, {
		path: "/code/workspaces/conflicts",
	});
	const absolute = `${workspace.path}/a.ts`;
	test.memory.controls.files.set(absolute, text);
	const gitCalls: string[] = [];
	test.memory.controls.scriptShell((command) => {
		if (command.program !== "git") return null;
		gitCalls.push(command.args.join(" "));
		return ok({ stdout: "", stderr: "", exitCode: 0 });
	});
	return {
		test,
		workspace,
		absolute,
		gitCalls,
		service: test.container.services.workspaceFiles,
	};
}

describe("REV-11 WorkspaceFilesService conflict resolution", () => {
	it("replaces a conflict with the current side and stages the file", async () => {
		const { test, workspace, absolute, gitCalls, service } = await setup(
			conflict("ours", "theirs"),
		);
		try {
			const result = await service.resolveConflicts(workspace.id, "a.ts", ["current"]);

			expect(result).toEqual(ok(undefined));
			expect(test.memory.controls.files.get(absolute)).toBe("ours\n");
			expect(gitCalls.some((call) => call.includes("add"))).toBe(true);
			expect(gitCalls.some((call) => call.includes("a.ts"))).toBe(true);
		} finally {
			test.close();
		}
	});

	it("keeps both sides for one conflict and the incoming side for the next", async () => {
		const text = [
			"first line",
			"<<<<<<< HEAD",
			"ours",
			"=======",
			"theirs",
			">>>>>>> feature",
			"middle",
			"<<<<<<< HEAD",
			"left",
			"=======",
			"right",
			">>>>>>> feature",
			"last line",
		].join("\n");
		const { test, workspace, absolute, service } = await setup(text);
		try {
			const result = await service.resolveConflicts(workspace.id, "a.ts", ["both", "incoming"]);

			expect(result).toEqual(ok(undefined));
			expect(test.memory.controls.files.get(absolute)).toBe(
				["first line", "ours", "theirs", "middle", "right", "last line"].join("\n"),
			);
		} finally {
			test.close();
		}
	});

	it("drops the diff3 base section and applies the chosen side", async () => {
		const text = [
			"<<<<<<< HEAD",
			"ours",
			"||||||| base",
			"base",
			"=======",
			"theirs",
			">>>>>>> feature",
		].join("\n");
		const { test, workspace, absolute, service } = await setup(text);
		try {
			const result = await service.resolveConflicts(workspace.id, "a.ts", ["both"]);

			expect(result).toEqual(ok(undefined));
			expect(test.memory.controls.files.get(absolute)).toBe("ours\ntheirs");
		} finally {
			test.close();
		}
	});

	it("refuses malformed markers without changing the file or staging it", async () => {
		const text = "<<<<<<< HEAD\nours\n>>>>>>> feature\n";
		const { test, workspace, absolute, gitCalls, service } = await setup(text);
		try {
			const result = await service.resolveConflicts(workspace.id, "a.ts", ["current"]);

			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.error.code).toBe("conflict_markers_malformed");
			expect(test.memory.controls.files.get(absolute)).toBe(text);
			expect(gitCalls).toEqual([]);
		} finally {
			test.close();
		}
	});

	it("refuses a choice count that does not match the file, without writing", async () => {
		const text = `${conflict("one", "two")}${conflict("three", "four")}`;
		const { test, workspace, absolute, gitCalls, service } = await setup(text);
		try {
			const result = await service.resolveConflicts(workspace.id, "a.ts", ["both"]);

			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.error.code).toBe("conflict_choice_count");
			expect(test.memory.controls.files.get(absolute)).toBe(text);
			expect(gitCalls).toEqual([]);
		} finally {
			test.close();
		}
	});

	it("refuses a file with no conflict markers, so an unrelated file is not staged", async () => {
		const { test, workspace, absolute, gitCalls, service } = await setup("plain text");
		try {
			const result = await service.resolveConflicts(workspace.id, "a.ts", []);

			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.error.code).toBe("conflict_markers_missing");
			expect(test.memory.controls.files.get(absolute)).toBe("plain text");
			expect(gitCalls).toEqual([]);
		} finally {
			test.close();
		}
	});
});
