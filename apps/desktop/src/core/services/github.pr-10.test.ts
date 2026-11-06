// @vitest-environment node
/**
 * @feature PR-10 Link a pull request by URL or number
 * Owns: tests for reading a pull request number out of a URL or a typed number, reading that pull
 * request from GitHub, and storing it on the workspace as its pull request.
 * Behaviour: ui-map.md 3.1 and 3.10 ("Link pull request", "PR URL or number"); services-map.md
 * 2.5.2 (a pull request is looked up by number and its link belongs to the workspace).
 * Test first: a full pull request URL and a bare number both store the same pull request number on
 * the workspace, and a URL for another repository is refused without asking GitHub.
 */
import { appError, err, ok, type Result, type WorkspaceId } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import type { ShellOutput } from "../../platform/platform.ts";
import { FakeGitRunner, gitOutput } from "../../test/fake-git-runner.ts";
import type { PrWorkspaceContext } from "./github.ts";
import { GithubService, pullRequestInput } from "./github.ts";

const workspaceId = "ws-1" as WorkspaceId;
const workspacePath = "/tmp/conducted/pr-10";
const remoteUrl = "https://github.com/octo/repo.git";

const prJson = JSON.stringify({
	number: 123,
	title: "Link me",
	html_url: "https://github.com/octo/repo/pull/123",
	state: "open",
	draft: false,
	merged_at: null,
	updated_at: "2026-11-05T09:00:00Z",
	body: "The pull request body",
	user: { login: "ada", avatar_url: "https://avatars.example/ada.png" },
	head: { ref: "feature/link" },
});

interface Stored {
	workspaceId: WorkspaceId;
	number: number;
	title: string | null;
	description: string | null;
}

function makeService(
	options: {
		answer?: (command: { program: string; args: readonly string[] }) => Result<ShellOutput>;
		store?: (workspaceId: WorkspaceId, pr: Omit<Stored, "workspaceId">) => Promise<Result<void>>;
		context?: Result<PrWorkspaceContext>;
	} = {},
): { service: GithubService; git: FakeGitRunner; stored: Stored[]; calls: string[] } {
	const stored: Stored[] = [];
	const calls: string[] = [];
	const git = new FakeGitRunner((command) => {
		calls.push([command.program, ...command.args].join(" "));
		if (options.answer !== undefined) return options.answer(command);
		if (command.program === "git" && command.args.includes("get-url")) {
			return gitOutput(`${remoteUrl}\n`);
		}
		if (command.program === "gh" && command.args[0] === "api") {
			return gitOutput(prJson);
		}
		return gitOutput();
	});
	const service = new GithubService({
		git,
		agent: {} as never,
		contextOf: async () =>
			options.context ??
			ok({
				workspaceId,
				workspacePath,
				branch: "feature/link",
				remote: "origin",
				prNumber: null,
			}),
		onMerged: () => {},
		now: () => 1_000,
		probeCwd: "/tmp",
		setting: <T>(_key: string): T => "cli" as unknown as T,
		...(options.store === undefined
			? {
					linkPullRequestToWorkspace: async (id, pr) => {
						stored.push({ workspaceId: id, ...pr });
						return ok(undefined);
					},
				}
			: { linkPullRequestToWorkspace: options.store }),
	});
	return { service, git, stored, calls };
}

describe("PR-10 pull request input", () => {
	it("reads a bare number, with or without a hash", () => {
		expect(pullRequestInput("123")).toEqual(ok({ number: 123, repository: null }));
		expect(pullRequestInput(" #123 ")).toEqual(ok({ number: 123, repository: null }));
	});

	it("reads a GitHub pull request URL", () => {
		expect(pullRequestInput("https://github.com/octo/repo/pull/123")).toEqual(
			ok({ number: 123, repository: { owner: "octo", name: "repo" } }),
		);
		expect(pullRequestInput("https://github.com/octo/repo/pull/123/files")).toEqual(
			ok({ number: 123, repository: { owner: "octo", name: "repo" } }),
		);
		expect(pullRequestInput("https://github.com/octo/repo/pull/123/?tab=files")).toEqual(
			ok({ number: 123, repository: { owner: "octo", name: "repo" } }),
		);
	});

	it("refuses text that names no pull request", () => {
		for (const text of [
			"",
			"   ",
			"abc",
			"0",
			"-4",
			"https://github.com/octo/repo/issues/5",
			"https://github.com/octo/repo/pull/not-a-number",
			"https://gitlab.com/octo/repo/pull/5",
		]) {
			expect(pullRequestInput(text).ok, text).toBe(false);
		}
	});
});

describe("PR-10 link a pull request", () => {
	it("stores the pull request named by a number on the workspace", async () => {
		const { service, stored, calls } = makeService();

		const linked = await service.linkPullRequest(workspaceId, "123");

		expect(linked).toEqual(ok(undefined));
		expect(stored).toEqual([{ workspaceId, number: 123, title: "Link me", description: null }]);
		expect(calls).toContain("gh api repos/octo/repo/pulls/123");
	});

	it("stores the same pull request when the input is its full URL", async () => {
		const { service, stored } = makeService();

		const linked = await service.linkPullRequest(
			workspaceId,
			"https://github.com/octo/repo/pull/123",
		);

		expect(linked).toEqual(ok(undefined));
		expect(stored.map((entry) => entry.number)).toEqual([123]);
	});

	it("refuses a URL that names a different repository without asking GitHub", async () => {
		const { service, stored, calls } = makeService();

		const linked = await service.linkPullRequest(
			workspaceId,
			"https://github.com/someone/else/pull/123",
		);

		expect(linked.ok).toBe(false);
		expect(stored).toEqual([]);
		expect(calls.some((call) => call.startsWith("gh "))).toBe(false);
	});

	it("surfaces a GitHub failure and leaves the workspace unchanged", async () => {
		const { service, stored } = makeService({
			answer: (command) => {
				if (command.program === "gh" && command.args[0] === "api") {
					return gitOutput("", "HTTP 404: Not Found", 1);
				}
				if (command.program === "git" && command.args.includes("get-url")) {
					return gitOutput(`${remoteUrl}\n`);
				}
				return gitOutput();
			},
		});

		const linked = await service.linkPullRequest(workspaceId, "404");

		expect(linked.ok).toBe(false);
		expect(stored).toEqual([]);
	});

	it("refuses when the window has no way to store the link", async () => {
		const git = new FakeGitRunner((command) => {
			if (command.program === "git" && command.args.includes("get-url")) {
				return gitOutput(`${remoteUrl}\n`);
			}
			if (command.program === "gh" && command.args[0] === "api") return gitOutput(prJson);
			return gitOutput();
		});
		const service = new GithubService({
			git,
			agent: {} as never,
			contextOf: async () =>
				ok({
					workspaceId,
					workspacePath,
					branch: "feature/link",
					remote: "origin",
					prNumber: null,
				}),
			onMerged: () => {},
			now: () => 1_000,
			probeCwd: "/tmp",
			setting: <T>(_key: string): T => "cli" as unknown as T,
		});

		const linked = await service.linkPullRequest(workspaceId, "123");

		expect(linked.ok).toBe(false);
		if (!linked.ok) expect(linked.error.code).toBe("github_link_unavailable");
	});

	it("reports why the workspace has no pull request context", async () => {
		const { service, stored } = makeService({
			context: err(appError("workspace_unknown", "That workspace no longer exists.")),
		});

		const linked = await service.linkPullRequest(workspaceId, "123");

		expect(linked.ok).toBe(false);
		expect(stored).toEqual([]);
	});
});
