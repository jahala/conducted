import { describe, expect, test } from "bun:test";
import type {
	CanUseTool,
	HookCallbackMatcher,
	Options,
	SessionStore,
} from "@anthropic-ai/claude-agent-sdk";
import type { SessionConfig, WorkspaceContext } from "@conducted/protocol";
import type { SessionId, WorkspaceId } from "@conducted/shared";
import type { StartOptions } from "../runner.ts";
import { CLAUDE_MAX_TURNS, CLAUDE_SETTING_SOURCES } from "./constants.ts";
import { buildClaudeOptions, type ClaudeOptionsInput } from "./options.ts";

function config(overrides: Partial<SessionConfig> = {}): SessionConfig {
	return {
		agent: "claude",
		model: "claude-sonnet-5",
		effort: "high",
		fastMode: false,
		planMode: false,
		requireToolApproval: false,
		additionalDirectories: ["/work/other"],
		appTools: { diffComments: false, progressUpdates: false, setTargetBranch: false },
		...overrides,
	};
}

function workspace(): WorkspaceContext {
	return {
		workspaceId: "w1" as WorkspaceId,
		workspaceName: "app",
		workspacePath: "/work/app",
		repoRootPath: "/work/repo",
		targetBranch: "origin/main",
		placeholderBranch: false,
		port: 4100,
	};
}

function start(overrides: Partial<StartOptions> = {}): StartOptions {
	return {
		sessionId: "s1" as SessionId,
		config: config(),
		workspace: workspace(),
		env: { PATH: "/usr/bin", ANTHROPIC_API_KEY: "secret" },
		...overrides,
	};
}

function input(overrides: Partial<ClaudeOptionsInput> = {}): ClaudeOptionsInput {
	return {
		start: start(),
		executablePath: "/bin/claude",
		hasTranscript: false,
		canUseTool: (async () => ({
			behavior: "allow",
			updatedInput: {},
		})) as unknown as CanUseTool,
		hooks: {
			PreToolUse: [{ hooks: [async () => ({})] } as unknown as HookCallbackMatcher],
		},
		mcpServers: {},
		sessionStore: {
			append: async () => {},
			load: async () => null,
		} satisfies SessionStore,
		abortController: new AbortController(),
		onStderr: () => {},
		...overrides,
	};
}

describe("AGENT-02 Claude SDK options", () => {
	test("a new chat holds our session id and no resume", () => {
		const options = buildClaudeOptions(input());
		expect(options.sessionId).toBe("s1");
		expect(options.resume).toBeUndefined();
		expect(options.resumeSessionAt).toBeUndefined();
		expect(options.forkSession).toBeUndefined();
	});

	test("a chat with a transcript resumes and passes no session id", () => {
		const options = buildClaudeOptions(
			input({ start: start({ resume: { agentSessionId: "s1" } }), hasTranscript: true }),
		);
		expect(options.resume).toBe("s1");
		expect(options.sessionId).toBeUndefined();
	});

	test("a resume with no transcript on disk starts a new session under our id", () => {
		const options = buildClaudeOptions(
			input({ start: start({ resume: { agentSessionId: "s1" } }), hasTranscript: false }),
		);
		expect(options.sessionId).toBe("s1");
		expect(options.resume).toBeUndefined();
	});

	test("a fork passes resume, session id, the resume point and forkSession", () => {
		const options = buildClaudeOptions(
			input({
				start: start({
					resume: { agentSessionId: "source-session", atNativeMessageId: "message-5" },
				}),
				hasTranscript: true,
			}),
		);
		expect(options).toMatchObject({
			resume: "source-session",
			sessionId: "s1",
			resumeSessionAt: "message-5",
			forkSession: true,
		});
	});

	test("the fixed options match the research", () => {
		const options = buildClaudeOptions(input());
		expect(options).toMatchObject({
			pathToClaudeCodeExecutable: "/bin/claude",
			cwd: "/work/app",
			model: "claude-sonnet-5",
			permissionMode: "bypassPermissions",
			allowDangerouslySkipPermissions: true,
			maxTurns: CLAUDE_MAX_TURNS,
			additionalDirectories: ["/work/other"],
			sessionStoreFlush: "eager",
		});
		expect(options.settingSources).toEqual([...CLAUDE_SETTING_SOURCES]);
		expect(options.disallowedTools).toContain("AskUserQuestion");
		expect(options.toolAliases?.AskUserQuestion).toBe("mcp__conducted__AskUserQuestion");
		expect(options.env).toMatchObject({
			PATH: "/usr/bin",
			CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: "1",
		});
	});

	test("the system prompt is the stock preset, with progress guidance only when the switch is on", () => {
		const off = buildClaudeOptions(input());
		expect(off.systemPrompt).toEqual({ type: "preset", preset: "claude_code" });

		const on = buildClaudeOptions(
			input({
				start: start({
					config: config({
						appTools: {
							diffComments: false,
							progressUpdates: true,
							setTargetBranch: false,
						},
					}),
				}),
			}),
		);
		const prompt = on.systemPrompt as { type: string; preset: string; append?: string };
		expect(prompt.type).toBe("preset");
		expect(prompt.append).toContain("mcp__conducted__UpdateProgress");
	});

	test("effort none disables thinking, ultracode sends no effort, other levels pass through", () => {
		const none = buildClaudeOptions(
			input({ start: start({ config: config({ effort: "none" }) }) }),
		);
		expect(none.effort).toBeUndefined();
		expect(none.thinking).toEqual({ type: "disabled" });

		const high = buildClaudeOptions(
			input({ start: start({ config: config({ effort: "high" }) }) }),
		);
		expect(high.effort).toBe("high");
		expect(high.thinking).toEqual({ type: "adaptive", display: "summarized" });

		const ultracode = buildClaudeOptions(
			input({ start: start({ config: config({ effort: "ultracode" }) }) }),
		);
		expect(ultracode.effort).toBeUndefined();
	});

	test("options the research leaves unset are absent", () => {
		const options: Options = buildClaudeOptions(input());
		expect(options.includePartialMessages).toBeUndefined();
		expect(options.includeHookEvents).toBeUndefined();
		expect(options.allowedTools).toBeUndefined();
		expect(options.fallbackModel).toBeUndefined();
		expect(options.maxBudgetUsd).toBeUndefined();
		expect(options.persistSession).toBeUndefined();
	});
});
