/**
 * @feature PLAT-28 Agent program manager: the sidecar finds the managed copies
 * Owns: the contract test of the managed-program stand-ins in test-support. A laid-out copy is read
 * by the real finder the composition root builds, so the stand-in cannot drift from the app's copy.
 * Test first: "a laid-out copy is found by the real finder with its version".
 */
import { describe, expect, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	createManagedProgramFinder,
	nodeManagedProgramFiles,
} from "../runners/managed-programs.ts";
import {
	layOutManagedPrograms,
	MANAGED_TEST_VERSION,
	managedProgramFinder,
} from "./managed-programs.ts";

describe("PLAT-28 the managed-program stand-ins", () => {
	test("a laid-out copy is found by the real finder with its version", async () => {
		const folder = await mkdtemp(path.join(tmpdir(), "conducted-managed-"));
		try {
			const { binDir, agentBinariesDir } = await layOutManagedPrograms(folder, ["claude"]);
			const find = createManagedProgramFinder({
				binDir,
				agentBinariesDir,
				files: nodeManagedProgramFiles,
			});

			expect(await find("claude")).toEqual({
				path: await realpath(path.join(agentBinariesDir, "claude", MANAGED_TEST_VERSION, "claude")),
				version: MANAGED_TEST_VERSION,
			});
			expect(await find("codex")).toBeNull();
		} finally {
			await rm(folder, { recursive: true, force: true });
		}
	});

	test("the finder answers only the programs it holds", async () => {
		const find = managedProgramFinder({ codex: "/managed/codex" });

		expect(await find("codex")).toEqual({
			path: "/managed/codex",
			version: MANAGED_TEST_VERSION,
		});
		expect(await find("claude")).toBeNull();
	});
});
