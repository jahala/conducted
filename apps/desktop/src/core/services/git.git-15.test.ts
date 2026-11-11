/**
 * @feature GIT-15 Sparse checkout and the external diff tool
 * Owns: the tests for reading and editing a workspace's sparse checkout, and for opening one
 * file's changes in Kaleidoscope.
 * Behaviour: services-map.md 3.11 (sparse checkout and the external diff tool) and 5A.5.3
 * (the sparse checkout helpers).
 * Test first: a workspace with sparse checkout off gets cone mode initialised and its chosen
 * folders set, and a changed file opens in Kaleidoscope while an unchanged one opens nothing.
 */
import { appError, err, ok, type Result, type WorkspaceId } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import type { ShellOutput } from "../../platform/platform.ts";
import { FakeGitRunner } from "../../test/fake-git-runner.ts";
import type { GitCommand } from "../git/commands.ts";
import { GitService, type WorkspaceGitContext } from "./git.ts";

const output = (stdout = "", stderr = "", exitCode = 0): ShellOutput => ({
	stdout,
	stderr,
	exitCode,
});

const workspaceId = "ws-git-15" as WorkspaceId;

const context = (): WorkspaceGitContext => ({
	workspaceId,
	workspacePath: "/repo/worktree",
	repoRootPath: "/repo",
	remote: "origin",
	targetBranch: "origin/main",
	branch: "feat",
});

interface Harness {
	service: GitService;
	runner: FakeGitRunner;
}

function harness(
	answer: (command: GitCommand) => Result<ShellOutput>,
	options: { contextOf?: () => Result<WorkspaceGitContext> } = {},
): Harness {
	const runner = new FakeGitRunner(answer);
	const service = new GitService({
		git: runner,
		contextOf: async () => options.contextOf?.() ?? ok(context()),
		agent: {} as never,
		renameWorkspaceBranch: async () => ok(undefined),
		setIntendedTargetBranch: async () => ok(undefined),
		moveOpenPullRequestBase: async () => ok(false),
		now: () => 0,
		fs: {
			trash: async () => ok(undefined),
			readText: async () => err(appError("fs_not_found", "missing")),
			writeTextAtomic: async () => ok(undefined),
			mkdirp: async () => ok(undefined),
			stat: async () => err(appError("fs_not_found", "missing")),
			paths: { home: "", appData: "", temp: "", resources: "" },
		},
	});
	return { service, runner };
}

const argsOf = (command: GitCommand): readonly string[] => command.args;

function sparseAnswer(options: {
	enabled: boolean;
	directories?: string;
	topLevel?: string;
}): (command: GitCommand) => Result<ShellOutput> {
	return (command) => {
		const args = argsOf(command);
		if (args[0] === "config" && args.at(-1) === "core.sparseCheckout") {
			return options.enabled ? ok(output("true\n")) : ok(output("", "", 1));
		}
		if (args[0] === "sparse-checkout" && args[1] === "list") {
			return ok(output(options.directories ?? "apps\npackages\n"));
		}
		if (args[0] === "ls-tree") return ok(output(options.topLevel ?? "apps\npackages\nscripts\n"));
		if (args[0] === "sparse-checkout" && args[1] === "init") return ok(output(""));
		if (args[0] === "sparse-checkout" && args[1] === "set") return ok(output(""));
		if (args[0] === "sparse-checkout" && args[1] === "disable") return ok(output(""));
		return err(appError("git_unscripted", `unexpected command: ${command.args.join(" ")}`));
	};
}

describe("GIT-15 sparse checkout settings", () => {
	it("reads whether it is on, its directories and the top-level folders", async () => {
		const h = harness(sparseAnswer({ enabled: true }));

		const settings = await h.service.sparseCheckoutSettings(workspaceId);

		expect(settings).toEqual(
			ok({
				enabled: true,
				directories: ["apps", "packages"],
				topLevelDirectories: ["apps", "packages", "scripts"],
			}),
		);
		const topLevel = h.runner.commands.find((command) => command.args[0] === "ls-tree");
		expect(topLevel?.args).toEqual(["ls-tree", "-d", "--name-only", "HEAD"]);
	});

	it("reports it off with no directories when git has no sparse key", async () => {
		const h = harness(sparseAnswer({ enabled: false }));

		const settings = await h.service.sparseCheckoutSettings(workspaceId);

		expect(settings).toEqual(
			ok({
				enabled: false,
				directories: [],
				topLevelDirectories: ["apps", "packages", "scripts"],
			}),
		);
		expect(
			h.runner.commands.some(
				(command) => command.args[0] === "sparse-checkout" && command.args[1] === "list",
			),
		).toBe(false);
	});

	it("initialises cone mode and sets the chosen folders when it was off", async () => {
		const h = harness(sparseAnswer({ enabled: false }));

		const result = await h.service.setSparseCheckoutDirectories(workspaceId, ["apps", "packages"]);

		expect(result).toEqual(ok(undefined));
		const sparse = h.runner.commands.filter((command) => command.args[0] === "sparse-checkout");
		expect(sparse.map((command) => command.args.slice(0, 2))).toEqual([
			["sparse-checkout", "init"],
			["sparse-checkout", "set"],
		]);
		expect(sparse[0]?.args).toEqual(["sparse-checkout", "init", "--cone"]);
		expect(sparse[1]?.args).toEqual(["sparse-checkout", "set", "--", "apps", "packages"]);
	});

	it("sets the folders without initialising again when it was already on", async () => {
		const h = harness(sparseAnswer({ enabled: true }));

		const result = await h.service.setSparseCheckoutDirectories(workspaceId, ["apps"]);

		expect(result).toEqual(ok(undefined));
		expect(
			h.runner.commands.some(
				(command) => command.args[0] === "sparse-checkout" && command.args[1] === "init",
			),
		).toBe(false);
		expect(
			h.runner.commands.find(
				(command) => command.args[0] === "sparse-checkout" && command.args[1] === "set",
			)?.args,
		).toEqual(["sparse-checkout", "set", "--", "apps"]);
	});

	it("turns sparse checkout off when the chosen list is empty", async () => {
		const h = harness(sparseAnswer({ enabled: true }));

		const result = await h.service.setSparseCheckoutDirectories(workspaceId, []);

		expect(result).toEqual(ok(undefined));
		expect(
			h.runner.commands.find(
				(command) => command.args[0] === "sparse-checkout" && command.args[1] === "disable",
			)?.args,
		).toEqual(["sparse-checkout", "disable"]);
	});

	it("turns a workspace's sparse checkout off", async () => {
		const h = harness(sparseAnswer({ enabled: true }));

		const result = await h.service.disableSparseCheckout(workspaceId);

		expect(result).toEqual(ok(undefined));
		expect(h.runner.commands.map((command) => command.args)).toEqual([
			["sparse-checkout", "disable"],
		]);
	});

	it("refuses a folder outside the workspace before running git", async () => {
		const h = harness(sparseAnswer({ enabled: true }));

		const result = await h.service.setSparseCheckoutDirectories(workspaceId, ["../outside"]);

		expect(result.ok).toBe(false);
		expect(h.runner.commands).toEqual([]);
	});
});
