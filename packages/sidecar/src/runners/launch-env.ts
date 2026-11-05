/**
 * @feature SIDE-21 Agent settings reach the sidecar: program paths, environment, keys
 * Owns: turning a chat's `AgentLaunch` (from `sendMessage`, `warmAgent` and `runUtilityPrompt`)
 * into what a runner needs: the program to start and the environment to start it with. Also the
 * providers an agent can use and the environment variable names that hold their keys.
 * Behaviour: claude-runner.md 1.2 (the user's own program path reaches the Claude runner, and
 * Conductor starts a `.js` path through a proxy) and 1.3 (environment), sessions.md 1 and 4,
 * native-and-sidecar-map.md
 * B4. The key rule is D033 in docs/decisions.md: one strip list removes every provider key from the
 * captured environment (`shell-env/env.ts`); each runner then gets only the keys of its own
 * provider, and a key that came from the Mac's environment only when the user picked "Use the key
 * from this Mac".
 * Must handle: a program path that does not exist or is not executable (an error value that names
 * the path); a `.js` program path (reported as started through the JavaScript runtime, not run
 * directly); no path given (the managed copy, then the copy on the login-shell PATH, D021); a key
 * meant for another agent (never passed); a user variable that has the name of a stripped key (the
 * user wins, as `shell-env/env.ts` already does for overrides); Claude provider routing for
 * Bedrock, Vertex, Foundry and Mantle (the matching `CLAUDE_CODE_USE_*` variable is set, nothing
 * else changes); an unknown provider (an error value); no value of the launch in any log line.
 * Test first: for a Codex chat whose launch holds an `ANTHROPIC_API_KEY`, the built environment
 * has no `ANTHROPIC_API_KEY`.
 */
import type { AgentLaunch, AgentProvider, WorkspaceContext } from "@conducted/protocol";
import type { AcpAgent, AgentKind, SessionId } from "@conducted/shared";
import { appError, err, ok, type Result } from "@conducted/shared";
import { AGENT_NOT_INSTALLED } from "../models/catalog.ts";
import { buildAgentEnv } from "../shell-env/env.ts";

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
export async function resolveAgentProgram(
	input: ResolveProgramInput,
): Promise<Result<AgentProgram>> {
	const chosen = input.launch.executablePath;
	if (chosen !== undefined && chosen !== "") {
		if (!(await input.isExecutable(chosen))) {
			return err(
				appError(
					"agent_program_invalid",
					`The program at ${chosen} was not found or cannot run. Choose another program path in Settings.`,
				),
			);
		}
		return ok({ path: chosen, viaRuntime: runsThroughRuntime(chosen) });
	}

	if (input.managedPath !== null && (await input.isExecutable(input.managedPath))) {
		return ok({
			path: input.managedPath,
			viaRuntime: runsThroughRuntime(input.managedPath),
		});
	}

	if (input.pathCopy !== null && (await input.isExecutable(input.pathCopy))) {
		return ok({
			path: input.pathCopy,
			viaRuntime: runsThroughRuntime(input.pathCopy),
		});
	}

	return err(
		appError(
			AGENT_NOT_INSTALLED,
			`${agentName(input.agent)} was not found. Install it, or choose its program in Settings.`,
		),
	);
}

export interface BuildEnvironmentInput {
	agent: AgentKind;
	/** The chat whose process starts; its id and workspace become CONDUCTED_* variables. */
	sessionId: SessionId;
	workspace: WorkspaceContext;
	/** The captured login-shell environment with every provider key already stripped. */
	base: Readonly<Record<string, string>>;
	launch: AgentLaunch;
	/** The variable names this agent reads its keys from (`agentProviders`). */
	ownKeyNames: readonly string[];
}

/** The environment an agent starts with: base, then the user's variables, then its own keys. */
export function buildAgentEnvironment(
	input: BuildEnvironmentInput,
): Result<Record<string, string>> {
	const ownKeys: Record<string, string> = {};
	for (const [name, key] of Object.entries(input.launch.providerKeys)) {
		if (!input.ownKeyNames.includes(name)) continue;
		ownKeys[name] = key.value;
	}
	const userVariables: Record<string, string> = { ...input.launch.env, ...ownKeys };

	if (input.agent === "claude") {
		const routing = claudeProviderEnvironment(input.launch.provider);
		if (!routing.ok) return routing;
		Object.assign(userVariables, routing.value);
	}

	return ok(buildAgentEnv(input.base, input.sessionId, input.workspace, userVariables));
}

/** The variables that route Claude to Bedrock, Vertex, Foundry or Mantle. */
export function claudeProviderEnvironment(
	provider: string | undefined,
): Result<Record<string, string>> {
	const name = provider?.trim().toLowerCase();
	if (name === undefined || name === "" || name === "anthropic") return ok({});
	const variable = CLAUDE_PROVIDER_VARIABLES[name];
	if (variable === undefined) {
		return err(
			appError(
				"claude_provider_unknown",
				`Claude has no provider called "${provider}". Choose Anthropic, Bedrock, Vertex, Foundry or Mantle.`,
			),
		);
	}
	return ok({ [variable]: "1" });
}

/** The providers an agent can use and the variables their keys go to (SET-10 adds more). */
export function agentProviders(agent: AgentKind, _acpAgent?: AcpAgent): AgentProvider[] {
	if (agent === "acp") return [...ACP_PROVIDERS];
	return [...AGENT_PROVIDERS[agent]];
}

const CLAUDE_PROVIDER_VARIABLES: Readonly<Record<string, string>> = {
	bedrock: "CLAUDE_CODE_USE_BEDROCK",
	vertex: "CLAUDE_CODE_USE_VERTEX",
	foundry: "CLAUDE_CODE_USE_FOUNDRY",
	mantle: "CLAUDE_CODE_USE_MANTLE",
};

const AGENT_PROVIDERS: Readonly<Record<Exclude<AgentKind, "acp">, AgentProvider[]>> = {
	claude: [
		{
			id: "anthropic",
			label: "Anthropic API key",
			keyEnvVars: ["ANTHROPIC_API_KEY"],
		},
		{
			id: "bedrock",
			label: "Amazon Bedrock",
			keyEnvVars: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"],
		},
		{
			id: "vertex",
			label: "Google Vertex AI",
			keyEnvVars: ["GOOGLE_APPLICATION_CREDENTIALS"],
		},
	],
	codex: [
		{
			id: "openai",
			label: "OpenAI API key",
			keyEnvVars: ["OPENAI_API_KEY"],
		},
	],
	cursor: [
		{
			id: "cursor",
			label: "Cursor API key",
			keyEnvVars: ["CURSOR_API_KEY"],
		},
	],
};

/** The providers OpenCode and Pi both read. SET-10 extends this list. */
const ACP_PROVIDERS: AgentProvider[] = [
	{ id: "openai", label: "OpenAI", keyEnvVars: ["OPENAI_API_KEY"] },
	{ id: "anthropic", label: "Anthropic", keyEnvVars: ["ANTHROPIC_API_KEY"] },
	{ id: "openrouter", label: "OpenRouter", keyEnvVars: ["OPENROUTER_API_KEY"] },
	{ id: "xai", label: "xAI", keyEnvVars: ["XAI_API_KEY"] },
];

function runsThroughRuntime(programPath: string): boolean {
	return programPath.toLowerCase().endsWith(".js");
}

function agentName(agent: AgentKind): string {
	switch (agent) {
		case "claude":
			return "Claude Code";
		case "codex":
			return "Codex";
		case "cursor":
			return "Cursor";
		case "acp":
			return "The OpenCode or Pi program";
	}
}
