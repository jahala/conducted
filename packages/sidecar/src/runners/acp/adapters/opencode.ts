/**
 * @feature AGENT-12 ACP adapters for OpenCode and Pi: OpenCode
 * Owns: the OpenCode descriptor.
 * Behaviour: research/conductor/other-runners.md section 2.2: the command is `opencode acp`; the
 * minimum version is 1.16.2; the model list can take up to 15 s to arrive after session/new;
 * the approval policy goes in through the environment variable OPENCODE_CONFIG_CONTENT with a
 * permission wildcard set to "ask" or "allow". OpenCode 1 reads the MCP tool timeout from
 * `experimental.mcp_timeout`, checked in the installed 1.18.18. OpenCode 2 is reported in the
 * inventory as reading `mcp.timeout.execution`; that key was not checked against a 2.x build here.
 * Both get 10 minutes, so a tool that waits for a person, such as AskUserQuestion, does not time out.
 * Checked on this Mac: `opencode acp` exists in opencode 1.18.18 and lists --cwd, --port and
 * --log-level.
 * Must handle: permissionEnv must produce valid JSON for OPENCODE_CONFIG_CONTENT, must merge with
 * (not replace) a value the user already has in their environment, must never log the value, must
 * report an invalid existing value instead of dropping it, and must report a missing or unparseable
 * agent version instead of assuming a config shape. A prompt with an unknown slash command is
 * refused before it is sent; a path such as "/Users/me/file.ts" is not a command. Session storage
 * points the agent at a folder in the workspace and uses a stable id prefix.
 * Test first: id, command and minimum version are as stated; permissionEnv returns JSON that
 * parses.
 * Our design choice: the storage folder is `.context/opencode` inside the workspace, and the
 * prefix is "opencode-". The database path uses OpenCode's documented OPENCODE_DB variable.
 */
import { join } from "node:path";
import { type AppError, appError, err, ok, type Result } from "@conducted/shared";
import { safeJsonParse } from "../../output.ts";
import type { AcpAdapter, AcpAdapterContext, AcpSessionStorage } from "./adapter.ts";

/** OpenCode's MCP tool timeout floor: ten minutes, so a question can wait for a person. */
export const OPENCODE_MCP_TOOL_TIMEOUT_MS = 600_000;

/** The environment variable OpenCode reads inline configuration from. */
export const OPENCODE_CONFIG_CONTENT = "OPENCODE_CONFIG_CONTENT";

function majorVersion(version: string): number | null {
	const major = Number.parseInt(version.split(".")[0] ?? "", 10);
	return Number.isFinite(major) ? major : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Deep merge so the user's other config keys survive; our policy and timeout keys win. */
function mergeConfig(
	base: Record<string, unknown>,
	required: Record<string, unknown>,
): Record<string, unknown> {
	const merged: Record<string, unknown> = { ...base };
	for (const [key, value] of Object.entries(required)) {
		const current = merged[key];
		merged[key] = isRecord(current) && isRecord(value) ? mergeConfig(current, value) : value;
	}
	return merged;
}

/** The user's own MCP timeout, so the policy raises it and never lowers it. */
function existingTimeout(base: Record<string, unknown>, major: number): number | undefined {
	if (major >= 2) {
		const mcp = base.mcp;
		if (!isRecord(mcp)) return undefined;
		const timeout = mcp.timeout;
		if (!isRecord(timeout)) return undefined;
		return typeof timeout.execution === "number" ? timeout.execution : undefined;
	}
	const experimental = base.experimental;
	if (!isRecord(experimental)) return undefined;
	return typeof experimental.mcp_timeout === "number" ? experimental.mcp_timeout : undefined;
}

/** The config OpenCode needs for this app's policy and a long enough MCP tool timeout. */
export function opencodeConfig(
	requireToolApproval: boolean,
	major: number,
	timeoutMs: number = OPENCODE_MCP_TOOL_TIMEOUT_MS,
): Record<string, unknown> {
	const config: Record<string, unknown> = {
		permission: { "*": requireToolApproval ? "ask" : "allow" },
	};
	if (major >= 2) {
		config.mcp = { timeout: { execution: timeoutMs } };
	} else {
		config.experimental = { mcp_timeout: timeoutMs };
	}
	return config;
}

function checkSlashCommand(
	text: string,
	availableCommands: readonly string[],
): Result<void, AppError> {
	if (availableCommands.length === 0) return ok(undefined);
	const match = /^\s*\/([^\s]+)/.exec(text);
	if (match === null) return ok(undefined);
	const name = match[1] ?? "";
	if (name.includes("/")) return ok(undefined);
	if (availableCommands.includes(name)) return ok(undefined);
	return err(
		appError(
			"opencode_command_unknown",
			`OpenCode does not know the command "/${name}". Choose one of its available commands.`,
		),
	);
}

export const opencodeAdapter: AcpAdapter = {
	id: "opencode",
	displayName: "OpenCode",
	command: { executable: "opencode", args: ["acp"] },
	versionArgs: ["--version"],
	minimumVersion: "1.16.2",
	toolNameHints: {},
	waitForModelCatalogMs: 15_000,
	permissionEnv(
		requireToolApproval: boolean,
		context: AcpAdapterContext = {},
	): Result<Record<string, string>, AppError> {
		const version = context.agentVersion;
		if (version === undefined || version.trim() === "") {
			return err(
				appError(
					"opencode_version_unknown",
					"OpenCode's version could not be read, so its approval policy and MCP timeout cannot be chosen. Check that `opencode --version` works.",
				),
			);
		}
		const major = majorVersion(version);
		if (major === null) {
			return err(
				appError(
					"opencode_version_unknown",
					`OpenCode's version "${version}" could not be understood, so its approval policy and MCP timeout cannot be chosen.`,
				),
			);
		}
		const existing = context.env?.[OPENCODE_CONFIG_CONTENT];
		let base: Record<string, unknown> = {};
		if (existing !== undefined && existing.trim() !== "") {
			const parsed = safeJsonParse(existing);
			if (!isRecord(parsed)) {
				return err(
					appError(
						"opencode_config_invalid",
						`${OPENCODE_CONFIG_CONTENT} is not a JSON object, so OpenCode's approval policy cannot be applied.`,
					),
				);
			}
			base = parsed;
		}
		const timeoutMs = Math.max(OPENCODE_MCP_TOOL_TIMEOUT_MS, existingTimeout(base, major) ?? 0);
		const config = mergeConfig(base, opencodeConfig(requireToolApproval, major, timeoutMs));
		return ok({ [OPENCODE_CONFIG_CONTENT]: JSON.stringify(config) });
	},
	checkPrompt(text: string, availableCommands: readonly string[]): Result<void, AppError> {
		return checkSlashCommand(text, availableCommands);
	},
	sessionStorage(workspacePath: string): AcpSessionStorage {
		return {
			env: { OPENCODE_DB: join(workspacePath, ".context", "opencode", "opencode.db") },
			sessionIdPrefix: "opencode-",
		};
	},
};
