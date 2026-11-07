/**
 * @feature SIDE-21 Agent settings reach the sidecar: program paths, environment, keys;
 * SET-10 OpenCode providers and their keys
 * Owns: turning a chat's `AgentLaunch` (from `sendMessage`, `warmAgent` and `runUtilityPrompt`)
 * into what a runner needs: the program to start and the environment to start it with. Also the
 * providers an agent can use and the environment variable names that hold their keys.
 * Behaviour: claude-runner.md 1.2 (the user's own program path reaches the Claude runner, and
 * Conductor starts a `.js` path through a JavaScript runtime) and 1.3 (environment), sessions.md 1
 * and 4, other-runners.md 2.1 (`OPENAI_BASE_URL` override for Codex) and 5 (runners start the
 * program the user chose, else the managed copy; an agent the app does not manage is found on
 * PATH), native-and-sidecar-map.md B4. The key rule is D033 in docs/decisions.md: one strip list
 * removes every provider key from the
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
 * finds through the program manager's bin link; a managed agent never looks on PATH, and its
 * missing copy is an error that names it and offers Retry, D088; an ACP agent is found on the
 * login-shell PATH); a key
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
 * Our design choice: the agent-provider table in packages/protocol (`AGENT_PROVIDER_TABLE`) holds
 * each agent's name, its base URL variable and its providers with their key and routing variables;
 * the key filter, the Claude routing and the error texts here read it, and so does the desktop.
 * Test first: for a Codex chat whose launch holds an `ANTHROPIC_API_KEY`, the built environment
 * has no `ANTHROPIC_API_KEY`.
 */
import {
	AGENT_PROVIDER_TABLE,
	type AgentLaunch,
	agentProviders,
	claudeRoutes,
	type WorkspaceContext,
} from "@conducted/protocol";
import type { AcpAgent, AgentKind, SessionId } from "@conducted/shared";
import { appError, err, ok, type Result } from "@conducted/shared";
import { AGENT_NOT_INSTALLED } from "../models/catalog.ts";
import type { CapturedShellEnv, ShellEnvProvider } from "../shell-env/capture.ts";
import { buildAgentEnv } from "../shell-env/env.ts";
import type { FindExecutable } from "./deps.ts";
import type { FindManagedProgram } from "./managed-programs.ts";
import type { ListingContext } from "./runner.ts";

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
	/**
	 * True for an agent program the app does not manage (an ACP agent), whose copy is found on the
	 * login-shell PATH. False for a managed agent: the app never runs a PATH copy of one, even
	 * when the managed copy is missing (D088).
	 */
	usePathCopy: boolean;
	/** Checks that a file exists and can run. */
	isExecutable(path: string): Promise<boolean>;
}

/**
 * Picks the program: the user's path, else the managed copy, else, only for an agent the app does
 * not manage, the PATH copy. A managed agent with no copy is an error that names it and points to
 * the Retry in Settings; the app never switches to a PATH copy by itself (D088).
 */
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

	if (input.usePathCopy && input.pathCopy !== null && (await input.isExecutable(input.pathCopy))) {
		return ok({
			path: input.pathCopy,
			viaRuntime: runsThroughRuntime(input.pathCopy),
		});
	}

	return err(
		appError(
			AGENT_NOT_INSTALLED,
			input.usePathCopy
				? `${agentName(input.agent)} was not found. Install it, or choose its program in Settings.`
				: `${agentName(input.agent)} is not installed. Retry its download in Settings > Advanced, or choose its program in Settings.`,
		),
	);
}

/**
 * The program a runner starts for a chat: the user's path, else the managed copy, through the one
 * rule in `resolveAgentProgram`. An agent the app manages never looks on PATH; an ACP agent, which
 * the app does not manage, still uses the copy named `name` on the login-shell PATH. A path is
 * checked with the same `findExecutable` that searches the PATH, which takes a name with a slash as
 * it is.
 */
export async function findAgentProgram(input: {
	agent: AgentKind;
	/** The name looked up on the login-shell PATH for an unmanaged agent, for example "codex". */
	name: string;
	/** The program the user chose in Settings, from the chat's launch. */
	executablePath: string | undefined;
	env: Readonly<Record<string, string>>;
	findExecutable: FindExecutable;
	/** The app's managed copy (PLAT-28). Absent: there is none to find. */
	findManagedProgram?: FindManagedProgram | undefined;
	/** True for an agent the app does not manage: its copy comes from the login-shell PATH. */
	usePathCopy: boolean;
}): Promise<Result<AgentProgram>> {
	const managed = (await input.findManagedProgram?.(input.name)) ?? null;
	const pathCopy = input.usePathCopy ? await input.findExecutable(input.name, input.env) : null;
	return resolveAgentProgram({
		agent: input.agent,
		launch: { executablePath: input.executablePath },
		managedPath: managed === null ? null : managed.path,
		pathCopy,
		usePathCopy: input.usePathCopy,
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
 * the agent's own keys (the variables of the protocol's `agentProviders`).
 */
export function buildAgentEnvironment(
	input: BuildEnvironmentInput,
): Result<Record<string, string>> {
	const variables = launchVariables(input.agent, input.launch);
	if (!variables.ok) return variables;
	return ok(buildAgentEnv(input.base, input.sessionId, input.workspace, variables.value));
}

/**
 * What a launch adds to the captured environment: the user's variables, then the base URL, then the
 * agent's own keys, then Claude's provider routing.
 */
function launchVariables(agent: AgentKind, launch: AgentLaunch): Result<Record<string, string>> {
	// A custom provider decides which variables it needs, so every entered key reaches the agent.
	// The built-in providers get only the variables listed for their agent (D033).
	const ownKeyNames =
		launch.provider?.trim().toLowerCase() === "custom"
			? null
			: agentProviders(agent).flatMap((provider) => provider.keyEnvVars);
	const ownKeys: Record<string, string> = {};
	for (const [name, key] of Object.entries(launch.providerKeys)) {
		if (ownKeyNames !== null && !ownKeyNames.includes(name)) continue;
		ownKeys[name] = key.value;
	}
	const baseUrl = baseUrlEnvironment(agent, launch.baseUrl);
	if (!baseUrl.ok) return baseUrl;
	const variables: Record<string, string> = {
		...launch.env,
		...baseUrl.value,
		...ownKeys,
	};

	if (agent === "claude") {
		const routing = claudeProviderEnvironment(launch.provider);
		if (!routing.ok) return routing;
		Object.assign(variables, routing.value);
	}
	return ok(variables);
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

/**
 * How a listing call (models, slash commands, MCP servers) starts the agent: the login shell
 * captured for `folder`, with the launch's variables and keys added and its program chosen, so the
 * list comes from the program and keys a chat would use (SIDE-21). Without a launch the listing
 * runs the captured environment and the managed or PATH program. A launch's key chosen from this
 * Mac that the shell does not set fails with its name, as a chat's start does.
 */
export async function listingContext(input: {
	agent: AgentKind;
	shellEnv: ShellEnvProvider;
	/** The folder whose login-shell capture to use; missing: the sidecar's own folder. */
	folder?: string;
	launch?: AgentLaunch;
}): Promise<Result<ListingContext>> {
	const captured = await input.shellEnv.get(input.folder);
	if (!captured.ok) return captured;
	if (input.launch === undefined) return ok({ env: captured.value.env });
	const launch = fillMacKeys(input.launch, captured.value);
	if (!launch.ok) return launch;
	const variables = launchVariables(input.agent, launch.value);
	if (!variables.ok) return variables;
	const executablePath = launch.value.executablePath;
	return ok({
		env: { ...captured.value.env, ...variables.value },
		...(executablePath === undefined || executablePath === "" ? {} : { executablePath }),
	});
}

/** The variable that replaces the provider's own address, for the agents that have one. */
export function baseUrlEnvironment(
	agent: AgentKind,
	baseUrl: string | undefined,
): Result<Record<string, string>> {
	const value = baseUrl?.trim();
	if (value === undefined || value === "") return ok({});
	const variable = AGENT_PROVIDER_TABLE[agent].baseUrlEnvVar;
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
	const routes = claudeRoutes();
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

function runsThroughRuntime(programPath: string): boolean {
	return programPath.toLowerCase().endsWith(".js");
}

function agentName(agent: AgentKind): string {
	return AGENT_PROVIDER_TABLE[agent].name;
}
