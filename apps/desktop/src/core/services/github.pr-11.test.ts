/**
 * @feature PR-11 List and attach GitHub issues and pull requests
 * Behaviour: services-map.md 2.5.2, 5B.1.10 (REST reads for the repo pickers), 5B.8.2 (open
 * issues, 50 newest), 5B.8.3 (an issue or PR becomes a context file).
 * Test first: an issue with a `pull_request` field is left out of the issues list.
 */
import { appError, err, ok, type Result, type WorkspaceId } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import type { FileSystem, ShellOutput } from "../../platform/platform.ts";
import type { GitCommand } from "../git/commands.ts";
import type { GitRunner, GitRunOptions } from "../git/runner.ts";
import {
	canListGithubIssues,
	type GithubAccess,
	GithubService,
	githubIssueContextPath,
	githubRepositoryFromRemote,
	type PrWorkspaceContext,
	parseGithubIssues,
	parseGithubPullRequest,
	parseGithubPullRequests,
	parseGithubRepos,
	pullRequestContextPath,
} from "./github.ts";
import type { AgentMessenger } from "./sessions.ts";

const workspaceId = "ws-1" as WorkspaceId;
const workspacePath = "/tmp/conducted/workspace";
const remoteUrl = "https://github.com/octo/repo.git";

const output = (exitCode: number, stdout = "", stderr = ""): Result<ShellOutput> =>
	ok({ exitCode, stdout, stderr });

interface Recorded {
	command: GitCommand;
	options: GitRunOptions;
}

interface FakeGit extends GitRunner {
	readonly records: readonly Recorded[];
}

function fakeGit(options: {
	run?: (command: GitCommand) => Result<ShellOutput>;
	stdout?: (command: GitCommand) => Result<string>;
}): FakeGit {
	const records: Recorded[] = [];
	const git: FakeGit = {
		records,
		async run(command, runOptions) {
			records.push({ command, options: runOptions });
			return options.run?.(command) ?? output(0);
		},
		async runChecked(command, runOptions) {
			const result = await git.run(command, runOptions);
			if (!result.ok) return result;
			if (result.value.exitCode !== 0) {
				return err(appError("git_failed", result.value.stderr));
			}
			return result;
		},
		async stdout(command, runOptions) {
			records.push({ command, options: runOptions });
			return options.stdout?.(command) ?? ok("");
		},
		async start() {
			throw new Error("not used in this test");
		},
		withWorktreeLock: async (_path, work) => work(),
		withWorktreeAndRepoLocks: async (_path, _root, work) => work(),
	};
	return git;
}

interface FakeFs {
	readonly files: Map<string, string>;
	readonly dirs: readonly string[];
	readonly fs: Pick<FileSystem, "mkdirp" | "writeTextAtomic">;
}

function fakeFs(options: { failWrite?: boolean } = {}): FakeFs {
	const files = new Map<string, string>();
	const dirs: string[] = [];
	return {
		files,
		dirs,
		fs: {
			mkdirp: async (path) => {
				dirs.push(path);
				return ok(undefined);
			},
			writeTextAtomic: async (path, text) => {
				if (options.failWrite === true) {
					return err(appError("fs_denied", "The file could not be written."));
				}
				files.set(path, text);
				return ok(undefined);
			},
		},
	};
}

function makeService(
	git: GitRunner,
	overrides: {
		fs?: FakeFs["fs"];
		contextOf?: () => Promise<Result<PrWorkspaceContext>>;
	} = {},
): GithubService {
	return new GithubService({
		git,
		agent: {} as AgentMessenger,
		contextOf: async () =>
			overrides.contextOf === undefined
				? ok({
						workspaceId,
						workspacePath,
						branch: "feature",
						remote: "origin",
						prNumber: null,
					})
				: overrides.contextOf(),
		onMerged: () => {},
		now: () => 1_000,
		probeCwd: "/tmp",
		fs: overrides.fs,
	});
}

const issueJson = [
	{
		number: 7,
		title: "The list loses its place",
		html_url: "https://github.com/octo/repo/issues/7",
		state: "open",
		updated_at: "2026-11-05T10:00:00Z",
		body: "Scrolling resets when a new row arrives.",
	},
	{
		number: 9,
		title: "A pull request is not an issue",
		html_url: "https://github.com/octo/repo/pull/9",
		state: "open",
		updated_at: "2026-11-04T10:00:00Z",
		pull_request: { url: "https://api.github.com/repos/octo/repo/pulls/9" },
	},
];

const pullRequestJson = [
	{
		number: 12,
		title: "Keep the list in place",
		html_url: "https://github.com/octo/repo/pull/12",
		state: "open",
		draft: false,
		merged_at: null,
		updated_at: "2026-11-05T09:00:00Z",
		body: "Keeps the selected row.",
		user: { login: "ada", avatar_url: "https://avatars.example/ada.png" },
		head: { ref: "feature/list" },
	},
];

describe("PR-11 GitHub repository from a remote URL", () => {
	it("reads the owner and repository from every GitHub remote shape", () => {
		expect(githubRepositoryFromRemote("https://github.com/octo/repo.git")).toEqual(
			ok({ owner: "octo", name: "repo" }),
		);
		expect(githubRepositoryFromRemote("git@github.com:octo/repo.git")).toEqual(
			ok({ owner: "octo", name: "repo" }),
		);
		expect(githubRepositoryFromRemote("ssh://git@ssh.github.com:443/octo/repo")).toEqual(
			ok({ owner: "octo", name: "repo" }),
		);
	});

	it("refuses a remote that is not GitHub", () => {
		expect(githubRepositoryFromRemote("https://gitlab.com/octo/repo.git").ok).toBe(false);
		expect(githubRepositoryFromRemote("https://github.com/octo").ok).toBe(false);
		expect(githubRepositoryFromRemote("").ok).toBe(false);
	});
});

describe("PR-11 issues and pull requests are available only on GitHub", () => {
	const access = (status: GithubAccess["status"]): GithubAccess =>
		status === "ok"
			? {
					status: "ok",
					login: "ada",
					host: "github.com",
					scopes: ["repo"],
					usesToken: false,
					gitProtocol: "https",
				}
			: status === "unknown"
				? { status }
				: status === "gh_missing"
					? { status }
					: { status: status as "signed_out" | "unauthorized" | "offline" };

	it("needs a GitHub remote and a working sign-in", () => {
		expect(canListGithubIssues(remoteUrl, access("ok"))).toBe(true);
		expect(canListGithubIssues(null, access("ok"))).toBe(false);
		expect(canListGithubIssues("https://gitlab.com/octo/repo.git", access("ok"))).toBe(false);
		expect(canListGithubIssues(remoteUrl, access("signed_out"))).toBe(false);
		expect(canListGithubIssues(remoteUrl, access("unauthorized"))).toBe(false);
	});
});

describe("PR-11 GitHub issue list", () => {
	it("lists open issues and leaves out pull requests", async () => {
		const git = fakeGit({ run: () => output(0, JSON.stringify(issueJson)) });
		const service = makeService(git);

		const result = await service.listIssues(remoteUrl, "");

		expect(result).toEqual(
			ok([
				{
					provider: "github",
					id: "7",
					identifier: "#7",
					title: "The list loses its place",
					url: "https://github.com/octo/repo/issues/7",
					state: "open",
					branchName: null,
					updatedAt: Date.parse("2026-11-05T10:00:00Z"),
				},
			]),
		);
		expect(git.records[0]?.command.args[1]).toBe(
			"repos/octo/repo/issues?state=open&per_page=50&sort=updated&direction=desc",
		);
	});

	it("filters the list by the search text", async () => {
		const git = fakeGit({ run: () => output(0, JSON.stringify(issueJson)) });
		const service = makeService(git);

		expect(await service.listIssues(remoteUrl, "loses")).toMatchObject({
			ok: true,
			value: [{ id: "7" }],
		});
		expect(await service.listIssues(remoteUrl, "no such issue")).toEqual(ok([]));
	});

	it("reports a response it cannot read instead of an empty list", async () => {
		const git = fakeGit({ run: () => output(0, "not json") });
		const service = makeService(git);

		const result = await service.listIssues(remoteUrl, "");

		expect(!result.ok && result.error.code).toBe("github_response_invalid");
	});

	it("reports a rejected read as a sign-in failure and marks GitHub broken", async () => {
		const git = fakeGit({ run: () => output(1, "", "HTTP 401: Bad credentials") });
		const service = makeService(git);

		const result = await service.listIssues(remoteUrl, "");

		expect(!result.ok && result.error.code).toBe("github_failed");
		if (!result.ok) expect(result.error.message).toContain("gh auth login");
		expect(service.store.getState().health.status).toBe("broken");
	});
});

describe("PR-11 pull request list and search", () => {
	it("maps the repo picker rows", async () => {
		const git = fakeGit({ run: () => output(0, JSON.stringify(pullRequestJson)) });
		const service = makeService(git);

		const result = await service.listPullRequests(remoteUrl, "");

		expect(result).toEqual(
			ok([
				{
					number: 12,
					title: "Keep the list in place",
					branch: "feature/list",
					authorLogin: "ada",
					authorAvatarUrl: "https://avatars.example/ada.png",
					state: "open",
					updatedAt: Date.parse("2026-11-05T09:00:00Z"),
				},
			]),
		);
		expect(git.records[0]?.command.args[1]).toBe(
			"repos/octo/repo/pulls?state=open&per_page=50&sort=updated&direction=desc",
		);
	});

	it("searches the loaded pull requests", async () => {
		const git = fakeGit({ run: () => output(0, JSON.stringify(pullRequestJson)) });
		const service = makeService(git);

		expect(await service.listPullRequests(remoteUrl, "list")).toMatchObject({
			ok: true,
			value: [{ number: 12 }],
		});
		expect(await service.listPullRequests(remoteUrl, "11")).toEqual(ok([]));
	});

	it("reads one pull request by number", async () => {
		const git = fakeGit({ run: () => output(0, JSON.stringify(pullRequestJson[0])) });
		const service = makeService(git);

		const result = await service.pullRequestByNumber(remoteUrl, 12);

		expect(result.ok && result.value).toMatchObject({ number: 12, branch: "feature/list" });
		expect(git.records[0]?.command.args[1]).toBe("repos/octo/repo/pulls/12");
	});

	it("marks a draft and a merged pull request", () => {
		const draft = parseGithubPullRequest(JSON.stringify({ ...pullRequestJson[0], draft: true }));
		expect(draft.ok && draft.value.state).toBe("draft");
		const merged = parseGithubPullRequest(
			JSON.stringify({ ...pullRequestJson[0], merged_at: "2026-11-05T11:00:00Z" }),
		);
		expect(merged.ok && merged.value.state).toBe("merged");
	});
});

describe("PR-11 recent repositories", () => {
	it("reads the user's eight most recent repositories", async () => {
		const git = fakeGit({
			run: () =>
				output(
					0,
					JSON.stringify([
						{
							name: "repo",
							description: "A list that keeps its place",
							private: true,
							clone_url: "https://github.com/octo/repo.git",
							updated_at: "2026-11-05T10:00:00Z",
							owner: { login: "octo" },
						},
					]),
				),
		});
		const service = makeService(git);

		const result = await service.recentRepos();

		expect(result).toEqual(
			ok([
				{
					owner: "octo",
					name: "repo",
					description: "A list that keeps its place",
					isPrivate: true,
					cloneUrl: "https://github.com/octo/repo.git",
					updatedAt: Date.parse("2026-11-05T10:00:00Z"),
				},
			]),
		);
		expect(git.records[0]?.command.args[1]).toBe("user/repos?per_page=8&sort=updated");
	});
});

describe("PR-11 parsers", () => {
	it("refuses a list that is not a list", () => {
		expect(parseGithubIssues("{}").ok).toBe(false);
		expect(parseGithubPullRequests("null").ok).toBe(false);
		expect(parseGithubRepos("42").ok).toBe(false);
	});

	it("refuses a row without the fields the screen shows", () => {
		expect(parseGithubIssues(JSON.stringify([{ title: "No number" }])).ok).toBe(false);
		expect(parseGithubPullRequests(JSON.stringify([{ number: 1, title: "No head" }])).ok).toBe(
			false,
		);
	});
});

describe("PR-11 context files", () => {
	it("writes an issue as [GITHUB]-<n>.md under its attachment key", async () => {
		const git = fakeGit({
			stdout: (command) => (command.program === "git" ? ok(remoteUrl) : ok("")),
			run: () => output(0, JSON.stringify(issueJson[0])),
		});
		const fs = fakeFs();
		const service = makeService(git, { fs: fs.fs });

		const result = await service.attachIssueToWorkspace(workspaceId, {
			provider: "github",
			id: "7",
		});

		expect(result).toEqual(ok(".context/attachments/github-7/[GITHUB]-7.md"));
		expect(fs.dirs).toContain(`${workspacePath}/.context/attachments/github-7`);
		const written = fs.files.get(`${workspacePath}/.context/attachments/github-7/[GITHUB]-7.md`);
		expect(written).toContain("# #7: The list loses its place");
		expect(written).toContain("https://github.com/octo/repo/issues/7");
		expect(written).toContain("Scrolling resets when a new row arrives.");
		expect(githubIssueContextPath("7")).toBe(".context/attachments/github-7/[GITHUB]-7.md");
	});

	it("writes a pull request picked as an issue to .context/pull-requests/<n>.md", async () => {
		const pullRequestIssue = {
			...pullRequestJson[0],
			html_url: "https://github.com/octo/repo/pull/12",
			pull_request: { url: "https://api.github.com/repos/octo/repo/pulls/12" },
		};
		const git = fakeGit({
			stdout: (command) => (command.program === "git" ? ok(remoteUrl) : ok("")),
			run: (command) =>
				output(
					0,
					JSON.stringify(
						command.args[1]?.includes("/pulls/") === true ? pullRequestJson[0] : pullRequestIssue,
					),
				),
		});
		const fs = fakeFs();
		const service = makeService(git, { fs: fs.fs });

		const result = await service.attachIssueToWorkspace(workspaceId, {
			provider: "github",
			id: "12",
		});

		expect(result).toEqual(ok(".context/pull-requests/12.md"));
		expect(fs.files.has(`${workspacePath}/.context/pull-requests/12.md`)).toBe(true);
		expect(pullRequestContextPath(12)).toBe(".context/pull-requests/12.md");
	});

	it("refuses to attach when the workspace has no GitHub remote", async () => {
		const git = fakeGit({
			stdout: (command) =>
				command.program === "git" ? ok("https://gitlab.com/octo/repo.git") : ok(""),
		});
		const fs = fakeFs();
		const service = makeService(git, { fs: fs.fs });

		const result = await service.attachIssueToWorkspace(workspaceId, {
			provider: "github",
			id: "7",
		});

		expect(!result.ok && result.error.code).toBe("github_not_github");
		expect(fs.files.size).toBe(0);
	});

	it("reports a failed write instead of returning a path that does not exist", async () => {
		const git = fakeGit({
			stdout: (command) => (command.program === "git" ? ok(remoteUrl) : ok("")),
			run: () => output(0, JSON.stringify(issueJson[0])),
		});
		const fs = fakeFs({ failWrite: true });
		const service = makeService(git, { fs: fs.fs });

		const result = await service.attachIssueToWorkspace(workspaceId, {
			provider: "github",
			id: "7",
		});

		expect(!result.ok && result.error.code).toBe("fs_denied");
	});

	it("refuses an id that is not an issue number", async () => {
		const service = makeService(fakeGit({}));
		const result = await service.attachIssueToWorkspace(workspaceId, {
			provider: "github",
			id: "not-a-number",
		});
		expect(!result.ok && result.error.code).toBe("github_issue_invalid");
	});
});
