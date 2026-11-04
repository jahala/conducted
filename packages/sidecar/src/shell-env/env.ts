/**
 * @feature SIDE-10 Login-shell environment capture
 * Owns: the pure parts of environment handling: parsing a captured dump, removing provider
 * secrets, and building the environment an agent process starts with.
 * Behaviour: research/conductor/native-and-sidecar-map.md B3 "Shell env capture" (strip the provider
 * keys, the BASH_FUNC_ variables, and set DISABLE_AUTO_UPDATE) and other-runners.md section 6
 * ("each harness strips its own secrets from the inherited env, then applies user overrides");
 * claude-runner.md section 1.3 (CONDUCTOR_SESSION_ID and friends are set per session).
 * Must handle: a dump with shell start-up noise before the first marker, values that contain
 * newlines or "=", a missing marker (error, not a guess), variables without "=" (skipped), and
 * user overrides winning over captured values but never being stripped themselves.
 * Test first: a dump with noise, a multi-line value and ANTHROPIC_API_KEY parses to a map without
 * the key and with the multi-line value intact.
 * Our design choice: the dump uses `env -0` (NUL separated), checked to work on macOS, so values
 * with newlines survive. Conductor parses line by line.
 */

import type { WorkspaceContext } from "@conducted/protocol";
import type { SessionId } from "@conducted/shared";
import { appError, err, ok, type Result } from "@conducted/shared";

/** Provider credentials removed from the captured environment. The agent signs in by itself. */
export const STRIPPED_ENV_NAMES: readonly string[] = [
	"ANTHROPIC_API_KEY",
	"CLAUDE_CODE_OAUTH_TOKEN",
	"CODEX_ACCESS_TOKEN",
	"CODEX_API_KEY",
	"CURSOR_API_KEY",
	"OPENAI_API_KEY",
];

/** Prefix of exported shell functions. They are not variables the agents need. */
export const STRIPPED_ENV_PREFIXES: readonly string[] = ["BASH_FUNC_"];

/** Parses the text between two marker strings as an `env -0` dump. */
export function parseEnvDump(output: string, marker: string): Result<Record<string, string>> {
	const start = output.indexOf(marker);
	if (start === -1) return err(appError("env_dump_missing", "The shell printed no environment"));
	const bodyStart = start + marker.length;
	const end = output.indexOf(marker, bodyStart);
	if (end === -1) return err(appError("env_dump_cut", "The environment dump ended early"));
	const env: Record<string, string> = {};
	for (const entry of output.slice(bodyStart, end).split("\0")) {
		const equals = entry.indexOf("=");
		if (equals <= 0) continue;
		env[entry.slice(0, equals)] = entry.slice(equals + 1);
	}
	return ok(env);
}

export function stripProviderSecrets(
	env: Readonly<Record<string, string>>,
): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [name, value] of Object.entries(env)) {
		if (STRIPPED_ENV_NAMES.includes(name)) continue;
		if (STRIPPED_ENV_PREFIXES.some((prefix) => name.startsWith(prefix))) continue;
		out[name] = value;
	}
	return out;
}

/** The variables every agent process gets so scripts and tools can find the workspace. */
export function workspaceEnv(
	sessionId: SessionId,
	workspace: WorkspaceContext,
): Record<string, string> {
	return {
		CONDUCTED_SESSION_ID: sessionId,
		CONDUCTED_WORKSPACE_PATH: workspace.workspacePath,
		CONDUCTED_ROOT_PATH: workspace.repoRootPath,
		CONDUCTED_DEFAULT_BRANCH: workspace.targetBranch,
		CONDUCTED_PORT: String(workspace.port),
		DISABLE_AUTO_UPDATE: "true",
	};
}

/**
 * Builds the final environment: the captured one without secrets, then the workspace variables,
 * then the user's own overrides from Settings (which may re-add a provider key on purpose).
 */
export function buildAgentEnv(
	captured: Readonly<Record<string, string>>,
	sessionId: SessionId,
	workspace: WorkspaceContext,
	userOverrides: Readonly<Record<string, string>>,
): Record<string, string> {
	return {
		...stripProviderSecrets(captured),
		...workspaceEnv(sessionId, workspace),
		...userOverrides,
	};
}
