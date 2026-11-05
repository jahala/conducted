/**
 * @feature AGENT-02 Claude: Agent SDK in streaming-input mode, resume, fork
 * Owns: the Runner for Claude Code: finding the program, its version and sign-in state, starting a
 * ClaudeSession, listing models and slash commands.
 * Behaviour: research/conductor/claude-runner.md sections 1 and 7 and decision 7 in
 * docs/plans/scaffold.md. Provider routing and the `claude auth status --json` call belong to
 * SIDE-21 (runners/launch-env.ts) and SIDE-15 (models/agent-detection.ts).
 * Must handle:
 *  - detect(): `claude` not on PATH gives null; `claude --version` that hangs gives an error value
 *    after 5 s, reported as installed without a version by the detector
 *  - start() with a missing workspace folder: an error that names the folder
 *  - listModels(): from supportedModels() of a throwaway metadata query; efforts from
 *    supportedEffortLevels, fast mode from supportsFastMode; the default effort is the middle of
 *    the list when the SDK gives none
 *  - listSlashCommands(): from supportedCommands() of a throwaway metadata query; the throwaway
 *    query is always ended, even on error
 *  - capabilities are fixed: steer, interrupt, resumeAt, liveConfig, slashCommands, mcpServers and
 *    contextUsage are all supported
 * Test first: detect() with a findExecutable that returns null resolves to null without probing.
 */
import type {
	Query,
	SDKUserMessage,
	ModelInfo as SdkModelInfo,
} from "@anthropic-ai/claude-agent-sdk";
import type { Effort, ModelInfo } from "@conducted/protocol";
import { appError } from "@conducted/shared";
import { parseVersion, VERSION_PROBE_TIMEOUT_MS } from "../../models/agent-detection.ts";
import { AGENT_NOT_INSTALLED } from "../../models/catalog.ts";
import type { RunnerCommonDeps } from "../deps.ts";
import type { AgentSession, Runner, RunnerCapabilities, StartOptions } from "../runner.ts";
import { ClaudeSession, type ClaudeSessionDeps } from "./claude-session.ts";
import { CLAUDE_SETTING_SOURCES } from "./constants.ts";
import type { ClaudeTranslator } from "./translate.ts";

/** Builds the translator a new ClaudeSession owns, so two chats never share its state. */
export type ClaudeTranslatorFactory = () => ClaudeTranslator;

export type ClaudeRunnerDeps = RunnerCommonDeps &
	Omit<
		Pick<
			ClaudeSessionDeps,
			| "query"
			| "translator"
			| "appTools"
			| "hasTranscript"
			| "realPath"
			| "newUuid"
			| "scheduler"
			| "createCanUseTool"
			| "createMcpServers"
		>,
		"translator"
	> & {
		/**
		 * A translator for one chat, or a template whose fresh() builds each chat's translator.
		 * The composition root passes an instance or a factory; either way every session gets its
		 * own state.
		 */
		translator: ClaudeTranslator | ClaudeTranslatorFactory;
	};

export class ClaudeRunner implements Runner {
	readonly agent = "claude" as const;
	readonly capabilities: RunnerCapabilities = {
		steer: true,
		interrupt: true,
		resumeAt: true,
		liveConfig: true,
		slashCommands: true,
		mcpServers: true,
		contextUsage: true,
	};

	private lastEnv: Readonly<Record<string, string>> = {};

	constructor(protected readonly deps: ClaudeRunnerDeps) {}

	async detect(
		env: Readonly<Record<string, string>>,
	): Promise<{ path: string; version: string } | null> {
		this.lastEnv = env;
		const path = await this.deps.findExecutable("claude", env);
		if (path === null) return null;
		const probed = await this.deps.probe(path, ["--version"], {
			env,
			timeoutMs: VERSION_PROBE_TIMEOUT_MS,
		});
		if (!probed.ok) {
			// Reported as installed but without a version, as the detector expects.
			this.deps.logger.warn("Could not read the Claude version", {
				path,
				code: probed.error.code,
			});
			return { path, version: "" };
		}
		return {
			path,
			version: parseVersion(probed.value.stdout || probed.value.stderr) ?? "",
		};
	}

	async start(options: StartOptions): Promise<AgentSession> {
		const requested = options.workspace.workspacePath;
		const resolved = await this.deps.realPath(requested);
		if (resolved === null) {
			throw appError("workspace_missing", `Workspace directory missing: ${requested}`);
		}
		if (resolved !== requested) {
			// Claude names its transcript folder from the real path, so resume must use it too.
			this.deps.logger.warn("Workspace path resolves through a symlink", {
				path: requested,
				realPath: resolved,
			});
		}
		const executablePath = await this.deps.findExecutable("claude", options.env);
		if (executablePath === null) {
			throw claudeNotInstalled();
		}
		const start =
			resolved === requested
				? options
				: { ...options, workspace: { ...options.workspace, workspacePath: resolved } };
		// One translator per chat. A template is cloned so its state belongs to this session.
		const source = this.deps.translator;
		const translator =
			typeof source === "function"
				? source()
				: typeof source.fresh === "function"
					? source.fresh()
					: source;
		return new ClaudeSession({ ...this.deps, executablePath, translator }, start);
	}

	async listModels(): Promise<ModelInfo[]> {
		const executablePath = await this.requireExecutable();
		const metadata = this.metadataQuery(executablePath);
		try {
			const models = await metadata.query.supportedModels();
			return models.map(toModelInfo);
		} finally {
			metadata.end();
		}
	}

	async listSlashCommands(
		workspacePath: string,
	): Promise<{ name: string; description: string; argumentHint?: string }[]> {
		const executablePath = await this.requireExecutable();
		const metadata = this.metadataQuery(executablePath, workspacePath);
		try {
			const commands = await metadata.query.supportedCommands();
			return commands.map((command) => ({
				name: command.name,
				description: command.description,
				...(command.argumentHint === "" ? {} : { argumentHint: command.argumentHint }),
			}));
		} finally {
			metadata.end();
		}
	}

	private async requireExecutable(): Promise<string> {
		const path = await this.deps.findExecutable("claude", this.lastEnv);
		if (path === null) throw claudeNotInstalled();
		return path;
	}

	/**
	 * A throwaway query for asking the CLI about models or slash commands. Its prompt never yields,
	 * and `end()` aborts the process so nothing is left behind.
	 */
	private metadataQuery(executablePath: string, cwd?: string): { query: Query; end(): void } {
		const abort = new AbortController();
		const prompt = createMetadataPrompt();
		const query = this.deps.query({
			prompt: prompt.iterable,
			options: {
				abortController: abort,
				pathToClaudeCodeExecutable: executablePath,
				env: { ...this.lastEnv },
				permissionMode: "default",
				settingSources: [...CLAUDE_SETTING_SOURCES],
				...(cwd === undefined ? {} : { cwd }),
			},
		});
		return {
			query,
			end: () => {
				prompt.finish();
				abort.abort();
			},
		};
	}
}

/** One home for the error both start() and the metadata queries return. */
function claudeNotInstalled() {
	return appError(
		AGENT_NOT_INSTALLED,
		"Claude Code was not found. Install it in settings and try again.",
	);
}

const EFFORT_LEVELS: ReadonlySet<string> = new Set([
	"none",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
	"ultra",
	"ultracode",
]);

function isOurEffort(value: string): value is Effort {
	return EFFORT_LEVELS.has(value);
}

function toModelInfo(model: SdkModelInfo): ModelInfo {
	const efforts = (model.supportedEffortLevels ?? []).filter(isOurEffort);
	// The middle of the levels offered is the least surprising default when the SDK names none.
	const middle = efforts[Math.floor((efforts.length - 1) / 2)];
	return {
		id: model.value,
		label: model.displayName,
		status: "picker",
		isNew: false,
		isDefault: false,
		efforts,
		defaultEffort: middle ?? "medium",
		effortAxis: "effort",
		liveEffortChange: efforts.length > 0,
		supportsFastMode: model.supportsFastMode ?? false,
	};
}

/** A prompt that yields nothing until `finish()` is called, for a metadata-only query. */
function createMetadataPrompt(): { iterable: AsyncIterable<SDKUserMessage>; finish(): void } {
	let finish: () => void = () => {};
	const done = new Promise<void>((resolve) => {
		finish = resolve;
	});
	const iterable: AsyncIterable<SDKUserMessage> = {
		[Symbol.asyncIterator]() {
			return {
				next: () => done.then(() => ({ value: undefined, done: true })),
			};
		},
	};
	return { iterable, finish };
}
