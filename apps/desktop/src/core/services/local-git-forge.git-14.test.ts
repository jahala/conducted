import {
	appError,
	err,
	ok,
	type Result,
	type SessionId,
	type WorkspaceId,
} from "@conducted/shared";
import { describe, expect, it } from "vitest";
import {
	FakeGitRunner,
	type GitAnswer,
	gitOutput,
	gitUnscripted,
} from "../../test/fake-git-runner.ts";
import type { GitRunner } from "../git/runner.ts";
import { GITHUB_FORGE_CAPABILITIES, LOCAL_GIT_FORGE_CAPABILITIES } from "../local-git-forge.ts";
import { getSettingDef } from "../registries/settings.ts";
import type { WorkspaceGitContext } from "./git.ts";
import { LocalGitForge } from "./local-git-forge.ts";
import type { AgentMessenger } from "./sessions.ts";

const workspaceId = "ws-git-14" as WorkspaceId;

const context = (overrides: Partial<WorkspaceGitContext> = {}): WorkspaceGitContext => ({
	workspaceId,
	workspacePath: "/tmp/git-14/workspace",
	repoRootPath: "/tmp/git-14/repo",
	remote: "origin",
	targetBranch: "origin/main",
	branch: "feature/local",
	...overrides,
});

function fakeAgent(): AgentMessenger & {
	readonly calls: readonly { workspaceId: WorkspaceId; text: string }[];
} {
	const calls: { workspaceId: WorkspaceId; text: string }[] = [];
	let next = 0;
	return {
		calls,
		sendInstruction: async (id, text) => {
			calls.push({ workspaceId: id, text });
			next += 1;
			return ok(`session-${next}` as SessionId);
		},
	};
}

function makeService(
	git: GitRunner,
	agent: AgentMessenger,
	options: {
		enabled?: boolean;
		contextOf?: (id: WorkspaceId) => Promise<Result<WorkspaceGitContext>>;
	} = {},
): LocalGitForge {
	return new LocalGitForge({
		git,
		agent,
		contextOf: options.contextOf ?? (async () => ok(context())),
		enabled: () => options.enabled ?? true,
	});
}

describe("GIT-14 local-git forge", () => {
	it("reports ahead 2 and DIRTY when the branch is 2 ahead and the probe exits 1", async () => {
		const git = new FakeGitRunner((command) => {
			if (command.args[0] === "rev-list") return gitOutput("0\t2\n");
			if (command.args[0] === "merge-tree") return gitOutput("tree-oid\n", "", 1);
			return gitUnscripted(command);
		});
		const service = makeService(git, fakeAgent());

		const result = await service.synthesizePrInfo(workspaceId);

		expect(result).toEqual(ok({ ahead: 2, behind: 0, mergeState: "DIRTY" }));
		expect(git.commands.filter((command) => command.args[0] === "merge-tree")).toHaveLength(1);
	});

	it("reports CLEAN when the probe exits 0 without conflict stage lines", async () => {
		const git = new FakeGitRunner((command) => {
			if (command.args[0] === "rev-list") return gitOutput("3\t1\n");
			if (command.args[0] === "merge-tree") return gitOutput("tree-oid\n");
			return gitUnscripted(command);
		});
		const service = makeService(git, fakeAgent());

		expect(await service.synthesizePrInfo(workspaceId)).toEqual(
			ok({ ahead: 1, behind: 3, mergeState: "CLEAN" }),
		);
	});

	it("reports DIRTY when a conflict stage line is printed even with exit 0", async () => {
		const git = new FakeGitRunner((command) => {
			if (command.args[0] === "rev-list") return gitOutput("0\t1\n");
			if (command.args[0] === "merge-tree") {
				return gitOutput("tree-oid\n100644 a1b2c3d 1\tfile.txt\n");
			}
			return gitUnscripted(command);
		});
		const service = makeService(git, fakeAgent());

		expect(await service.synthesizePrInfo(workspaceId)).toEqual(
			ok({ ahead: 1, behind: 0, mergeState: "DIRTY" }),
		);
	});

	it("skips the merge probe and reports no merge state when nothing is ahead", async () => {
		const git = new FakeGitRunner((command) => {
			if (command.args[0] === "rev-list") return gitOutput("4\t0\n");
			return gitUnscripted(command);
		});
		const service = makeService(git, fakeAgent());

		expect(await service.synthesizePrInfo(workspaceId)).toEqual(
			ok({ ahead: 0, behind: 4, mergeState: null }),
		);
		expect(git.commands.some((command) => command.args[0] === "merge-tree")).toBe(false);
	});

	it("returns the rev-list failure instead of guessing zero", async () => {
		const git = new FakeGitRunner(() => gitOutput("", "fatal: bad revision", 128));
		const service = makeService(git, fakeAgent());

		const result = await service.synthesizePrInfo(workspaceId);

		expect(result.ok).toBe(false);
		expect(!result.ok && result.error.code).toBe("git_failed");
	});

	it("names git 2.38 when merge-tree --write-tree is not known", async () => {
		const git = new FakeGitRunner((command) => {
			if (command.args[0] === "rev-list") return gitOutput("0\t1\n");
			if (command.args[0] === "merge-tree") {
				return gitOutput("", "error: unknown option `write-tree'\n", 129);
			}
			return gitUnscripted(command);
		});
		const service = makeService(git, fakeAgent());

		const result = await service.synthesizePrInfo(workspaceId);

		expect(!result.ok && result.error.code).toBe("local_git_forge_git_too_old");
		expect(!result.ok && result.error.message).toContain("2.38");
	});

	it("returns local_git_forge_off for both methods when the switch is off", async () => {
		const git = new FakeGitRunner((command) => gitUnscripted(command));
		const agent = fakeAgent();
		const service = makeService(git, agent, { enabled: false });

		const info = await service.synthesizePrInfo(workspaceId);
		const merged = await service.mergeIntoTarget(workspaceId);

		expect(!info.ok && info.error.code).toBe("local_git_forge_off");
		expect(!merged.ok && merged.error.code).toBe("local_git_forge_off");
		expect(git.commands).toHaveLength(0);
		expect(agent.calls).toHaveLength(0);
	});

	it("sends the agent the merge instruction and runs no merge itself", async () => {
		const git = new FakeGitRunner((command) => gitUnscripted(command));
		const agent = fakeAgent();
		const service = makeService(git, agent);

		expect(await service.mergeIntoTarget(workspaceId)).toEqual(ok(undefined));

		expect(agent.calls).toHaveLength(1);
		const text = agent.calls[0]?.text ?? "";
		expect(text).toContain("feature/local");
		expect(text).toContain("main");
		expect(text).toContain("fast-forward");
		expect(text).not.toContain("push");
		expect(git.commands).toHaveLength(0);
	});

	it("returns the context failure without asking git or the agent", async () => {
		const failure = appError("workspace_unknown", "That workspace no longer exists.");
		const git = new FakeGitRunner((command) => gitUnscripted(command));
		const agent = fakeAgent();
		const service = makeService(git, agent, { contextOf: async () => err(failure) });

		expect(await service.synthesizePrInfo(workspaceId)).toEqual(err(failure));
		expect(await service.mergeIntoTarget(workspaceId)).toEqual(err(failure));
		expect(git.commands).toHaveLength(0);
		expect(agent.calls).toHaveLength(0);
	});

	it("refuses a workspace with no branch or no target", async () => {
		const noBranch = makeService(
			new FakeGitRunner((command) => gitUnscripted(command)),
			fakeAgent(),
			{
				contextOf: async () => ok(context({ branch: " " })),
			},
		);
		const noTarget = makeService(
			new FakeGitRunner((command) => gitUnscripted(command)),
			fakeAgent(),
			{
				contextOf: async () => ok(context({ targetBranch: " " })),
			},
		);

		const branch = await noBranch.synthesizePrInfo(workspaceId);
		const target = await noTarget.mergeIntoTarget(workspaceId);

		expect(!branch.ok && branch.error.code).toBe("local_git_forge_no_branch");
		expect(!target.ok && target.error.code).toBe("local_git_forge_no_target");
	});

	it("lets only the newest refresh answer change the store", async () => {
		let releaseFirst = (_text: string): void => {};
		const first = new Promise<GitAnswer>((resolve) => {
			releaseFirst = (text) => resolve(gitOutput(text));
		});
		let revListCalls = 0;
		const git = new FakeGitRunner((command) => {
			if (command.args[0] === "rev-list") {
				revListCalls += 1;
				return revListCalls === 1 ? first : gitOutput("0\t1\n");
			}
			if (command.args[0] === "merge-tree") return gitOutput("tree-oid\n");
			return gitUnscripted(command);
		});
		const service = makeService(git, fakeAgent());

		const older = service.refresh(workspaceId);
		const newer = service.refresh(workspaceId);
		expect(await newer).toEqual(ok({ ahead: 1, behind: 0, mergeState: "CLEAN" }));
		releaseFirst("0\t5\n");
		expect(await older).toEqual(ok({ ahead: 5, behind: 0, mergeState: "CLEAN" }));

		expect(service.store.getState().byWorkspace[String(workspaceId)]?.info).toEqual({
			ahead: 1,
			behind: 0,
			mergeState: "CLEAN",
		});
	});

	it("gives GitHub every capability and local git none", () => {
		const github = Object.entries(GITHUB_FORGE_CAPABILITIES);
		const local = Object.entries(LOCAL_GIT_FORGE_CAPABILITIES);

		expect(github.length).toBeGreaterThan(0);
		expect(local.length).toBeGreaterThan(0);
		expect(github.every(([, allowed]) => allowed === true)).toBe(true);
		expect(local.every(([, allowed]) => allowed === false)).toBe(true);
		expect(local.map(([name]) => name)).toEqual(github.map(([name]) => name));
	});

	it("has the user switch that turns the forge on", () => {
		const setting = getSettingDef("local_git_forge_enabled");

		expect(setting?.type).toBe("bool");
		expect(setting?.default).toBe(false);
		expect(setting?.scopes).toEqual(["user"]);
	});
});
