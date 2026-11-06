/**
 * @feature AGENT-02 Claude: Agent SDK options
 * Owns: building the Options object for the SDK's query() from a chat's StartOptions.
 * Behaviour: research/conductor/claude-runner.md section 1.2 (option table), 1.3 (environment) and
 * 5 item 1 (the system prompt is the stock preset plus an optional progress-tracker paragraph).
 * Mapping:
 *  - pathToClaudeCodeExecutable: the program the runner chose; a `.js` program starts through node
 *  - cwd: workspace folder; additionalDirectories from the config
 *  - env: StartOptions.env plus CLAUDE_LAUNCH_ENV
 *  - session: a new chat passes sessionId (our session id is also Claude's session id); a chat whose
 *    own id has a transcript on disk resumes that transcript, so a fork request for it is ignored;
 *    a fork or rewind for an id with no transcript yet passes resume, sessionId, resumeSessionAt
 *    and forkSession true
 *  - model, effort, thinking: model id from the config; effort and thinking from launch-settings.ts
 *  - settings, extraArgs: output style, fast mode and ultracode from launch-settings.ts, and the
 *    Chrome flag
 *  - permissionMode: always "bypassPermissions" at start, then set live (permissions.ts)
 *  - systemPrompt: preset claude_code, plus the progress guidance when progressUpdates is on
 *  - settingSources, maxTurns, disallowedTools, toolAliases: constants.ts
 *  - mcpServers: the in-process app tools server (tools/in-process-server.ts)
 *  - hooks: one PreToolUse hook that awaits TurnCallbacks.beforeFirstWrite for writing tools
 *  - canUseTool: the permission handler
 *  - sessionStore with sessionStoreFlush "eager": the steer-receipt mirror
 *  - stderr: drops debug lines, detects the fast-mode refusal, logs the rest
 * Must handle: resume only when a transcript exists on disk (a resume of an unknown id fails the
 * start; the check is I/O and is passed in as `hasTranscript`), a fork request for an id that
 * already has its own transcript (ignored, as in Conductor), the progress guidance only when the
 * switch is on, and no secrets in logs (env is never logged unredacted).
 * Test first: for a new chat the options hold sessionId and no resume; for a chat with a
 * transcript they hold resume and no sessionId.
 */
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { buildClaudeSystemPrompt } from "../../prompt/system-additions.ts";
import type { StartOptions } from "../runner.ts";
import {
	APP_TOOL_NAME_PREFIX,
	CLAUDE_DISALLOWED_TOOLS,
	CLAUDE_LAUNCH_ENV,
	CLAUDE_MAX_TURNS,
	CLAUDE_SETTING_SOURCES,
	CLAUDE_TOOL_ALIASES,
} from "./constants.ts";
import {
	claudeEffortOption,
	claudeExtraArguments,
	claudeSettingsOption,
	claudeThinkingOption,
} from "./launch-settings.ts";

export interface ClaudeOptionsInput {
	start: StartOptions;
	/** Path of the claude program the runner chose (runners/launch-env.ts). */
	executablePath: string;
	/** True when the program is a `.js` file, which the SDK then starts through node. */
	viaRuntime: boolean;
	/** True when ~/.claude/projects/<cwd>/<sessionId>.jsonl exists and holds a conversation. */
	hasTranscript: boolean;
	// The callbacks and servers below are built by claude-session.ts and passed in whole.
	canUseTool: NonNullable<Options["canUseTool"]>;
	hooks: NonNullable<Options["hooks"]>;
	mcpServers: NonNullable<Options["mcpServers"]>;
	sessionStore: NonNullable<Options["sessionStore"]>;
	abortController: AbortController;
	onStderr(line: string): void;
}

export function buildClaudeOptions(input: ClaudeOptionsInput): Options {
	const config = input.start.config;
	return {
		...sessionChoice(input.start, input.hasTranscript),
		abortController: input.abortController,
		pathToClaudeCodeExecutable: input.executablePath,
		...(input.viaRuntime ? { executable: "node" as const } : {}),
		cwd: input.start.workspace.workspacePath,
		env: { ...input.start.env, ...CLAUDE_LAUNCH_ENV },
		model: config.model,
		effort: claudeEffortOption(config.effort),
		thinking: claudeThinkingOption(config.effort),
		settings: claudeSettingsOption(config),
		extraArgs: claudeExtraArguments(config),
		// The process starts bypassing checks and the real mode is switched live (permissions.ts).
		permissionMode: "bypassPermissions",
		allowDangerouslySkipPermissions: true,
		systemPrompt: buildClaudeSystemPrompt(
			config.appTools.progressUpdates,
			`${APP_TOOL_NAME_PREFIX}UpdateProgress`,
		),
		settingSources: [...CLAUDE_SETTING_SOURCES],
		maxTurns: CLAUDE_MAX_TURNS,
		additionalDirectories: [...config.additionalDirectories],
		disallowedTools: [...CLAUDE_DISALLOWED_TOOLS],
		toolAliases: { ...CLAUDE_TOOL_ALIASES },
		canUseTool: input.canUseTool,
		hooks: input.hooks,
		mcpServers: input.mcpServers,
		sessionStore: input.sessionStore,
		sessionStoreFlush: "eager",
		stderr: input.onStderr,
	};
}

/** New, resumed or forked: the session fields that decide which transcript Claude opens. */
function sessionChoice(
	start: StartOptions,
	hasTranscript: boolean,
): Pick<Options, "resume" | "sessionId" | "resumeSessionAt" | "forkSession"> {
	// Our own transcript wins: a fork request for a started session is dropped and we resume it.
	if (hasTranscript) return { resume: start.sessionId };
	const resume = start.resume;
	if (resume === undefined) return { sessionId: start.sessionId };
	if (resume.atNativeMessageId !== undefined) {
		return {
			resume: resume.agentSessionId,
			sessionId: start.sessionId,
			resumeSessionAt: resume.atNativeMessageId,
			forkSession: true,
		};
	}
	// Resuming an id with no transcript would fail the start, so a new session claims our id.
	return { sessionId: start.sessionId };
}
