/**
 * @feature PRJ-03 Quick start a new project from a template
 * Owns: tests for creating a project from a template and for creating its private GitHub repository.
 * Behaviour: services-map.md 3.2 (create-a-new-GitHub-repo flow), ui-map.md 2 and 3.9 (Quick start,
 * Create project, Create a private GitHub repo?).
 * Test first: an empty template creates its folder, initial commit and project row through the action
 * the dialog calls.
 */
import { ok, type Result } from "@conducted/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ShellCommand, ShellOutput } from "../../platform/platform.ts";
import { createTestContainer, seedRepo, type TestContainer } from "../../test/container.ts";
import type { Repo } from "../model.ts";

const output = (exitCode: number, stdout = "", stderr = ""): ShellOutput => ({
	exitCode,
	stdout,
	stderr,
});

const answer = (exitCode: number, stdout = "", stderr = ""): Result<ShellOutput> =>
	ok(output(exitCode, stdout, stderr));

const argsOf = (command: ShellCommand): string[] =>
	command.program === "git" ? command.args.slice(2) : [...command.args];

const commandKey = (command: ShellCommand): string =>
	`${command.program} ${argsOf(command).join(" ")}`;

let test: TestContainer;

beforeEach(async () => {
	test = createTestContainer();
	await test.container.platform.fs.mkdirp("/code");
});

afterEach(() => {
	test.close();
});

const must = <T>(result: Result<T>): T => {
	if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
	return result.value;
};

const called = (fragment: string): boolean =>
	test.memory.controls.shellCalls.some((command) => commandKey(command).includes(fragment));

/** Answers the reads a registered local project makes when it has no remote. */
function scriptLocalProject(branch = "main"): void {
	test.memory.controls.scriptShell((command) => {
		const key = commandKey(command);
		if (key === "git remote get-url -- origin") return answer(1, "", "fatal: no such remote");
		if (key === "git symbolic-ref refs/remotes/origin/HEAD") {
			return answer(128, "", "fatal: no such ref");
		}
		if (key === "git branch --show-current") return answer(0, `${branch}\n`);
		return null;
	});
}

describe("PRJ-03 creating a project from a template", () => {
	it("creates an empty project folder with its first commit and adds it as a project", async () => {
		scriptLocalProject();
		test.memory.controls.scriptShell((command) => {
			const key = commandKey(command);
			if (key === "git init") return answer(0, "Initialized\n");
			if (key === "git add -A") return answer(0);
			if (key === "git commit -m Initial commit") return answer(0);
			return null;
		});

		const repo = must(
			await test.container.actions.projects.createFromTemplate("My App!", "/code", "empty"),
		);

		expect(repo.name).toBe("my-app");
		expect(repo.rootPath).toBe("/code/my-app");
		expect(test.memory.controls.files.get("/code/my-app/.gitkeep")).toBe("");
		expect(called("git init")).toBe(true);
		expect(called("git add -A")).toBe(true);
		expect(called("git commit -m Initial commit")).toBe(true);
		expect(test.container.services.repo.store.getState().order).toEqual([repo.id]);
	});

	it("refuses a name with no letters or numbers before it writes anything", async () => {
		const result = await test.container.actions.projects.createFromTemplate(
			"!!!",
			"/code",
			"empty",
		);

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("repo_name_invalid");
		expect(test.memory.controls.shellCalls).toHaveLength(0);
	});

	it("refuses a parent folder that is missing or a folder already at the destination", async () => {
		const missing = await test.container.actions.projects.createFromTemplate(
			"app",
			"/missing",
			"empty",
		);
		expect(missing.ok).toBe(false);
		if (!missing.ok) expect(missing.error.code).toBe("repo_location_missing");

		await test.container.platform.fs.mkdirp("/code/app");
		const taken = await test.container.actions.projects.createFromTemplate("app", "/code", "empty");
		expect(taken.ok).toBe(false);
		if (!taken.ok) expect(taken.error.code).toBe("repo_destination_exists");
	});

	it("runs create-next-app for the Next.js template and writes its environment file", async () => {
		scriptLocalProject();
		test.memory.controls.scriptShell((command) => {
			const key = commandKey(command);
			if (key.includes("create-next-app@latest my-app")) {
				return answer(0, "created\n");
			}
			return null;
		});

		const repo = must(
			await test.container.actions.projects.createFromTemplate("my-app", "/code", "nextjs"),
		);

		expect(repo.rootPath).toBe("/code/my-app");
		expect(called("create-next-app@latest my-app")).toBe(true);
		expect(test.memory.controls.files.get("/code/my-app/.env.local")).toBe("");
	});

	it("installs the gstack skill template and commits it", async () => {
		scriptLocalProject();
		test.memory.controls.scriptShell((command) => {
			const key = commandKey(command);
			if (key === "git init") return answer(0);
			if (key.startsWith("git clone --progress -- https://github.com/garrytan/gstack.git ")) {
				return answer(0);
			}
			if (command.program === "zsh" && command.args.join(" ").includes("./setup --host claude")) {
				return answer(0);
			}
			if (command.program === "zsh" && command.args.join(" ").includes("./setup --host codex")) {
				return answer(0);
			}
			if (key === "git add -A") return answer(0);
			if (key === "git commit -m Initial commit with gstack") return answer(0);
			return null;
		});

		const repo = must(
			await test.container.actions.projects.createFromTemplate("Agent App", "/code", "gstack"),
		);

		expect(repo.name).toBe("agent-app");
		expect(called("git clone --progress -- https://github.com/garrytan/gstack.git")).toBe(true);
		expect(
			test.memory.controls.shellCalls.some(
				(command) =>
					command.program === "zsh" && command.args.join(" ").includes("./setup --host claude"),
			),
		).toBe(true);
		expect(
			test.memory.controls.shellCalls.some(
				(command) =>
					command.program === "zsh" && command.args.join(" ").includes("./setup --host codex"),
			),
		).toBe(true);
		expect(called("git commit -m Initial commit with gstack")).toBe(true);
	});

	it("trashes the new folder when the template command fails", async () => {
		test.memory.controls.scriptShell((command) => {
			if (commandKey(command) === "git init") return answer(1, "", "fatal: cannot initialize");
			return null;
		});

		const result = await test.container.actions.projects.createFromTemplate(
			"broken",
			"/code",
			"empty",
		);

		expect(result.ok).toBe(false);
		expect(await test.container.platform.fs.exists("/code/broken")).toBe(false);
	});
});

describe("PRJ-03 creating a private GitHub repository", () => {
	async function seededRepo(): Promise<Repo> {
		await test.container.platform.fs.mkdirp("/code/app/.git");
		return seedRepo(test.container, { name: "app", rootPath: "/code/app" });
	}

	it("renames a non-GitHub origin, creates the repo, pushes and returns its URL", async () => {
		const repo = await seededRepo();
		test.memory.controls.scriptShell((command) => {
			const key = commandKey(command);
			if (key === "git remote get-url -- origin") {
				return called("git push -u origin HEAD")
					? answer(0, "git@github.com:acme/app.git\n")
					: answer(0, "git@gitlab.com:me/app.git\n");
			}
			if (key === "git remote get-url -- upstream") return answer(1, "", "no upstream");
			if (key === "git remote rename origin upstream") return answer(0);
			if (key === "git rev-parse --verify --quiet HEAD") return answer(0, "abc123\n");
			if (
				key ===
				"gh repo create acme/app --description A repository for app --private --source . --remote origin"
			) {
				return answer(0);
			}
			if (key === "git push -u origin HEAD") return answer(0);
			if (key === "gh repo view acme/app --json url -q .url") {
				return answer(0, "https://github.com/acme/app\n");
			}
			return null;
		});

		const url = must(
			await test.container.actions.projects.createGitHubRepo(repo.id, {
				owner: "acme",
				name: "app",
				isPrivate: true,
			}),
		);

		expect(url).toBe("https://github.com/acme/app");
		const calls = test.memory.controls.shellCalls.map(commandKey);
		expect(calls.indexOf("git remote rename origin upstream")).toBeLessThan(
			calls.indexOf(
				"gh repo create acme/app --description A repository for app --private --source . --remote origin",
			),
		);
		expect(calls).toContain("git push -u origin HEAD");
		expect(test.container.services.repo.store.getState().reposById[repo.id]?.remoteUrl).toBe(
			"git@github.com:acme/app.git",
		);
	});

	it("refuses to move an origin aside when an upstream remote already exists", async () => {
		const repo = await seededRepo();
		test.memory.controls.scriptShell((command) => {
			const key = commandKey(command);
			if (key === "git remote get-url -- origin") return answer(0, "git@gitlab.com:me/app.git\n");
			if (key === "git remote get-url -- upstream") return answer(0, "git@gitlab.com:me/old.git\n");
			return null;
		});

		const result = await test.container.actions.projects.createGitHubRepo(repo.id, {
			owner: "acme",
			name: "app",
			isPrivate: true,
		});

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("repo_upstream_exists");
		expect(called("git remote rename origin upstream")).toBe(false);
	});

	it("puts the original origin back when a later step fails", async () => {
		const repo = await seededRepo();
		test.memory.controls.scriptShell((command) => {
			const key = commandKey(command);
			if (key === "git remote get-url -- origin") {
				const haveRenamed = called("git remote rename origin upstream");
				return haveRenamed ? answer(1, "", "no origin") : answer(0, "git@gitlab.com:me/app.git\n");
			}
			if (key === "git remote get-url -- upstream") return answer(1, "", "no upstream");
			if (key === "git remote rename origin upstream") return answer(0);
			if (key === "git rev-parse --verify --quiet HEAD") return answer(0, "abc123\n");
			if (
				key ===
				"gh repo create acme/app --description A repository for app --private --source . --remote origin"
			) {
				return answer(0);
			}
			if (key === "git push -u origin HEAD") return answer(1, "", "fatal: push rejected");
			if (key === "git remote rename upstream origin") return answer(0);
			return null;
		});

		const result = await test.container.actions.projects.createGitHubRepo(repo.id, {
			owner: "acme",
			name: "app",
			isPrivate: true,
		});

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("github_repo_push_failed");
		expect(called("git remote rename upstream origin")).toBe(true);
	});

	it("initializes Git and makes the first commit when the folder has none", async () => {
		await test.container.platform.fs.mkdirp("/code/app");
		const repo = await seedRepo(test.container, { name: "app", rootPath: "/code/app" });
		test.memory.controls.scriptShell((command) => {
			const key = commandKey(command);
			if (key === "git remote get-url -- origin") {
				return called(
					"gh repo create acme/app --description A repository for app --private --source . --remote origin",
				)
					? answer(0, "git@github.com:acme/app.git\n")
					: answer(1, "", "no origin");
			}
			if (key === "git init") return answer(0);
			if (key === "git rev-parse --verify --quiet HEAD") return answer(1, "", "no HEAD");
			if (key === "git status --porcelain=v1 --untracked-files=all") return answer(0, "");
			if (key === "git add -A") return answer(0);
			if (key === "git commit -m Initial commit") return answer(0);
			if (
				key ===
				"gh repo create acme/app --description A repository for app --private --source . --remote origin"
			) {
				return answer(0);
			}
			if (key === "git push -u origin HEAD") return answer(0);
			if (key === "gh repo view acme/app --json url -q .url") {
				return answer(0, "https://github.com/acme/app\n");
			}
			return null;
		});

		must(
			await test.container.actions.projects.createGitHubRepo(repo.id, {
				owner: "acme",
				name: "app",
				isPrivate: true,
			}),
		);

		expect(called("git init")).toBe(true);
		expect(test.memory.controls.files.get("/code/app/.gitkeep")).toBe("");
		expect(called("git commit -m Initial commit")).toBe(true);
	});

	it("reports a missing project before it runs a command", async () => {
		const result = await test.container.actions.projects.createGitHubRepo("missing" as Repo["id"], {
			owner: "acme",
			name: "app",
			isPrivate: true,
		});

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("repo_unknown");
		expect(test.memory.controls.shellCalls).toHaveLength(0);
	});
});
