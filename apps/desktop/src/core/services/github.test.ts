import { appError, err, ok, type Result, type WorkspaceId } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import type { Keychain, ShellOutput } from "../../platform/platform.ts";
import type { GitCommand } from "../git/commands.ts";
import type { GitRunner, GitRunOptions } from "../git/runner.ts";
import {
	GITHUB_SAML_SSO_MESSAGE,
	GITHUB_TOKEN_WARNING,
	githubFailureMessage,
	githubTokenWarning,
	isGithubRemoteUrl,
	looksLikeGithubToken,
	missingScopeFrom,
} from "../github-text.ts";
import {
	chooseMergeMethod,
	classifyGhFailure,
	GH_PAT_KEYCHAIN_KEY,
	GITHUB_REFRESH_FAILED_MESSAGE,
	type GithubAccess,
	GithubService,
	parseAuthStatus,
	resolveGhAuthMethod,
	toGitHubAccessView,
} from "./github.ts";
import type { AgentMessenger } from "./sessions.ts";

const output = (exitCode: number, stdout = "", stderr = ""): Result<ShellOutput> =>
	ok({ exitCode, stdout, stderr });

interface Recorded {
	kind: "run" | "stdout";
	command: GitCommand;
	options: GitRunOptions;
}

interface FakeGit extends GitRunner {
	readonly records: readonly Recorded[];
	readonly runCommands: readonly GitCommand[];
}

function fakeGit(options: {
	run?: (command: GitCommand) => Result<ShellOutput>;
	stdout?: (command: GitCommand) => Result<string>;
}): FakeGit {
	const records: Recorded[] = [];
	const runCommands: GitCommand[] = [];
	const git: FakeGit = {
		records,
		runCommands,
		async run(command, runOptions) {
			records.push({ kind: "run", command, options: runOptions });
			runCommands.push(command);
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
			records.push({ kind: "stdout", command, options: runOptions });
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

function memoryKeychain(initial: Record<string, string> = {}): Keychain & {
	readonly values: Map<string, string>;
} {
	const values = new Map(Object.entries(initial));
	return {
		values,
		get: async (key) => ok(values.get(key) ?? null),
		set: async (key, value) => {
			values.set(key, value);
			return ok(undefined);
		},
		delete: async (key) => {
			values.delete(key);
			return ok(undefined);
		},
	};
}

const workspaceId = "ws-1" as WorkspaceId;

function makeService(
	git: GitRunner,
	overrides: {
		keychain?: Keychain;
		now?: () => number;
		setting?: <T>(key: string) => T;
	} = {},
): GithubService {
	return new GithubService({
		git,
		agent: {} as AgentMessenger,
		contextOf: async () => err(appError("workspace_unknown", "no workspace")),
		onMerged: () => {},
		now: overrides.now ?? (() => 1_000),
		...(overrides.keychain === undefined ? {} : { keychain: overrides.keychain }),
		...(overrides.setting === undefined ? {} : { setting: overrides.setting }),
		probeCwd: "/tmp",
	});
}

const authOutput = {
	exitCode: 0,
	stdout:
		"github.com\n  ✓ Logged in to github.com account octocat (keyring)\n  - Token scopes: 'repo', 'read:org'\n",
	stderr: "",
};

const validToken = `ghp_${"a".repeat(30)}`;

describe("PR-01 gh failure classification", () => {
	it("recognises the four kinds the research names", () => {
		expect(classifyGhFailure("HTTP 401: Bad credentials")).toBe("unauthorized");
		expect(classifyGhFailure("saml enforcement is on for this organization")).toBe(
			"saml-sso-required",
		);
		expect(classifyGhFailure("HTTP 403: missing scope repo")).toBe("missing-scope");
		expect(classifyGhFailure("dial tcp: connection refused")).toBe("offline");
		expect(classifyGhFailure("something else went wrong")).toBe("other");
	});

	it("reads the scope GitHub says is missing", () => {
		expect(missingScopeFrom('This API operation needs the "read:org" scope.')).toBe("read:org");
		expect(missingScopeFrom("X-Accepted-OAuth-Scopes: repo, read:org")).toBe("repo");
		expect(missingScopeFrom("needs the workflow scope to continue")).toBe("workflow");
		expect(missingScopeFrom("no scope named here")).toBeNull();
	});

	it("turns each class into the sentence the user needs", () => {
		expect(githubFailureMessage("unauthorized", "")).toContain("Reconnect GitHub in Settings");
		expect(githubFailureMessage("saml-sso-required", "")).toBe(GITHUB_SAML_SSO_MESSAGE);
		expect(githubFailureMessage("saml-sso-required", "")).toMatch(/single sign-on/i);
		expect(githubFailureMessage("missing-scope", 'needs the "read:org" scope')).toContain(
			"read:org",
		);
		expect(githubFailureMessage("other", "")).toBeNull();
	});

	it("recognises a token by its prefix", () => {
		expect(looksLikeGithubToken(validToken)).toBe(true);
		expect(looksLikeGithubToken(`github_pat_${"b".repeat(30)}`)).toBe(true);
		expect(looksLikeGithubToken("my password")).toBe(false);
		expect(GITHUB_TOKEN_WARNING).toBe("That doesn't look like a GitHub token. Are you sure?");
	});
});

describe("PR-01 GitHub-only forge", () => {
	it("gives the GitHub forge only to github.com remotes", () => {
		expect(isGithubRemoteUrl("https://github.com/o/r.git")).toBe(true);
		expect(isGithubRemoteUrl("git@github.com:o/r.git")).toBe(true);
		expect(isGithubRemoteUrl("ssh://git@ssh.github.com:443/o/r")).toBe(true);
		expect(isGithubRemoteUrl("https://github.enterprise.example/o/r")).toBe(false);
		expect(isGithubRemoteUrl("git@gitlab.com:o/r.git")).toBe(false);
		expect(isGithubRemoteUrl("https://github.com.evil.example/o/r")).toBe(false);
		expect(isGithubRemoteUrl("")).toBe(false);
	});
});

describe("PR-01 sign-in method", () => {
	it("lets an explicit method win and otherwise reads the saved token", () => {
		expect(resolveGhAuthMethod("cli", true)).toBe("cli");
		expect(resolveGhAuthMethod("pat", false)).toBe("pat");
		expect(resolveGhAuthMethod("conductor-app", true)).toBe("pat");
		expect(resolveGhAuthMethod(null, true)).toBe("pat");
		expect(resolveGhAuthMethod(null, false)).toBe("cli");
	});
});

describe("PR-01 auth status parsing", () => {
	it("reads login, host and scopes from gh auth status", () => {
		expect(parseAuthStatus(authOutput.stdout)).toEqual({
			login: "octocat",
			host: "github.com",
			scopes: ["repo", "read:org"],
		});
	});

	it("reads the older wording", () => {
		expect(parseAuthStatus("Logged in to github.com as monalisa (oauth_token)")).toEqual({
			login: "monalisa",
			host: "github.com",
			scopes: [],
		});
	});
});

describe("PR-01 access probes", () => {
	it("reports gh as missing when the program cannot start", async () => {
		const git = fakeGit({
			run: () => err(appError("process_spawn", "program not found")),
		});
		const service = makeService(git);

		const result = await service.checkAccess();

		expect(result).toEqual(ok({ status: "gh_missing" }));
		expect(service.store.getState().access).toEqual({ status: "gh_missing" });
	});

	it("reads a signed-out answer as signed out", async () => {
		const git = fakeGit({
			run: () => output(1, "", "You are not logged into any GitHub hosts."),
		});
		const service = makeService(git);

		const result = await service.checkAccess();

		expect(result).toEqual(ok({ status: "signed_out" }));
	});

	it("keeps the newest check's answer when an older check ends last", async () => {
		const answering = fakeGit({
			run: (command) => {
				if (command.args[0] === "auth") return ok(authOutput);
				if (command.args[0] === "api") return output(0, "octocat\n");
				return output(0);
			},
		});
		let release: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let held = false;
		const git: GitRunner = {
			...answering,
			async run(command, options) {
				// The first auth probe waits; every later probe answers at once.
				if (command.args[0] === "auth" && !held) {
					held = true;
					await gate;
					return output(1, "", "You are not logged into any GitHub hosts.");
				}
				return answering.run(command, options);
			},
		};
		const service = makeService(git);

		const older = service.checkAccess();
		const newer = await service.checkAccess();
		expect(newer.ok && newer.value.status).toBe("ok");
		release();
		await older;

		expect(service.store.getState().access.status).toBe("ok");
	});

	it("reads the login, host, scopes and git protocol", async () => {
		const git = fakeGit({
			run: (command) => {
				if (command.args[0] === "auth") return ok(authOutput);
				if (command.args[0] === "api") return output(0, "octocat\n");
				if (command.args[0] === "config") return output(0, "ssh\n");
				return output(0);
			},
		});
		const service = makeService(git);

		const result = await service.checkAccess();

		expect(result).toEqual(
			ok({
				status: "ok",
				login: "octocat",
				host: "github.com",
				scopes: ["repo", "read:org"],
				usesToken: false,
				gitProtocol: "ssh",
			}),
		);
		expect(service.store.getState().health.status).toBe("ok");
		expect(git.runCommands.map((command) => command.args[0])).toEqual(["auth", "api", "config"]);
	});

	it("gives the saved personal access token to gh as GH_TOKEN", async () => {
		const keychain = memoryKeychain({ [GH_PAT_KEYCHAIN_KEY]: validToken });
		const git = fakeGit({
			run: (command) => {
				if (command.args[0] === "auth") return ok(authOutput);
				if (command.args[0] === "api") return output(0, "octocat\n");
				if (command.args[0] === "config") return output(0, "https\n");
				return output(0);
			},
		});
		const service = makeService(git, { keychain });

		const result = await service.checkAccess();

		expect(result.ok && result.value).toMatchObject({ status: "ok", usesToken: true });
		for (const record of git.records) {
			expect(record.options.env).toEqual({ GH_TOKEN: validToken });
		}
		expect(service.store.getState().health.authMethod).toBe("pat");
	});

	it("does not send a saved token when the chosen method is the gh CLI", async () => {
		const keychain = memoryKeychain({ [GH_PAT_KEYCHAIN_KEY]: validToken });
		const git = fakeGit({
			run: (command) => {
				if (command.args[0] === "auth") return ok(authOutput);
				if (command.args[0] === "api") return output(0, "octocat\n");
				if (command.args[0] === "config") return output(0, "https\n");
				return output(0);
			},
		});
		const service = makeService(git, {
			keychain,
			setting: <T>(_key: string): T => "cli" as T,
		});

		const result = await service.checkAccess();

		expect(result.ok && result.value).toMatchObject({ status: "ok", usesToken: false });
		for (const record of git.records) {
			expect(record.options.env).toBeUndefined();
		}
		expect(service.store.getState().health.authMethod).toBe("cli");
	});

	it("keeps the SSO requirement and the missing scope on the access state", async () => {
		const sso = makeService(
			fakeGit({ run: () => output(1, "", "saml enforcement is on for this organization") }),
		);
		expect(await sso.checkAccess()).toEqual(
			ok({ status: "signed_out", failure: "saml-sso-required" }),
		);

		const scope = makeService(
			fakeGit({ run: () => output(1, "", "HTTP 403: missing scope workflow") }),
		);
		expect(await scope.checkAccess()).toEqual(
			ok({ status: "signed_out", failure: "missing-scope" }),
		);
	});

	it("reports an unauthorized probe to the UI and marks access broken", async () => {
		const git = fakeGit({
			run: (command) =>
				command.args[0] === "auth"
					? output(0, authOutput.stdout)
					: output(1, "", "HTTP 401: Bad credentials"),
		});
		const service = makeService(git);

		const result = await service.checkAccess();

		expect(result).toEqual(ok({ status: "unauthorized" }));
		expect(service.store.getState().health).toMatchObject({
			status: "broken",
			reason: "unauthorized",
		});
	});

	it("reports a refresh failure with the toast text", async () => {
		const keychain: Keychain = {
			get: async () => err(appError("keychain_denied", "denied")),
			set: async () => ok(undefined),
			delete: async () => ok(undefined),
		};
		const service = makeService(fakeGit({}), { keychain });

		const result = await service.recheckAccess();

		expect(result.ok).toBe(false);
		expect(!result.ok && result.error.message).toBe(GITHUB_REFRESH_FAILED_MESSAGE);
	});
});

describe("PR-01 health store", () => {
	it("updates on every gh call and only unauthorized breaks access", async () => {
		const service = makeService(fakeGit({}));

		await service.recordGhResult({
			exitCode: 1,
			stdout: "",
			stderr: "saml enforcement is on",
		});
		expect(service.store.getState().health).toMatchObject({
			status: "unknown",
			reason: "saml-sso-required",
		});

		await service.recordGhResult({ exitCode: 0, stdout: "", stderr: "" });
		expect(service.store.getState().health).toMatchObject({ status: "ok", reason: null });

		await service.recordGhResult({ exitCode: 1, stdout: "", stderr: "HTTP 401: bad credentials" });
		expect(service.store.getState().health).toMatchObject({
			status: "broken",
			reason: "unauthorized",
		});

		await service.recordGhResult({ exitCode: 1, stdout: "", stderr: "HTTP 403: scope" });
		expect(service.store.getState().health).toMatchObject({
			status: "broken",
			reason: "missing-scope",
		});
	});
});

describe("PR-01 personal access token", () => {
	it("warns about a value that is not shaped like a token without blocking the save", async () => {
		expect(githubTokenWarning(validToken)).toBeNull();
		expect(githubTokenWarning("not a token")).toBe(GITHUB_TOKEN_WARNING);

		const keychain = memoryKeychain({ [GH_PAT_KEYCHAIN_KEY]: validToken });
		const service = makeService(fakeGit({}), { keychain });
		const enterpriseToken = `gh_enterprise_${"c".repeat(30)}`;

		expect(await service.setToken(enterpriseToken)).toEqual(ok(undefined));
		expect(keychain.values.get(GH_PAT_KEYCHAIN_KEY)).toBe(enterpriseToken);
	});

	it("saves a token, then removes it", async () => {
		const keychain = memoryKeychain();
		const service = makeService(fakeGit({}), { keychain });

		expect(await service.setToken(validToken)).toEqual(ok(undefined));
		expect(keychain.values.get(GH_PAT_KEYCHAIN_KEY)).toBe(validToken);

		expect(await service.setToken(null)).toEqual(ok(undefined));
		expect(keychain.values.has(GH_PAT_KEYCHAIN_KEY)).toBe(false);
	});

	it("refuses an empty token and keeps the saved one", async () => {
		const keychain = memoryKeychain({ [GH_PAT_KEYCHAIN_KEY]: validToken });
		const service = makeService(fakeGit({}), { keychain });

		const result = await service.setToken("   ");

		expect(!result.ok && result.error.code).toBe("github_token_empty");
		expect(keychain.values.get(GH_PAT_KEYCHAIN_KEY)).toBe(validToken);
	});

	it("says when the Keychain cannot be reached", async () => {
		const service = makeService(fakeGit({}));

		const result = await service.setToken(validToken);

		expect(!result.ok && result.error.code).toBe("github_keychain_unavailable");
	});
});

describe("PR-01 merge method and dedupe", () => {
	it("prefers squash, then rebase, then merge", () => {
		expect(chooseMergeMethod("[true,true,true]")).toBe("squash");
		expect(chooseMergeMethod("[false,true,true]")).toBe("rebase");
		expect(chooseMergeMethod("[false,false,true]")).toBe("merge");
		expect(chooseMergeMethod("[false,false,false]")).toBeNull();
		expect(chooseMergeMethod("not json")).toBeNull();
	});

	it("sends one gh pr merge when merge is asked for twice at once", async () => {
		const mergeCommands: GitCommand[] = [];
		const git = fakeGit({
			stdout: (command) => (command.args[0] === "rev-parse" ? ok("abc123") : ok("")),
			run: (command) => {
				if (command.args.some((arg) => arg.includes("squashMergeAllowed"))) {
					return output(0, "[true,true,true]");
				}
				if (command.args[0] === "pr" && command.args[1] === "merge") {
					mergeCommands.push(command);
					return output(0);
				}
				return output(0);
			},
		});
		const service = new GithubService({
			git,
			agent: {} as AgentMessenger,
			contextOf: async () =>
				ok({
					workspaceId,
					workspacePath: "/tmp/workspace",
					branch: "feature",
					remote: "origin",
					prNumber: 12,
				}),
			onMerged: () => {},
			now: () => 1_000,
			probeCwd: "/tmp",
		});

		const [first, second] = await Promise.all([
			service.merge(workspaceId),
			service.merge(workspaceId),
		]);

		expect(first).toEqual(ok(undefined));
		expect(second).toEqual(ok(undefined));
		expect(mergeCommands).toHaveLength(1);
		expect(mergeCommands[0]?.args).toEqual([
			"pr",
			"merge",
			"12",
			"--squash",
			"--match-head-commit",
			"abc123",
		]);
	});

	it("signs every merge gh call with the saved token and records its health", async () => {
		const keychain = memoryKeychain({ [GH_PAT_KEYCHAIN_KEY]: validToken });
		const git = fakeGit({
			stdout: (command) => (command.args[0] === "rev-parse" ? ok("abc123") : ok("")),
			run: (command) => {
				if (command.args.some((arg) => arg.includes("squashMergeAllowed"))) {
					return output(0, "[true,true,true]");
				}
				return output(0);
			},
		});
		const service = new GithubService({
			git,
			agent: {} as AgentMessenger,
			contextOf: async () =>
				ok({
					workspaceId,
					workspacePath: "/tmp/workspace",
					branch: "feature",
					remote: "origin",
					prNumber: 12,
				}),
			onMerged: () => {},
			now: () => 1_000,
			keychain,
			probeCwd: "/tmp",
		});

		expect(await service.merge(workspaceId)).toEqual(ok(undefined));

		const ghRecords = git.records.filter((record) => record.command.program === "gh");
		expect(ghRecords.map((record) => record.command.args.slice(0, 2))).toEqual([
			["api", "graphql"],
			["pr", "merge"],
		]);
		for (const record of ghRecords) {
			expect(record.options.env).toEqual({ GH_TOKEN: validToken });
		}
		expect(service.store.getState().health).toMatchObject({
			status: "ok",
			authMethod: "pat",
		});
	});
});

describe("PR-01 account view", () => {
	it("maps each access state to the model the Account page reads", () => {
		const signedIn: GithubAccess = {
			status: "ok",
			login: "octocat",
			host: "github.com",
			scopes: ["repo"],
			usesToken: false,
			gitProtocol: "https",
		};
		expect(toGitHubAccessView(signedIn)).toEqual({
			state: "signed_in",
			login: "octocat",
			host: "github.com",
			scopes: ["repo"],
			usesToken: false,
		});
		expect(toGitHubAccessView({ status: "gh_missing" })).toEqual({ state: "gh_missing" });
		expect(toGitHubAccessView({ status: "signed_out" })).toEqual({ state: "signed_out" });
		expect(toGitHubAccessView({ status: "offline" })).toEqual({
			state: "unknown",
			reason: "offline",
		});
		expect(toGitHubAccessView({ status: "unauthorized" })).toEqual({ state: "signed_out" });
		expect(toGitHubAccessView({ status: "unknown", reason: "check_failed" })).toEqual({
			state: "unknown",
			reason: "check_failed",
		});
	});
});
