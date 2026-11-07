import { appError, err, ok, type Result } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import type { ShellOutput } from "../../platform/platform.ts";
import type { GitCommand } from "../git/commands.ts";
import { githubOwnerRepositories, githubUserOrganizations } from "../git/gh-commands.ts";
import type { GitRunner } from "../git/runner.ts";
import {
	filterGithubRepositories,
	type GithubAccess,
	GithubService,
	githubOwnersFrom,
	parseGithubOrgLogins,
	parseGithubRepositories,
} from "./github.ts";
import type { AgentMessenger } from "./sessions.ts";

const output = (exitCode: number, stdout = "", stderr = ""): Result<ShellOutput> =>
	ok({ exitCode, stdout, stderr });

function fakeGit(handler: (command: GitCommand) => Result<ShellOutput>): GitRunner & {
	readonly calls: readonly GitCommand[];
} {
	const calls: GitCommand[] = [];
	return {
		calls,
		async run(command) {
			calls.push(command);
			return handler(command);
		},
		async runChecked(command) {
			return handler(command);
		},
		async stdout(command) {
			const result = handler(command);
			if (!result.ok) return result;
			return result.value.exitCode === 0
				? ok(result.value.stdout.trim())
				: err(appError("git_failed", result.value.stderr));
		},
		async start() {
			throw new Error("start is not used in these tests");
		},
		async withWorktreeLock(_path, work) {
			return work();
		},
		async withWorktreeAndRepoLocks(_worktree, _root, work) {
			return work();
		},
	};
}

function makeService(git: GitRunner, access?: GithubAccess): GithubService {
	const service = new GithubService({
		git,
		agent: {} as AgentMessenger,
		contextOf: async () => err(appError("workspace_unknown", "no workspace")),
		onMerged: () => {},
		now: () => 1_000,
		probeCwd: "/tmp",
	});
	if (access !== undefined) service.store.setState({ access });
	return service;
}

const signedIn = (login: string): GithubAccess => ({
	status: "ok",
	login,
	host: "github.com",
	scopes: ["repo"],
	usesToken: false,
	gitProtocol: "ssh",
});

const repositoryRow = (name: string, owner: string, isPrivate = false) => ({
	name,
	owner: { login: owner },
	description: `${name} description`,
	isPrivate,
	url: `https://github.com/${owner}/${name}`,
	sshUrl: `git@github.com:${owner}/${name}.git`,
	updatedAt: "2026-01-02T03:04:05Z",
});

describe("PRJ-02 owner picker", () => {
	it("reads organisation logins one per line, trimming and removing repeats", () => {
		expect(parseGithubOrgLogins("acme\r\n\r\n  beta  \r\nacme\r\ngamma\r\n")).toEqual([
			"acme",
			"beta",
			"gamma",
		]);
	});

	it("puts the signed-in account before its organisations", () => {
		expect(githubOwnersFrom("octocat", ["acme", "beta"])).toEqual([
			{ login: "octocat", kind: "user", avatarUrl: null },
			{ login: "acme", kind: "organization", avatarUrl: null },
			{ login: "beta", kind: "organization", avatarUrl: null },
		]);
	});

	it("does not list the account twice when an organisation has the same login", () => {
		expect(githubOwnersFrom("acme", ["acme", "beta"])).toEqual([
			{ login: "acme", kind: "user", avatarUrl: null },
			{ login: "beta", kind: "organization", avatarUrl: null },
		]);
	});

	it("lists the user's organisations with gh api user/orgs --paginate", async () => {
		const git = fakeGit(() => output(0, "acme\nbeta\n"));
		const service = makeService(git, signedIn("octocat"));

		const result = await service.listOwners();

		expect(result).toEqual(
			ok([
				{ login: "octocat", kind: "user", avatarUrl: null },
				{ login: "acme", kind: "organization", avatarUrl: null },
				{ login: "beta", kind: "organization", avatarUrl: null },
			]),
		);
		expect(git.calls).toEqual([githubUserOrganizations()]);
	});

	it("turns a rejected org request into a message and marks GitHub broken", async () => {
		const git = fakeGit(() => output(1, "", "HTTP 401: Bad credentials"));
		const service = makeService(git, signedIn("octocat"));

		const result = await service.listOwners();

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("github_failed");
			expect(result.error.message).toContain("Reconnect GitHub in Settings");
		}
		expect(service.store.getState().health.status).toBe("broken");
	});
});

describe("PRJ-02 repository picker", () => {
	it("reads the fields gh repo list returns", () => {
		const parsed = parseGithubRepositories(JSON.stringify([repositoryRow("alpha", "octo")]));

		expect(parsed).toEqual(
			ok([
				{
					owner: "octo",
					name: "alpha",
					description: "alpha description",
					isPrivate: false,
					cloneUrl: "git@github.com:octo/alpha.git",
					updatedAt: Date.parse("2026-01-02T03:04:05Z"),
				},
			]),
		);
	});

	it("falls back to the web URL and then to the GitHub address", () => {
		const rows = [
			{ ...repositoryRow("beta", "octo"), sshUrl: undefined },
			{ ...repositoryRow("gamma", "octo"), sshUrl: undefined, url: undefined },
		];
		const parsed = parseGithubRepositories(JSON.stringify(rows));

		expect(parsed.ok).toBe(true);
		if (parsed.ok) {
			expect(parsed.value[0]?.cloneUrl).toBe("https://github.com/octo/beta");
			expect(parsed.value[1]?.cloneUrl).toBe("https://github.com/octo/gamma.git");
		}
	});

	it("refuses a reply it cannot read instead of returning a shorter list", () => {
		const invalid = [
			"not json",
			JSON.stringify({ name: "not a list" }),
			JSON.stringify([{ ...repositoryRow("alpha", "octo"), name: undefined }]),
			JSON.stringify([{ ...repositoryRow("alpha", "octo"), owner: {} }]),
			JSON.stringify([{ ...repositoryRow("alpha", "octo"), isPrivate: "yes" }]),
			JSON.stringify([{ ...repositoryRow("alpha", "octo"), updatedAt: "not a date" }]),
		];
		for (const text of invalid) {
			const parsed = parseGithubRepositories(text);
			expect(parsed.ok).toBe(false);
			if (!parsed.ok) expect(parsed.error.code).toBe("github_response_invalid");
		}
	});

	it("filters by owner/name or description and keeps everything for an empty query", () => {
		const parsed = parseGithubRepositories(
			JSON.stringify([
				repositoryRow("alpha", "octo"),
				repositoryRow("beta", "acme"),
				{ ...repositoryRow("gamma", "octo"), description: "a special project" },
			]),
		);
		const repositories = parsed.ok ? parsed.value : [];

		expect(filterGithubRepositories(repositories, "")).toHaveLength(3);
		expect(filterGithubRepositories(repositories, "acme")).toHaveLength(1);
		expect(filterGithubRepositories(repositories, "octo")).toHaveLength(2);
		expect(filterGithubRepositories(repositories, "SPECIAL")).toHaveLength(1);
	});

	it("lists one owner's repositories with gh repo list and applies the query", async () => {
		const git = fakeGit(() =>
			output(
				0,
				JSON.stringify([
					repositoryRow("alpha", "octo"),
					{ ...repositoryRow("beta", "octo"), description: "nothing useful" },
				]),
			),
		);
		const service = makeService(git, signedIn("octocat"));

		const result = await service.listRepositories("octo", "alpha");

		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value.map((repo) => repo.name)).toEqual(["alpha"]);
		expect(git.calls).toEqual([githubOwnerRepositories("octo")]);
	});

	it("requires an owner before running gh", async () => {
		const git = fakeGit(() => output(0));
		const service = makeService(git, signedIn("octocat"));

		const result = await service.listRepositories("  ", "");

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("github_owner_missing");
		expect(git.calls).toHaveLength(0);
	});

	it("reports an unreadable repository list as an error", async () => {
		const git = fakeGit(() => output(0, "not json"));
		const service = makeService(git, signedIn("octocat"));

		const result = await service.listRepositories("octo", "");

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("github_response_invalid");
	});
});
