/**
 * @feature SIDE-21 Agent settings reach the sidecar: program paths, environment, keys;
 * SET-10 OpenCode providers and their keys
 * Owns: turning a chat's `AgentLaunch` (from `sendMessage`, `warmAgent` and `runUtilityPrompt`)
 * into what a runner needs: the program to start and the environment to start it with. Also the
 * providers an agent can use and the environment variable names that hold their keys.
 * Behaviour: claude-runner.md 1.2 (the user's own program path reaches the Claude runner, and
 * Conductor starts a `.js` path through a JavaScript runtime) and 1.3 (environment), sessions.md 1
 * and 4, other-runners.md 2.1 (`OPENAI_BASE_URL` override for Codex) and 5 (runners start the
 * program the user chose, the managed copy, then the PATH copy), native-and-sidecar-map.md B4. The
 * key rule is D033 in docs/decisions.md: one strip list removes every provider key from the
 * captured environment (`shell-env/env.ts`); each runner then gets only the keys of its own
 * provider, and a key that came from the Mac's environment only when the user picked "Use the key
 * from this Mac": the app sends such a key with source `this_mac` and no value, and `fillMacKeys`
 * takes the value from the login shell the sidecar captured. When the launch names a custom
 * provider, the user's entered keys all reach it, because that provider decides which variables it
 * needs.
 * Must handle: a program path that does not exist or is not executable (an error value that names
 * the path, never a quiet switch to another copy); a `.js` program path (`viaRuntime`: Claude
 * starts it through node, the SDK's `executable`; Codex and ACP programs start the file itself,
 * which runs through its own `#!` line); no path given (the managed copy, which `managed-programs.ts`
 * finds through the program manager's bin link, then the copy on the login-shell PATH, D021); a key
 * meant for another agent (never passed unless the provider is custom); a user variable that has
 * the name of a stripped key (the
 * user wins, as `shell-env/env.ts` already does for overrides); Claude provider routing for
 * Bedrock, Vertex, Foundry and Mantle (the matching `CLAUDE_CODE_USE_*` variable is set, nothing
 * else changes); an unknown provider (an error value); a base URL (`ANTHROPIC_BASE_URL` for Claude,
 * `OPENAI_BASE_URL` for Codex, an error value for an agent with no such variable); a key chosen from
 * this Mac that the login shell does not set (an error value that names the variable); no value of
 * the launch in any log line.
 * Our design choice: a launch's base URL wins over a user variable of the same name, because it is
 * the dedicated setting for it.
 * Our design choice: one table per agent (`AGENT_LAUNCH_FACTS`) holds its name, its base URL
 * variable and its providers with their key and routing variables; the provider list, the key
 * filter, the Claude routing and the error texts all read it. The desktop keeps its own copies of
 * the key variables until the protocol carries one shared table.
 * Test first: for a Codex chat whose launch holds an `ANTHROPIC_API_KEY`, the built environment
 * has no `ANTHROPIC_API_KEY`.
 */
import type { AgentLaunch, AgentProvider, WorkspaceContext } from "@conducted/protocol";
import type { AcpAgent, AgentKind, SessionId } from "@conducted/shared";
import { appError, err, ok, type Result } from "@conducted/shared";
import { AGENT_NOT_INSTALLED } from "../models/catalog.ts";
import type { CapturedShellEnv } from "../shell-env/capture.ts";
import { buildAgentEnv } from "../shell-env/env.ts";
import { opencodeProviders } from "./acp/opencode-providers.ts";
import type { FindExecutable } from "./deps.ts";
import type { FindManagedProgram } from "./managed-programs.ts";

export interface AgentProgram {
	/** Absolute path of the program to run. */
	path: string;
	/** True when `path` is a `.js` file that must run through the JavaScript runtime. */
	viaRuntime: boolean;
}

export interface ResolveProgramInput {
	agent: AgentKind;
	/** The chat's launch; only its program path is read. */
	launch: Pick<AgentLaunch, "executablePath">;
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

/**
 * The program a runner starts for a chat: the user's path, the managed copy, or the copy named
 * `name` on the login-shell PATH, through the one rule in `resolveAgentProgram`. A path is checked
 * with the same `findExecutable` that searches the PATH, which takes a name with a slash as it is.
 */
export async function findAgentProgram(input: {
	agent: AgentKind;
	/** The name looked up on the login-shell PATH, for example "codex". */
	name: string;
	/** The program the user chose in Settings, from the chat's launch. */
	executablePath: string | undefined;
	env: Readonly<Record<string, string>>;
	findExecutable: FindExecutable;
	/** The app's managed copy (PLAT-28). Absent: there is none to find. */
	findManagedProgram?: FindManagedProgram | undefined;
}): Promise<Result<AgentProgram>> {
	const managed = (await input.findManagedProgram?.(input.name)) ?? null;
	return resolveAgentProgram({
		agent: input.agent,
		launch: { executablePath: input.executablePath },
		managedPath: managed === null ? null : managed.path,
		pathCopy: await input.findExecutable(input.name, input.env),
		isExecutable: async (candidate) => (await input.findExecutable(candidate, input.env)) !== null,
	});
}

export interface BuildEnvironmentInput {
	agent: AgentKind;
	/** The ACP agent (OpenCode or Pi) of an ACP chat. */
	acpAgent?: AcpAgent;
	/** The chat whose process starts; its id and workspace become CONDUCTED_* variables. */
	sessionId: SessionId;
	workspace: WorkspaceContext;
	/** The captured login-shell environment with every provider key already stripped. */
	base: Readonly<Record<string, string>>;
	launch: AgentLaunch;
}

/**
 * The environment an agent starts with: base, then the user's variables, then the base URL, then
 * the agent's own keys (the variables of `agentProviders`).
 */
export function buildAgentEnvironment(
	input: BuildEnvironmentInput,
): Result<Record<string, string>> {
	// A custom provider decides which variables it needs, so every entered key reaches the agent.
	// The built-in providers get only the variables listed for their agent (D033).
	const ownKeyNames =
		input.launch.provider?.trim().toLowerCase() === "custom"
			? null
			: AGENT_LAUNCH_FACTS[input.agent].providers.flatMap((provider) => provider.keyEnvVars);
	const ownKeys: Record<string, string> = {};
	for (const [name, key] of Object.entries(input.launch.providerKeys)) {
		if (ownKeyNames !== null && !ownKeyNames.includes(name)) continue;
		ownKeys[name] = key.value;
	}
	const baseUrl = baseUrlEnvironment(input.agent, input.launch.baseUrl);
	if (!baseUrl.ok) return baseUrl;
	const userVariables: Record<string, string> = {
		...input.launch.env,
		...baseUrl.value,
		...ownKeys,
	};

	if (input.agent === "claude") {
		const routing = claudeProviderEnvironment(input.launch.provider);
		if (!routing.ok) return routing;
		Object.assign(userVariables, routing.value);
	}

	return ok(buildAgentEnv(input.base, input.sessionId, input.workspace, userVariables));
}

/**
 * Fills each key chosen as "Use the key from this Mac" with the value the captured login shell has: a
 * provider key the capture kept apart, else a variable of the stripped environment (for example an AWS
 * key, which is not stripped). A key the shell does not set fails the launch with its name.
 */
function fillMacKeys(
	launch: AgentLaunch,
	captured: Pick<CapturedShellEnv, "env" | "providerSecrets">,
): Result<AgentLaunch> {
	const providerKeys: AgentLaunch["providerKeys"] = {};
	for (const [name, key] of Object.entries(launch.providerKeys)) {
		if (key.source !== "this_mac") {
			providerKeys[name] = key;
			continue;
		}
		const value = captured.providerSecrets[name] ?? captured.env[name];
		if (value === undefined || value === "") {
			return err(
				appError(
					"mac_key_missing",
					`${name} is not set in this Mac's login shell. Set it in your shell profile, or enter the key in Settings.`,
				),
			);
		}
		providerKeys[name] = { value, source: "this_mac" };
	}
	return ok({ ...launch, providerKeys });
}

/**
 * The environment of an agent started from a captured login shell: the keys chosen from this Mac filled
 * in, then `buildAgentEnvironment`. Every runner start goes through here.
 */
export function agentEnvironmentFromCapture(
	input: Omit<BuildEnvironmentInput, "base"> & {
		captured: Pick<CapturedShellEnv, "env" | "providerSecrets">;
	},
): Result<Record<string, string>> {
	const launch = fillMacKeys(input.launch, input.captured);
	if (!launch.ok) return launch;
	const { captured, ...rest } = input;
	return buildAgentEnvironment({ ...rest, base: captured.env, launch: launch.value });
}

/** The variable that replaces the provider's own address, for the agents that have one. */
export function baseUrlEnvironment(
	agent: AgentKind,
	baseUrl: string | undefined,
): Result<Record<string, string>> {
	const value = baseUrl?.trim();
	if (value === undefined || value === "") return ok({});
	const variable = AGENT_LAUNCH_FACTS[agent].baseUrlEnvVar;
	if (variable === undefined) {
		return err(
			appError(
				"base_url_unsupported",
				`${agentName(agent)} has no base URL setting. Remove the base URL from its settings.`,
			),
		);
	}
	return ok({ [variable]: value });
}

/** The variables that route Claude to Bedrock, Vertex, Foundry or Mantle. */
export function claudeProviderEnvironment(
	provider: string | undefined,
): Result<Record<string, string>> {
	const name = provider?.trim().toLowerCase();
	if (name === undefined || name === "") return ok({});
	const claude = AGENT_LAUNCH_FACTS.claude;
	const routes = [...claude.providers, ...(claude.routingOnly ?? [])];
	const known = routes.find((route) => route.id === name);
	if (known === undefined) {
		return err(
			appError(
				"claude_provider_unknown",
				`Claude has no provider called "${provider}". Choose one of: ${routes.map((route) => route.id).join(", ")}.`,
			),
		);
	}
	return ok(known.routingEnvVar === undefined ? {} : { [known.routingEnvVar]: "1" });
}

/** The providers an agent can use and the variables their keys go to, as a fresh copy. */
export function agentProviders(agent: AgentKind, _acpAgent?: AcpAgent): AgentProvider[] {
	return AGENT_LAUNCH_FACTS[agent].providers.map((provider) => ({
		id: provider.id,
		label: provider.label,
		keyEnvVars: [...provider.keyEnvVars],
	}));
}

/** A provider an agent can use. */
interface LaunchProvider extends AgentProvider {
	/** Claude only: the variable set to "1" to route Claude through this provider. */
	routingEnvVar?: string;
}

/**
 * Everything the launch needs to know about one agent, in one place: its name in messages, the
 * variable its base URL goes to, and its providers with their key and routing variables. The
 * provider list, the key filter (D033), the Claude routing and the error texts all read this.
 */
interface AgentLaunchFacts {
	name: string;
	/** Missing when the agent has no base URL setting. */
	baseUrlEnvVar?: string;
	/** Listed by `listAgentProviders`; their key variables are the only keys the agent receives. */
	providers: readonly LaunchProvider[];
	/**
	 * Claude only: providers Claude can be routed to that have no key form of their own (Foundry and
	 * Mantle, native-and-sidecar-map B4). The research names no key variables for them, so none is
	 * listed; their keys arrive through a custom provider.
	 */
	routingOnly?: readonly { id: string; routingEnvVar: string }[];
}

const AGENT_LAUNCH_FACTS: Readonly<Record<AgentKind, AgentLaunchFacts>> = {
	claude: {
		name: "Claude Code",
		baseUrlEnvVar: "ANTHROPIC_BASE_URL",
		providers: [
			{
				id: "anthropic",
				label: "Anthropic API key",
				// The subscription token signs a Claude Code subscription in through the same provider.
				keyEnvVars: ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"],
			},
			{
				id: "bedrock",
				label: "Amazon Bedrock",
				keyEnvVars: [
					"AWS_ACCESS_KEY_ID",
					"AWS_SECRET_ACCESS_KEY",
					"AWS_SESSION_TOKEN",
					"AWS_BEARER_TOKEN_BEDROCK",
					"ANTHROPIC_MODEL",
				],
				routingEnvVar: "CLAUDE_CODE_USE_BEDROCK",
			},
			{
				id: "vertex",
				label: "Google Vertex AI",
				keyEnvVars: ["GOOGLE_APPLICATION_CREDENTIALS"],
				routingEnvVar: "CLAUDE_CODE_USE_VERTEX",
			},
			// The Providers dialog's "Custom provider" (SET-09): the key and the optional workspace ID
			// go where the app's provider forms put them (keyEnvVarFor, workspaceIdEnvVarFor).
			{
				id: "custom",
				label: "Custom provider",
				keyEnvVars: ["ANTHROPIC_API_KEY", "ANTHROPIC_WORKSPACE_ID"],
			},
		],
		routingOnly: [
			{ id: "foundry", routingEnvVar: "CLAUDE_CODE_USE_FOUNDRY" },
			{ id: "mantle", routingEnvVar: "CLAUDE_CODE_USE_MANTLE" },
		],
	},
	codex: {
		name: "Codex",
		baseUrlEnvVar: "OPENAI_BASE_URL",
		providers: [
			{ id: "openai", label: "OpenAI API key", keyEnvVars: ["OPENAI_API_KEY"] },
			{ id: "custom", label: "Custom provider", keyEnvVars: ["OPENAI_API_KEY", "OPENAI_ORG_ID"] },
		],
	},
	cursor: {
		name: "Cursor",
		providers: [{ id: "cursor", label: "Cursor API key", keyEnvVars: ["CURSOR_API_KEY"] }],
	},
	acp: {
		name: "The OpenCode or Pi program",
		// OpenCode and Pi both read the OpenCode catalogue (SET-10), plus a custom provider.
		providers: [
			...opencodeProviders(),
			{
				id: "custom",
				label: "Custom provider",
				keyEnvVars: [
					"OPENAI_API_KEY",
					"ANTHROPIC_API_KEY",
					"OPENAI_ORG_ID",
					"OPENCODE_WORKSPACE_ID",
				],
			},
		],
	},
};

function runsThroughRuntime(programPath: string): boolean {
	return programPath.toLowerCase().endsWith(".js");
}

function agentName(agent: AgentKind): string {
	return AGENT_LAUNCH_FACTS[agent].name;
}
