// @vitest-environment node
/**
 * @feature GIT-07 Resolve conflicts, done by the agent on request
 * Owns: the composition-root test that the repository's Resolve conflicts prompt reaches GitService.
 * Behaviour: ui-map.md 6 Actions (a repo-level prompt replaces the default text), services-map.md
 * 3.7.6 (conflict resolution goes to the agent).
 * Test first: with a repository prompt saved, resolveConflicts sends that text rather than the
 * built-in one.
 */
import { ok, type Result } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import type { ShellOutput } from "../platform/platform.ts";
import { createTestContainer, seedRepo, seedWorkspace } from "../test/container.ts";
import { localSettingsFile } from "./app-paths.ts";
import { tomlCodec } from "./services/toml-codec.ts";

const CUSTOM_PROMPT = "Keep both sides of every conflict.";

describe("GIT-07 repository prompt wiring", () => {
	it("sends the repository's Resolve conflicts prompt instead of the built-in text", async () => {
		const harness = createTestContainer();
		try {
			const repo = await seedRepo(harness.container);
			harness.memory.controls.files.set(
				localSettingsFile(repo.rootPath),
				tomlCodec.stringify({ prompts: { resolve_merge_conflicts: CUSTOM_PROMPT } }),
			);
			const loaded = await harness.container.services.repo.loadConfig(repo.id);
			expect(loaded.ok).toBe(true);
			const workspace = await seedWorkspace(harness.container, { repoId: repo.id });

			harness.memory.controls.scriptShell((command): Result<ShellOutput> | null => {
				if (
					command.program === "git" &&
					command.args.includes("config") &&
					command.args.includes("pull.rebase")
				) {
					return ok({ stdout: "true\n", stderr: "", exitCode: 0 });
				}
				return null;
			});

			const result = await harness.container.services.git.resolveConflicts(workspace.id);
			expect(result.ok).toBe(false);

			const sessions = harness.container.services.sessions.store.getState();
			const sessionId = sessions.byWorkspace[workspace.id]?.[0];
			expect(sessionId).toBeDefined();
			const failed = sessionId === undefined ? [] : (sessions.failedSends?.[sessionId] ?? []);
			expect(failed.map((entry) => entry.text)).toContain(CUSTOM_PROMPT);
		} finally {
			harness.container.services.repo.dispose();
			harness.close();
		}
	});
});
