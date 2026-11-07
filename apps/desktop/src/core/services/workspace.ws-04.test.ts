// @vitest-environment node
/**
 * @feature WS-04 Rename the placeholder branch after the first message
 * Owns: the first-message rename: its settings, the skip cases, the prefix and clash suffix, the
 * suggested name's cleanup, the branch save and the optional workspace rename.
 * Behaviour: frontend.md 6, services-map.md 3.11, ui-map.md 6 Git, and D030.
 * Test first: a placeholder branch whose suggestion clashes with an existing branch takes -v2.
 */
import type { AgentLaunch, SessionConfig } from "@conducted/protocol";
import {
	appError,
	err,
	ok,
	type RepoId,
	type Result,
	type SessionId,
	type WorkspaceId,
} from "@conducted/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createTestContainer,
	seedRepo,
	seedWorkspace,
	type TestContainer,
} from "../../test/container.ts";
import type { NewWorkspace } from "../db/workspaces.ts";
import type { Session, Workspace } from "../model.ts";
import { getSettingDef, type SettingValue } from "../registries/settings.ts";
import type { SidecarClient } from "../sidecar/tunnel.ts";
import { ChatTitleService } from "./chat-titles.ts";

const CONFIG: SessionConfig = {
	agent: "claude",
	model: "sonnet",
	effort: "medium",
	fastMode: false,
	planMode: false,
	requireToolApproval: false,
	additionalDirectories: [],
	appTools: { diffComments: false, progressUpdates: false, setTargetBranch: false },
};

const LAUNCH: AgentLaunch = { env: {}, providerKeys: {} };

let current: TestContainer | null = null;

afterEach(() => {
	current?.container.sidecar.stop();
	current?.close();
	current = null;
	vi.restoreAllMocks();
});

function sampleSession(changes: Partial<Session> = {}): Session {
	return {
		id: "session-1" as SessionId,
		workspaceId: "workspace-1" as WorkspaceId,
		title: null,
		config: CONFIG,
		agentSessionId: null,
		forkResumeNativeMessageId: null,
		unreadCount: 0,
		contextUsedTokens: null,
		queuePausedAt: null,
		closedAt: null,
		lastUserMessageAt: null,
		createdAt: 0,
		updatedAt: 0,
		...changes,
	};
}

function sampleWorkspace(changes: Partial<Workspace> = {}): Workspace {
	return {
		id: "workspace-1" as WorkspaceId,
		repoId: "repo-1" as RepoId,
		directoryName: "alpha",
		path: "/work/alpha",
		branch: "placeholder-branch",
		branchIsPlaceholder: true,
		host: { kind: "local" },
		displayName: null,
		targetBranch: "origin/main",
		state: "ready",
		kanbanStatus: "in_progress",
		port: 4100,
		pinnedAt: null,
		linkedPaths: [],
		prNumber: null,
		prTitle: null,
		prDescription: null,
		archiveCommit: null,
		archivedAt: null,
		activeSessionId: null,
		filesCopied: null,
		lastActivityAt: 0,
		createdAt: 0,
		updatedAt: 0,
		...changes,
	};
}

function suggestionHarness(response: Result<{ text: string }>) {
	const requests: { method: string; params: unknown }[] = [];
	const logs: string[] = [];
	const request = (async (method: string, params: unknown) => {
		requests.push({ method, params });
		return response;
	}) as SidecarClient["request"];
	const service = new ChatTitleService({
		sidecar: { request },
		titlesEnabled: () => true,
		cheapestModel: () => "cheap-model",
		launchFor: async () => ok(LAUNCH),
		log: (_level, message) => logs.push(message),
	});
	return { service, requests, logs };
}

const branchInput = {
	session: sampleSession(),
	workspace: sampleWorkspace(),
	firstUserMessage: "The login button does nothing",
};

function setSettings(container: TestContainer, values: Record<string, SettingValue>): void {
	container.container.services.settings.store.setState((state) => ({
		...state,
		values: { ...state.values, ...values },
	}));
}

/** Drops the `-c core.quotePath=false` the git runner puts in front of every git command. */
const gitArgs = (command: { program: string; args: readonly string[] }): readonly string[] =>
	command.program === "git" && command.args[0] === "-c" ? command.args.slice(2) : command.args;

function scriptGit(
	test: TestContainer,
	options: { taken?: ReadonlySet<string>; currentBranch?: string } = {},
): void {
	const taken = options.taken ?? new Set<string>();
	const currentBranch = options.currentBranch ?? "alpha";
	test.memory.controls.scriptShell((command) => {
		if (command.program !== "git") return null;
		const [first, second] = gitArgs(command);
		if (first === "branch" && second === "--show-current") {
			return ok({ exitCode: 0, stdout: `${currentBranch}\n`, stderr: "" });
		}
		if (first === "show-ref") {
			const ref = gitArgs(command).at(-1) ?? "";
			const name = ref.replace(/^refs\/heads\//, "").replace(/^refs\/remotes\/[^/]+\//, "");
			return ok({ exitCode: taken.has(name) ? 0 : 1, stdout: "", stderr: "" });
		}
		if (first === "remote" && second === "get-url") {
			return ok({ exitCode: 2, stdout: "", stderr: "no remote" });
		}
		if (first === "branch" && second === "-m") {
			return ok({ exitCode: 0, stdout: "", stderr: "" });
		}
		return null;
	});
}

async function setup(
	options: {
		workspace?: Partial<NewWorkspace>;
		prNumber?: number | null;
		displayName?: string | null;
		suggestion?: Result<string | null>;
		taken?: ReadonlySet<string>;
		currentBranch?: string;
	} = {},
) {
	const test = createTestContainer();
	current = test;
	const repo = await seedRepo(test.container, { remoteUrl: null });
	setSettings(test, { branch_prefix_type: "none", branch_prefix_custom: "" });
	const workspace = await seedWorkspace(test.container, {
		repoId: repo.id,
		branch: "alpha",
		branchIsPlaceholder: true,
		path: "/code/alpha",
		...options.workspace,
	});
	if (options.prNumber !== undefined) {
		await test.database.execute("UPDATE workspaces SET pr_number = $1 WHERE id = $2", [
			options.prNumber,
			workspace.id,
		]);
	}
	if (options.displayName !== undefined) {
		await test.database.execute("UPDATE workspaces SET display_name = $1 WHERE id = $2", [
			options.displayName,
			workspace.id,
		]);
	}
	if (options.prNumber !== undefined || options.displayName !== undefined) {
		const reloaded = await test.container.services.workspace.start();
		if (!reloaded.ok) throw new Error(JSON.stringify(reloaded.error));
	}
	scriptGit(test, { taken: options.taken, currentBranch: options.currentBranch });
	const created = await test.container.services.sessions.create(workspace.id, CONFIG);
	if (!created.ok) throw new Error(JSON.stringify(created.error));
	const suggest = vi
		.spyOn(ChatTitleService.prototype, "suggestBranchName")
		.mockResolvedValue(options.suggestion ?? ok("fix-login"));
	return { test, workspace, session: created.value, suggest };
}

const branchRenames = (test: TestContainer) =>
	test.memory.controls.shellCalls.filter((command) => {
		const args = gitArgs(command);
		return command.program === "git" && args[0] === "branch" && args[1] === "-m";
	});

const savedWorkspace = (test: TestContainer, workspace: Workspace) =>
	test.container.services.workspace.store.getState().workspacesById[workspace.id];

const sidecarRequests = (test: TestContainer) =>
	test.memory.controls.sidecarSent.flatMap((line) => {
		try {
			return [JSON.parse(line) as { id?: number; method?: string }];
		} catch {
			return [];
		}
	});

describe("WS-04 Git switches", () => {
	it("WS-04 registers both rename switches under Git with their defaults", () => {
		expect(getSettingDef("auto_rename_new_branches")).toMatchObject({
			page: "git",
			type: "bool",
			default: true,
		});
		expect(getSettingDef("auto_rename_workspace_on_branch_name_set")).toMatchObject({
			page: "git",
			type: "bool",
			default: true,
		});
	});
});

describe("WS-04 branch name suggestion", () => {
	it("WS-04 adds the repository's Rename branch prompt", async () => {
		const { service, requests } = suggestionHarness(ok({ text: "Fix the login flow" }));

		await service.suggestBranchName({
			...branchInput,
			customPrompt: "Use a ticket number when the message has one.",
		});

		const call = requests[0];
		if (call === undefined) throw new Error("no request was made");
		const params = call.params as { prompt: string };
		expect(params.prompt).toContain("Repository instructions for naming the branch:");
		expect(params.prompt).toContain("Use a ticket number when the message has one.");
	});

	it("WS-04 keeps the placeholder for an empty suggestion", async () => {
		const { service } = suggestionHarness(ok({ text: "   " }));

		expect(await service.suggestBranchName(branchInput)).toEqual(ok(null));
	});

	it("WS-04 keeps the placeholder when the suggestion is the escape value", async () => {
		const { service } = suggestionHarness(ok({ text: "<none>" }));

		expect(await service.suggestBranchName(branchInput)).toEqual(ok(null));
	});

	it("WS-04 keeps the placeholder when the suggestion equals the placeholder branch", async () => {
		const { service } = suggestionHarness(ok({ text: "placeholder-branch" }));

		expect(await service.suggestBranchName(branchInput)).toEqual(ok(null));
	});

	it("WS-04 skips a workspace with a linked pull request", async () => {
		const { service, requests } = suggestionHarness(ok({ text: "fix-login" }));

		const result = await service.suggestBranchName({
			...branchInput,
			workspace: sampleWorkspace({ prNumber: 12 }),
		});

		expect(result).toEqual(ok(null));
		expect(requests).toEqual([]);
	});

	it("WS-04 skips a branch that is no longer a placeholder", async () => {
		const { service, requests } = suggestionHarness(ok({ text: "fix-login" }));

		const result = await service.suggestBranchName({
			...branchInput,
			workspace: sampleWorkspace({ branchIsPlaceholder: false }),
		});

		expect(result).toEqual(ok(null));
		expect(requests).toEqual([]);
	});

	it("WS-04 returns the failure when the suggestion call fails", async () => {
		const failure = appError("utility_failed", "The agent did not answer.");
		const { service, logs } = suggestionHarness(err(failure));

		expect(await service.suggestBranchName(branchInput)).toEqual(err(failure));
		expect(logs).toEqual(["Failed to generate a branch name"]);
	});
});

describe("WS-04 rename after the first message", () => {
	it("WS-04 runs the rename from the real first-message send path", async () => {
		const { test, session } = await setup();
		const rename = vi
			.spyOn(test.container.services.workspace, "renameBranchAfterFirstMessage")
			.mockResolvedValue(ok(undefined));
		const started = await test.container.sidecar.start();
		expect(started.ok).toBe(true);
		let answered = false;

		const sending = test.container.services.sessions.send(
			session.id,
			"The login button does nothing",
			[],
			"auto",
		);
		await vi.waitFor(() => {
			if (answered) return;
			const request = sidecarRequests(test).find((sent) => sent.method === "sendMessage");
			if (request?.id === undefined) throw new Error("waiting for sendMessage");
			answered = true;
			test.memory.controls.emitSidecarLine(
				JSON.stringify({
					jsonrpc: "2.0",
					id: request.id,
					result: { deliveredAs: "new_turn" },
				}),
			);
		});

		expect(await sending).toEqual(ok(undefined));
		await vi.waitFor(() =>
			expect(rename).toHaveBeenCalledWith(session.id, "The login button does nothing"),
		);
	});

	it("WS-04 renames the placeholder branch and the workspace", async () => {
		const { test, workspace, session } = await setup();

		const result = await test.container.services.workspace.renameBranchAfterFirstMessage(
			session.id,
			"The login button does nothing",
		);

		expect(result).toEqual(ok(undefined));
		const saved = savedWorkspace(test, workspace);
		expect(saved?.branch).toBe("fix-login");
		expect(saved?.branchIsPlaceholder).toBe(false);
		expect(saved?.displayName).toBe("fix-login");
		expect(branchRenames(test)).toHaveLength(1);
	});

	it("WS-04 takes the next suffix when the branch name is taken", async () => {
		const { test, workspace, session } = await setup({
			taken: new Set(["fix-login"]),
		});

		const result = await test.container.services.workspace.renameBranchAfterFirstMessage(
			session.id,
			"The login button does nothing",
		);

		expect(result).toEqual(ok(undefined));
		expect(savedWorkspace(test, workspace)?.branch).toBe("fix-login-v2");
	});

	it("WS-04 adds the configured branch prefix", async () => {
		const { test, workspace, session } = await setup();
		setSettings(test, { branch_prefix_type: "custom", branch_prefix_custom: "team/" });

		const result = await test.container.services.workspace.renameBranchAfterFirstMessage(
			session.id,
			"The login button does nothing",
		);

		expect(result).toEqual(ok(undefined));
		expect(savedWorkspace(test, workspace)?.branch).toBe("team/fix-login");
	});

	it("WS-04 skips the rename when the setting is off", async () => {
		const { test, workspace, session, suggest } = await setup();
		setSettings(test, { auto_rename_new_branches: false });

		const result = await test.container.services.workspace.renameBranchAfterFirstMessage(
			session.id,
			"The login button does nothing",
		);

		expect(result).toEqual(ok(undefined));
		expect(suggest).not.toHaveBeenCalled();
		expect(savedWorkspace(test, workspace)?.branchIsPlaceholder).toBe(true);
		expect(branchRenames(test)).toEqual([]);
	});

	it("WS-04 skips a workspace with a linked pull request", async () => {
		const { test, workspace, session, suggest } = await setup({ prNumber: 12 });

		const result = await test.container.services.workspace.renameBranchAfterFirstMessage(
			session.id,
			"The login button does nothing",
		);

		expect(result).toEqual(ok(undefined));
		expect(suggest).not.toHaveBeenCalled();
		expect(savedWorkspace(test, workspace)?.branchIsPlaceholder).toBe(true);
	});

	it("WS-04 skips a branch the user or agent already renamed", async () => {
		const { test, workspace, session, suggest } = await setup({
			workspace: { branchIsPlaceholder: false, branch: "someone-else" },
		});

		const result = await test.container.services.workspace.renameBranchAfterFirstMessage(
			session.id,
			"The login button does nothing",
		);

		expect(result).toEqual(ok(undefined));
		expect(suggest).not.toHaveBeenCalled();
		expect(savedWorkspace(test, workspace)?.branch).toBe("someone-else");
	});

	it("WS-04 skips a branch changed in git outside the app", async () => {
		const { test, workspace, session, suggest } = await setup({ currentBranch: "agent-edit" });

		const result = await test.container.services.workspace.renameBranchAfterFirstMessage(
			session.id,
			"The login button does nothing",
		);

		expect(result).toEqual(ok(undefined));
		expect(suggest).not.toHaveBeenCalled();
		expect(savedWorkspace(test, workspace)?.branchIsPlaceholder).toBe(true);
		expect(branchRenames(test)).toEqual([]);
	});

	it("WS-04 keeps the placeholder when generating the suggestion fails", async () => {
		const { test, workspace, session } = await setup({
			suggestion: err(appError("utility_failed", "The agent did not answer.")),
		});

		const result = await test.container.services.workspace.renameBranchAfterFirstMessage(
			session.id,
			"The login button does nothing",
		);

		expect(result).toEqual(ok(undefined));
		expect(savedWorkspace(test, workspace)?.branchIsPlaceholder).toBe(true);
		expect(branchRenames(test)).toEqual([]);
	});

	it("WS-04 keeps a workspace name the user chose", async () => {
		const { test, workspace, session } = await setup({
			displayName: "My login fix",
		});

		const result = await test.container.services.workspace.renameBranchAfterFirstMessage(
			session.id,
			"The login button does nothing",
		);

		expect(result).toEqual(ok(undefined));
		expect(savedWorkspace(test, workspace)?.branch).toBe("fix-login");
		expect(savedWorkspace(test, workspace)?.displayName).toBe("My login fix");
	});

	it("WS-04 leaves the workspace name alone when its setting is off", async () => {
		const { test, workspace, session } = await setup();
		setSettings(test, { auto_rename_workspace_on_branch_name_set: false });

		const result = await test.container.services.workspace.renameBranchAfterFirstMessage(
			session.id,
			"The login button does nothing",
		);

		expect(result).toEqual(ok(undefined));
		expect(savedWorkspace(test, workspace)?.branch).toBe("fix-login");
		expect(savedWorkspace(test, workspace)?.displayName).toBeNull();
	});
});
