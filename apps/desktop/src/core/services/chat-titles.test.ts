import type { AgentLaunch } from "@conducted/protocol";
import {
	appError,
	err,
	ok,
	type RepoId,
	type Result,
	type SessionId,
	type WorkspaceId,
} from "@conducted/shared";
import { describe, expect, it } from "vitest";
import type { Session, Workspace } from "../model.ts";
import type { SidecarClient } from "../sidecar/tunnel.ts";
import { ChatTitleService } from "./chat-titles.ts";

const sid = (value: string) => value as SessionId;

function session(changes: Partial<Session> = {}): Session {
	return {
		id: sid("session-1"),
		workspaceId: "workspace-1" as WorkspaceId,
		title: null,
		config: {
			agent: "claude",
			model: "sonnet",
			effort: "medium",
			fastMode: false,
			planMode: false,
			requireToolApproval: false,
			additionalDirectories: [],
			appTools: { diffComments: false, progressUpdates: false, setTargetBranch: false },
		},
		agentSessionId: null,
		unreadCount: 0,
		contextUsedTokens: null,
		contextWindowTokens: null,
		queuePausedAt: null,
		closedAt: null,
		lastUserMessageAt: null,
		createdAt: 0,
		updatedAt: 0,
		...changes,
	};
}

function workspace(changes: Partial<Workspace> = {}): Workspace {
	return {
		id: "workspace-1" as WorkspaceId,
		repoId: "repo-1" as RepoId,
		directoryName: "alpha",
		path: "/work/alpha",
		branch: "placeholder-branch",
		branchIsPlaceholder: true,
		displayName: null,
		targetBranch: "origin/main",
		state: "ready",
		kanbanStatus: "in_progress",
		port: 4100,
		pinnedAt: null,
		notes: null,
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

const launch: AgentLaunch = { env: {}, providerKeys: {} };

interface Harness {
	service: ChatTitleService;
	requests: { method: string; params: unknown }[];
	logs: string[];
}

function harness(
	options: {
		titlesEnabled?: boolean;
		response?: Result<{ text: string }>;
		model?: string | null;
	} = {},
): Harness {
	const requests: { method: string; params: unknown }[] = [];
	const logs: string[] = [];
	const request = (async (method: string, params: unknown) => {
		requests.push({ method, params });
		return options.response ?? ok({ text: "Fix the login flow" });
	}) as SidecarClient["request"];
	const service = new ChatTitleService({
		sidecar: { request },
		titlesEnabled: () => options.titlesEnabled ?? true,
		cheapestModel: () => (options.model === undefined ? "cheap-model" : options.model),
		launchFor: () => launch,
		log: (_level, message) => logs.push(message),
	});
	return { service, requests, logs };
}

const titleInput = {
	session: session(),
	workspace: workspace(),
	firstUserMessage: "The login button does nothing",
	firstAnswer: "I found the handler and fixed the submit path.",
};

const branchInput = {
	session: session(),
	workspace: workspace(),
	firstUserMessage: "The login button does nothing",
};

describe("SIDE-24 chat titles", () => {
	it("SIDE-24 sends no request when AI generated titles are off", async () => {
		const { service, requests } = harness({ titlesEnabled: false });

		expect(await service.suggestChatTitle(titleInput)).toEqual(ok(null));
		expect(await service.suggestBranchName(branchInput)).toEqual(ok(null));
		expect(requests).toEqual([]);
	});

	it("SIDE-24 asks the chat's own agent with the cheapest model and returns the title", async () => {
		const { service, requests } = harness();

		expect(await service.suggestChatTitle(titleInput)).toEqual(ok("Fix the login flow"));
		expect(requests).toHaveLength(1);
		const call = requests[0];
		if (call === undefined) throw new Error("no request was made");
		expect(call.method).toBe("runUtilityPrompt");
		expect(call.params).toMatchObject({
			agent: "claude",
			model: "cheap-model",
			cwd: "/work/alpha",
			launch,
		});
	});

	it("SIDE-24 skips a chat the user already named", async () => {
		const { service, requests } = harness();

		expect(
			await service.suggestChatTitle({ ...titleInput, session: session({ title: "My chat" }) }),
		).toEqual(ok(null));
		expect(requests).toEqual([]);
	});

	it("SIDE-24 skips an empty first answer or one that is the placeholder", async () => {
		const { service, requests } = harness();

		expect(await service.suggestChatTitle({ ...titleInput, firstAnswer: "   " })).toEqual(ok(null));
		expect(await service.suggestChatTitle({ ...titleInput, firstAnswer: "New chat" })).toEqual(
			ok(null),
		);
		expect(requests).toEqual([]);
	});

	it("SIDE-24 turns an empty answer into no title", async () => {
		const { service } = harness({ response: ok({ text: "  " }) });

		expect(await service.suggestChatTitle(titleInput)).toEqual(ok(null));
	});

	it("SIDE-24 strips quotes and keeps the first line of the answer", async () => {
		const { service } = harness({ response: ok({ text: '"Fix the login flow"\nExtra words' }) });

		expect(await service.suggestChatTitle(titleInput)).toEqual(ok("Fix the login flow"));
	});

	it("SIDE-24 logs the failure and returns it when the sidecar call fails", async () => {
		const failure = appError("rpc_timeout", "The sidecar did not answer");
		const { service, logs } = harness({ response: err(failure) });

		expect(await service.suggestChatTitle(titleInput)).toEqual(err(failure));
		expect(logs).toContain("Failed to generate LLM session title");
	});

	it("SIDE-24 returns an error and sends nothing when the agent has no model", async () => {
		const { service, requests, logs } = harness({ model: null });

		const result = await service.suggestChatTitle(titleInput);

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("utility_model_missing");
		expect(requests).toEqual([]);
		expect(logs).toContain("Failed to generate LLM session title");
	});

	it("SIDE-24 cuts a title at 80 characters", async () => {
		const { service } = harness({ response: ok({ text: "a".repeat(100) }) });

		expect(await service.suggestChatTitle(titleInput)).toEqual(ok("a".repeat(80)));
	});

	it("SIDE-24 keeps the placeholder when the agent returns the placeholder", async () => {
		const { service } = harness({ response: ok({ text: "New chat" }) });

		expect(await service.suggestChatTitle(titleInput)).toEqual(ok(null));
	});

	it("SIDE-24 passes the chat's fast-mode switch to the call", async () => {
		const { service, requests } = harness();
		const base = session();

		await service.suggestChatTitle({
			...titleInput,
			session: { ...base, config: { ...base.config, fastMode: true } },
		});

		const call = requests[0];
		if (call === undefined) throw new Error("no request was made");
		expect(call.params).toMatchObject({ fastMode: true });
	});
});

describe("SIDE-24 branch names", () => {
	it("SIDE-24 asks the chat's own agent and returns a safe branch name", async () => {
		const { service, requests } = harness({ response: ok({ text: "Fix Login Flow" }) });

		expect(await service.suggestBranchName(branchInput)).toEqual(ok("fix-login-flow"));
		const call = requests[0];
		if (call === undefined) throw new Error("no request was made");
		expect(call.params).toMatchObject({
			agent: "claude",
			model: "cheap-model",
			cwd: "/work/alpha",
			launch,
		});
	});

	it("SIDE-24 honours the escape hatch", async () => {
		const { service } = harness({ response: ok({ text: "<none>" }) });

		expect(await service.suggestBranchName(branchInput)).toEqual(ok(null));
	});

	it("SIDE-24 skips a branch the user named or one that already changed", async () => {
		const { service, requests } = harness();

		expect(
			await service.suggestBranchName({
				...branchInput,
				workspace: workspace({ branchIsPlaceholder: false }),
			}),
		).toEqual(ok(null));
		expect(requests).toEqual([]);
	});

	it("SIDE-24 skips a workspace with a linked pull request", async () => {
		const { service, requests } = harness();

		expect(
			await service.suggestBranchName({
				...branchInput,
				workspace: workspace({ prNumber: 42 }),
			}),
		).toEqual(ok(null));
		expect(requests).toEqual([]);
	});

	it("SIDE-24 skips an empty first message", async () => {
		const { service, requests } = harness();

		expect(await service.suggestBranchName({ ...branchInput, firstUserMessage: "  " })).toEqual(
			ok(null),
		);
		expect(requests).toEqual([]);
	});

	it("SIDE-24 keeps the placeholder when the answer matches it", async () => {
		const { service } = harness({ response: ok({ text: "placeholder-branch" }) });

		expect(await service.suggestBranchName(branchInput)).toEqual(ok(null));
	});

	it("SIDE-24 logs the failure and returns it when the branch call fails", async () => {
		const failure = appError("agent_auth_required", "Sign in to Claude Code");
		const { service, logs } = harness({ response: err(failure) });

		expect(await service.suggestBranchName(branchInput)).toEqual(err(failure));
		expect(logs).toContain("Failed to generate a branch name");
	});

	it("SIDE-24 returns an error and sends nothing when the branch has no model", async () => {
		const { service, requests, logs } = harness({ model: null });

		const result = await service.suggestBranchName(branchInput);

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("utility_model_missing");
		expect(requests).toEqual([]);
		expect(logs).toContain("Failed to generate a branch name");
	});

	it("SIDE-24 cuts a branch name at 30 characters and trims a trailing separator", async () => {
		const { service } = harness({ response: ok({ text: `${"a".repeat(29)}-b` }) });

		expect(await service.suggestBranchName(branchInput)).toEqual(ok("a".repeat(29)));
	});

	it("SIDE-24 replaces characters outside the branch-name set", async () => {
		const { service } = harness({ response: ok({ text: "Fix: Login! Now?" }) });

		expect(await service.suggestBranchName(branchInput)).toEqual(ok("fix-login-now"));
	});
});
