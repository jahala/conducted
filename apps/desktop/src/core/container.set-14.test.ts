// @vitest-environment node
/**
 * @feature SET-14 Keep comments when the app rewrites a settings file
 * Owns: the composition-root test that both settings writers keep a hand-written file's comments.
 * Behaviour: services-map.md 4.2.1 (writes go to the user file and the repository's local file).
 * Test first: saving a setting and a repository's scripts through the container's actions leaves
 * the files' comments where the user wrote them.
 */
import { ok } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import { createTestContainer, seedRepo } from "../test/container.ts";
import { localSettingsFile, userSettingsFile } from "./app-paths.ts";

describe("SET-14 container wiring", () => {
	it("keeps the user file's comments when a setting is saved", async () => {
		const harness = createTestContainer();
		try {
			const file = userSettingsFile(harness.container.platform.fs.paths);
			const text = [
				'"$schema" = "https://conducted.app/schemas/settings.schema.json"',
				"",
				"# Branch hygiene",
				"[git]",
				"delete_branch_on_archive = false # until the release",
				"",
			].join("\n");
			harness.memory.controls.files.set(file, text);
			const saved = await harness.container.actions.settings.set("delete_branch_on_archive", true);
			expect(saved).toEqual(ok(undefined));
			expect(harness.memory.controls.files.get(file)).toBe(text.replace("= false", "= true"));
		} finally {
			harness.close();
		}
	});

	it("keeps the local file's comments when a repository's scripts are saved", async () => {
		const harness = createTestContainer();
		try {
			const repo = await seedRepo(harness.container);
			const file = localSettingsFile(repo.rootPath);
			const text = [
				'"$schema" = "https://conducted.app/schemas/settings.repo.schema.json"',
				"",
				"[scripts]",
				"# Installs everything a fresh worktree needs",
				'setup = "pnpm install"',
				"",
			].join("\n");
			harness.memory.controls.files.set(file, text);
			const loaded = await harness.container.services.repo.loadConfig(repo.id);
			if (!loaded.ok) throw new Error(loaded.error.message);
			const saved = await harness.container.actions.projects.updateConfig(repo.id, {
				...loaded.value,
				setupScript: "pnpm install --frozen-lockfile",
			});
			expect(saved).toEqual(ok(undefined));
			expect(harness.memory.controls.files.get(file)).toBe(
				text.replace('"pnpm install"', '"pnpm install --frozen-lockfile"'),
			);
		} finally {
			harness.container.services.repo.dispose();
			harness.close();
		}
	});
});
