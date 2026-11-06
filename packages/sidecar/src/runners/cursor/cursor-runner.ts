/**
 * @feature AGENT-09 Cursor: SDK in process (runner)
 * Owns: the Runner for Cursor: detecting whether it can run, starting a CursorSession, the model
 * list, and the user's Cursor MCP servers.
 * Behaviour: research/conductor/other-runners.md sections 2.3, 5 and 6: Cursor has no list call, so
 * the model catalog is static; no slash commands, no MCP listing, no context usage; the API key
 * is the CURSOR_API_KEY variable of the chat's start environment (`StartOptions.env`), where the
 * launch puts the key the user entered or chose from this Mac (SIDE-21, D033). The shell-env
 * capture strips it from the login shell, and the sidecar's own environment is never read for it.
 * A user's own MCP servers in ~/.cursor/mcp.json and <workspace>/.cursor/mcp.json are read and
 * forwarded, with the workspace file winning on a shared name.
 * Must handle:
 *  - detect(): the `cursor-agent` program on PATH is optional; the runner works through the SDK,
 *    so detect() reports the SDK's presence when it can load, else null
 *  - listModels(): a static list owned by this file, taken from Cursor's published model list
 *  - the user's MCP files: a missing file is fine, a broken file is logged and skipped; ${env:NAME},
 *    ${NAME} and ${NAME:-default} are filled from the environment; a server without a command or a
 *    url is dropped with a warning naming it, and the rest stay; remote fields such as headers, an
 *    OAuth client and a CA bundle are kept as they are
 *  - the local run store: when the sidecar has CONDUCTED_CURSOR_STORE_DIR, each workspace gets its
 *    own folder under cursor-sdk-store/<hash of the workspace path>
 *  - capabilities: steer true (when the run supports it), interrupt true, everything else false
 * Test first: capabilities.resumeAt is false and slashCommands is false.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Effort, ModelInfo } from "@conducted/protocol";
import type { Logger } from "../../logging/logger.ts";
import { messageOf } from "../../util/errors.ts";
import type { RunnerCommonDeps } from "../deps.ts";
import type { AgentSession, Runner, RunnerCapabilities, StartOptions } from "../runner.ts";
import type { LoadCursorSdk } from "./cursor-sdk.ts";
import { CURSOR_LOG_TAG, CursorSession } from "./cursor-session.ts";
import type { EnvLock } from "./env-lock.ts";
import { CursorTranslator } from "./translate.ts";

export type CursorRunnerDeps = RunnerCommonDeps & {
	loadSdk: LoadCursorSdk;
	envLock: EnvLock;
};

/** The effort levels Cursor accepts, from other-runners.md section 5. */
const CURSOR_EFFORTS: readonly Effort[] = ["low", "medium", "high", "xhigh"];

/**
 * Cursor has no model-list call. These entries come from Cursor's published model list
 * (docs.cursor.com/models), read on 2026-11-06; the ids are the page slugs.
 */
export const CURSOR_MODELS: readonly ModelInfo[] = [
	{
		id: "cursor-composer-2-5",
		label: "Composer 2.5",
		status: "picker",
		isNew: false,
		isDefault: true,
		efforts: [...CURSOR_EFFORTS],
		defaultEffort: "medium",
		effortAxis: "effort",
		liveEffortChange: false,
		supportsFastMode: true,
	},
	{
		id: "claude-sonnet-5-5",
		label: "Claude Sonnet 5.5",
		status: "picker",
		isNew: false,
		isDefault: false,
		efforts: [...CURSOR_EFFORTS],
		defaultEffort: "medium",
		effortAxis: "effort",
		liveEffortChange: false,
		supportsFastMode: false,
	},
	{
		id: "gpt-5-6-sol",
		label: "GPT-5.6 Sol",
		status: "picker",
		isNew: false,
		isDefault: false,
		efforts: [...CURSOR_EFFORTS],
		defaultEffort: "medium",
		effortAxis: "effort",
		liveEffortChange: false,
		supportsFastMode: false,
	},
	{
		id: "gemini-3-1-pro",
		label: "Gemini 3.1 Pro",
		status: "picker",
		isNew: false,
		isDefault: false,
		efforts: [...CURSOR_EFFORTS],
		defaultEffort: "medium",
		effortAxis: "effort",
		liveEffortChange: false,
		supportsFastMode: false,
	},
];

const ENV_PLACEHOLDER =
	/\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}|\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;

/** The folder for one workspace's Cursor local run store. */
export function cursorStoreFolder(root: string, workspacePath: string): string {
	const digest = createHash("sha256").update(workspacePath).digest("hex").slice(0, 16);
	return path.join(root, "cursor-sdk-store", digest);
}

/** Fills ${env:NAME}, ${NAME} and ${NAME:-default} from the environment, in every string. */
export function expandCursorEnv(value: unknown, env: Readonly<Record<string, string>>): unknown {
	if (typeof value === "string") {
		return value.replace(
			ENV_PLACEHOLDER,
			(_whole, envName: string | undefined, plain: string | undefined, fallback?: string) => {
				const name = envName ?? plain ?? "";
				const found = env[name];
				if (found !== undefined && found !== "") return found;
				return fallback ?? "";
			},
		);
	}
	if (Array.isArray(value)) return value.map((entry) => expandCursorEnv(entry, env));
	if (isRecord(value)) {
		const out: Record<string, unknown> = {};
		for (const [name, entry] of Object.entries(value)) out[name] = expandCursorEnv(entry, env);
		return out;
	}
	return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCursorMcpServer(value: unknown): boolean {
	if (!isRecord(value)) return false;
	const command = value.command;
	if (typeof command === "string" && command !== "") return true;
	const url = value.url;
	return typeof url === "string" && url !== "";
}

/**
 * Reads the user's and the workspace's Cursor MCP files and merges them, the workspace winning.
 * A missing file is null; any other read or parse failure is logged and that file is skipped.
 */
export async function readCursorMcpServers(input: {
	home: string | undefined;
	workspacePath: string;
	env: Readonly<Record<string, string>>;
	logger: Logger;
}): Promise<Record<string, unknown>> {
	const files: string[] = [];
	if (input.home !== undefined && input.home !== "") {
		files.push(path.join(input.home, ".cursor", "mcp.json"));
	}
	files.push(path.join(input.workspacePath, ".cursor", "mcp.json"));

	const merged: Record<string, unknown> = {};
	for (const file of files) {
		let text: string | null;
		try {
			text = await readFile(file, "utf8");
		} catch (cause) {
			if ((cause as NodeJS.ErrnoException).code === "ENOENT") continue;
			input.logger.warn("Could not read a Cursor MCP file; skipping it", {
				file,
				reason: messageOf(cause),
			});
			continue;
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch (cause) {
			input.logger.warn("Ignoring a Cursor MCP file that is not valid JSON", {
				file,
				reason: messageOf(cause),
			});
			continue;
		}
		if (!isRecord(parsed) || !isRecord(parsed.mcpServers)) {
			input.logger.warn("Ignoring a Cursor MCP file with no mcpServers object", { file });
			continue;
		}
		for (const [name, server] of Object.entries(parsed.mcpServers)) {
			const expanded = expandCursorEnv(server, input.env);
			if (!isCursorMcpServer(expanded)) {
				input.logger.warn("Dropped a Cursor MCP server that is not valid", {
					file,
					server: name,
				});
				continue;
			}
			merged[name] = expanded;
		}
	}
	input.logger.debug("Forwarded Cursor MCP servers", {
		servers: Object.keys(merged).length,
	});
	return merged;
}

export class CursorRunner implements Runner {
	readonly agent = "cursor" as const;
	readonly capabilities: RunnerCapabilities = {
		steer: true,
		interrupt: true,
		resumeAt: false,
		liveConfig: false,
		slashCommands: false,
		mcpServers: false,
		contextUsage: false,
	};

	private readonly log: Logger;

	constructor(protected readonly deps: CursorRunnerDeps) {
		this.log = deps.logger.child(CURSOR_LOG_TAG);
	}

	async detect(
		env: Readonly<Record<string, string>>,
	): Promise<{ path: string; version: string } | null> {
		const loaded = await this.deps.loadSdk();
		if (!loaded.ok) {
			this.log.debug("Cursor's SDK is not available", { code: loaded.error.code });
			return null;
		}
		this.log.debug("Cursor's SDK is available", { env: Object.keys(env).length });
		return { path: "@cursor/sdk", version: "" };
	}

	async start(options: StartOptions): Promise<AgentSession> {
		const storeRoot = process.env.CONDUCTED_CURSOR_STORE_DIR;
		const storeDir =
			storeRoot === undefined || storeRoot === ""
				? undefined
				: cursorStoreFolder(storeRoot, options.workspace.workspacePath);
		const mcpServers = await readCursorMcpServers({
			home: options.env.HOME,
			workspacePath: options.workspace.workspacePath,
			env: options.env,
			logger: this.log,
		});
		return new CursorSession(
			{
				loadSdk: this.deps.loadSdk,
				envLock: this.deps.envLock,
				translator: new CursorTranslator({ logger: this.log }),
				apiKey: options.env.CURSOR_API_KEY,
				mcpServers,
				...(storeDir === undefined ? {} : { storeDir }),
				logger: this.deps.logger,
			},
			options,
		);
	}

	listModels(): Promise<ModelInfo[]> {
		return Promise.resolve(CURSOR_MODELS.map((model) => ({ ...model })));
	}

	listSlashCommands(
		_workspacePath: string,
	): Promise<{ name: string; description: string; argumentHint?: string }[]> {
		return Promise.resolve([]);
	}
}
