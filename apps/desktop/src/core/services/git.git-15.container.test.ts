// @vitest-environment node
/**
 * @feature GIT-15 Sparse checkout and the external diff tool
 * Owns: the composition-root tests that opening a file's diff and reading and editing a
 * workspace's sparse checkout run through the real container's actions and GitService.
 * Behaviour: services-map.md 3.11 (sparse checkout and the external diff tool) and 5A.5.3.
 * Test first: the real action opens a changed file in Kaleidoscope, and the real actions edit a
 * workspace's sparse checkout and read the result back.
 */
import { ok, type Result } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import type { ShellCommand, ShellOutput } from "../../platform/platform.ts";
import { createTestContainer, seedRepo, seedWorkspace } from "../../test/container.ts";

const output = (stdout = "", stderr = "", exitCode = 0): Result<ShellOutput> =>
	ok({ stdout, stderr, exitCode });

/** The git arguments without the runner's `-c core.quotePath=false` prefix. */
const argv = (command: ShellCommand): readonly string[] =>
	command.program === "git" && command.args[0] === "-c" ? command.args.slice(2) : command.args;

describe("GIT-15 through the real container", () => {
	it("Open in Kaleidoscope shows the working tree's changes in Kaleidoscope, as Conductor does", async () => {
		const harness = createTestContainer();
		try {
			const repo = await seedRepo(harness.container, { rootPath: "/code/projects/git-15-open" });
			const workspace = await seedWorkspace(harness.container, {
				repoId: repo.id,
				path: "/code/workspaces/git-15-open",
			});
			const commands: { args: string[]; cwd: string | undefined }[] = [];
			harness.memory.controls.scriptShell((command) => {
				const args = argv(command);
				commands.push({ args: [...args], cwd: command.cwd });
				if (args[0] === "diff" && args[1] === "--quiet") return output("", "", 1);
				if (args[0] === "-c" && args[1]?.startsWith("difftool.ksdiff.cmd=")) return output();
				return null;
			});
			const opened: string[] = [];
			harness.memory.platform.opener.openWith = async (app, path) => {
				opened.push(`${app} ${path}`);
				return ok(undefined);
			};

			const result = await harness.container.actions.workspaces.openIn(
				workspace.id,
				"Kaleidoscope",
			);

			expect(result).toEqual(ok(undefined));
			const tool = commands.find(({ args }) => args.includes("difftool"));
			expect(tool).toEqual({
				args: [
					"-c",
					'difftool.ksdiff.cmd=ksdiff --partial-changeset --relative-path "$MERGED" -- "$LOCAL" "$REMOTE"',
					"difftool",
					"--tool=ksdiff",
					"--no-prompt",
					"HEAD",
				],
				cwd: "/code/workspaces/git-15-open",
			});
			expect(opened).toEqual([]);
		} finally {
			await harness.container.stop();
			harness.close();
		}
	});

	it("Open in Kaleidoscope opens the folder in the app when nothing changed", async () => {
		const harness = createTestContainer();
		try {
			const repo = await seedRepo(harness.container, { rootPath: "/code/projects/git-15-clean" });
			const workspace = await seedWorkspace(harness.container, {
				repoId: repo.id,
				path: "/code/workspaces/git-15-clean",
			});
			harness.memory.controls.scriptShell((command) => {
				const args = argv(command);
				if (args[0] === "diff" && args[1] === "--quiet") return output();
				return null;
			});
			const opened: string[] = [];
			harness.memory.platform.opener.openWith = async (app, path) => {
				opened.push(`${app} ${path}`);
				return ok(undefined);
			};

			const result = await harness.container.actions.workspaces.openIn(
				workspace.id,
				"Kaleidoscope",
			);

			expect(result).toEqual(ok(undefined));
			expect(opened).toEqual(["Kaleidoscope /code/workspaces/git-15-clean"]);
		} finally {
			await harness.container.stop();
			harness.close();
		}
	});

	it("edits and reads back a workspace's sparse checkout through the real actions", async () => {
		const harness = createTestContainer();
		try {
			const repo = await seedRepo(harness.container, { rootPath: "/code/projects/git-15-sparse" });
			expect((await harness.container.services.repo.loadConfig(repo.id)).ok).toBe(true);
			const workspace = await seedWorkspace(harness.container, {
				repoId: repo.id,
				path: "/code/workspaces/git-15-sparse",
			});
			let enabled = false;
			const commands: string[][] = [];
			harness.memory.controls.scriptShell((command) => {
				const args = argv(command);
				commands.push([...args]);
				if (args[0] === "config" && args.at(-1) === "core.sparseCheckout") {
					return enabled ? output("true\n") : output("", "", 1);
				}
				if (args[0] === "sparse-checkout" && args[1] === "init") {
					enabled = true;
					return output();
				}
				if (args[0] === "sparse-checkout" && args[1] === "set") return output();
				if (args[0] === "sparse-checkout" && args[1] === "disable") {
					enabled = false;
					return output();
				}
				if (args[0] === "sparse-checkout" && args[1] === "list") return output("apps\n");
				if (args[0] === "ls-tree") return output("apps\npackages\n");
				return null;
			});
			const git = harness.container.actions.git;

			expect(await git.setSparseCheckoutDirectories(workspace.id, ["apps"])).toEqual(ok(undefined));
			expect(commands).toEqual([
				["config", "--get", "core.sparseCheckout"],
				["sparse-checkout", "init", "--cone"],
				["sparse-checkout", "set", "--", "apps"],
			]);
			expect(await git.sparseCheckoutSettings(workspace.id)).toEqual(
				ok({ enabled: true, directories: ["apps"], topLevelDirectories: ["apps", "packages"] }),
			);
			// An empty list turns sparse checkout off, so the whole tree is back.
			expect(await git.setSparseCheckoutDirectories(workspace.id, [])).toEqual(ok(undefined));
			expect(enabled).toBe(false);
		} finally {
			await harness.container.stop();
			harness.close();
		}
	});
});
