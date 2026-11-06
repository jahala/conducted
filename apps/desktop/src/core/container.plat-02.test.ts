/**
 * @feature PLAT-02 Projects outside ~/conducted reach the file commands
 * Owns: tests that the project and workspace services register every folder they add or load,
 * run over the real container with the in-memory file commands refusing paths outside the file
 * scope, as files.rs does.
 * Test first: adding a project outside ~/conducted succeeds and its settings file can be read.
 */
// @vitest-environment node
import { ok, type Result } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import type { ShellCommand, ShellOutput } from "../platform/platform.ts";
import {
	createTestContainer,
	seedRepo,
	seedWorkspace,
	type TestContainer,
} from "../test/container.ts";

const must = <T>(result: Result<T>): T => {
	if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
	return result.value;
};

const output = (stdout = ""): Result<ShellOutput> => ok({ stdout, stderr: "", exitCode: 0 });

/** The git arguments without the runner's `-c core.quotePath=false` prefix. */
const argv = (command: ShellCommand): readonly string[] =>
	command.program === "git" && command.args[0] === "-c" ? command.args.slice(2) : command.args;

/** Answers git's questions about one repository at `root`. */
function scriptRepository(test: TestContainer, root: string): void {
	test.memory.controls.scriptShell((command) => {
		const args = argv(command);
		if (args[0] === "rev-parse" && args[1] === "--show-toplevel") return output(`${root}\n`);
		if (args[0] === "remote" && args[1] === "get-url") return output("git@example.com:a/app.git\n");
		if (args[0] === "symbolic-ref") return output("refs/remotes/origin/main\n");
		if (args[0] === "branch" && args[1] === "--show-current") return output("main\n");
		return null;
	});
}

const SETTINGS = '[scripts]\nsetup = "pnpm install"\n';

describe("PLAT-02 project folders join the file scope", () => {
	it("adding a project outside ~/conducted registers it, so its settings file reads", async () => {
		const test = createTestContainer({ enforceFileScope: true });
		try {
			const root = "/Users/conducted/code/app";
			test.memory.controls.addFolder(root);
			test.memory.controls.files.set(`${root}/.conducted/settings.toml`, SETTINGS);
			scriptRepository(test, root);

			const repo = must(await test.container.services.repo.addLocal(root));
			const config = must(await test.container.services.repo.loadConfig(repo.id));

			expect(test.memory.controls.registeredRoots).toContain(root);
			expect(config.setupScript).toBe("pnpm install");
		} finally {
			test.close();
		}
	});

	it("registers the work tree root when the picked folder sits inside it", async () => {
		const test = createTestContainer({ enforceFileScope: true });
		try {
			const root = "/Users/conducted/code/mono";
			test.memory.controls.addFolder(`${root}/packages/web`);
			scriptRepository(test, root);

			const repo = must(await test.container.services.repo.addLocal(`${root}/packages/web`));

			expect(repo.rootPath).toBe(root);
			expect(test.memory.controls.registeredRoots).toContain(root);
		} finally {
			test.close();
		}
	});

	it("a start registers every saved workspace folder and the workspaces folder", async () => {
		const test = createTestContainer({ enforceFileScope: true });
		try {
			const repo = await seedRepo(test.container, { rootPath: "/Volumes/work/app" });
			const workspace = await seedWorkspace(test.container, {
				repoId: repo.id,
				path: "/Volumes/old-root/workspaces/app/oslo",
			});
			test.memory.controls.files.set(`${workspace.path}/notes.md`, "kept");

			const read = must(await test.container.platform.fs.readText(`${workspace.path}/notes.md`));

			expect(read).toBe("kept");
			expect(test.memory.controls.registeredRoots).toEqual(
				expect.arrayContaining([workspace.path, "/Users/conducted/conducted"]),
			);
		} finally {
			test.close();
		}
	});

	it("a start registers every saved project, hidden ones too", async () => {
		const test = createTestContainer({ enforceFileScope: true });
		try {
			const shown = await seedRepo(test.container, { rootPath: "/Volumes/work/shown" });
			const hidden = await seedRepo(test.container, {
				rootPath: "/Volumes/work/hidden",
				hidden: true,
			});
			test.memory.controls.files.set("/Volumes/work/shown/.conducted/settings.toml", SETTINGS);

			const config = must(await test.container.services.repo.loadConfig(shown.id));

			expect(config.setupScript).toBe("pnpm install");
			expect(test.memory.controls.registeredRoots).toEqual(
				expect.arrayContaining([shown.rootPath, hidden.rootPath]),
			);
		} finally {
			test.close();
		}
	});
});
