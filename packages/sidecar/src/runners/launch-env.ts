/**
 * @feature SIDE-21 Agent settings reach the sidecar: program paths, environment, keys
 * Owns: turning a chat's `AgentLaunch` (from `sendMessage`, `warmAgent` and `runUtilityPrompt`)
 * into what a runner needs: the program to start and the environment to start it with.
 * Behaviour: claude-runner.md 1.2 (the user's own program path reaches the Claude runner; a `.js`
 * file runs through a proxy) and 1.3 (environment), sessions.md 1 and 4, native-and-sidecar-map.md
 * B4. The key rule is D033 in docs/decisions.md: one strip list removes every provider key from the
 * captured environment (`shell-env/env.ts`); each runner then gets only the keys of its own
 * provider, and a key that came from the Mac's environment only when the user picked "Use the key
 * from this Mac".
 * Must handle: a program path that does not exist or is not executable (an error value that names
 * the path); a `.js` program path (started through the JavaScript runtime, not run directly); no
 * path given (the managed copy, then the copy on the login-shell PATH, D021); a key meant for
 * another agent (never passed); a user variable that has the name of a stripped key (the user
 * wins, as `shell-env/env.ts` already does for overrides); Claude provider routing for Bedrock,
 * Vertex, Foundry and Mantle (the matching `CLAUDE_CODE_USE_*` variable is set, nothing else
 * changes); an unknown provider (an error value); no value of the launch in any log line.
 * Test first: for a Codex chat whose launch holds an `ANTHROPIC_API_KEY`, the built environment
 * has no `ANTHROPIC_API_KEY`.
 */
import type { AgentLaunch } from "@conducted/protocol";
import type { AgentKind } from "@conducted/shared";
import { notImplemented, type Result } from "@conducted/shared";

export interface AgentProgram {
	/** Absolute path of the program to run. */
	path: string;
	/** True when `path` is a `.js` file that must run through the JavaScript runtime. */
	viaRuntime: boolean;
}

export interface ResolveProgramInput {
	agent: AgentKind;
	launch: AgentLaunch;
	/** The app's managed copy (D021), when one is installed. */
	managedPath: string | null;
	/** The copy found on the login-shell PATH, when there is one. */
	pathCopy: string | null;
	/** Checks that a file exists and can run. */
	isExecutable(path: string): Promise<boolean>;
}

/** Picks the program: the user's path, else the managed copy, else the PATH copy. */
export function resolveAgentProgram(_input: ResolveProgramInput): Promise<Result<AgentProgram>> {
	return notImplemented("SIDE-21");
}

export interface BuildEnvironmentInput {
	agent: AgentKind;
	/** The captured login-shell environment with every provider key already stripped. */
	base: Readonly<Record<string, string>>;
	launch: AgentLaunch;
	/** The variable names this agent reads its keys from (`listAgentProviders`). */
	ownKeyNames: readonly string[];
}

/** The environment an agent starts with: base, then the user's variables, then its own keys. */
export function buildAgentEnvironment(
	_input: BuildEnvironmentInput,
): Result<Record<string, string>> {
	return notImplemented("SIDE-21");
}

/** The variables that route Claude to Bedrock, Vertex, Foundry or Mantle. */
export function claudeProviderEnvironment(
	_provider: string | undefined,
): Result<Record<string, string>> {
	return notImplemented("SIDE-21");
}
