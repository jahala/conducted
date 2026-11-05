/**
 * @feature AGENT-12 ACP adapters for OpenCode and Pi: the adapter descriptor
 * Owns: what differs between ACP agents, and the helpers that read models and config values from
 * an adapter's ACP config options.
 * Behaviour: research/conductor/other-runners.md sections 2.2, 3 and 5: Conductor's adapter table
 * has a command, a minimum version, tool name hints, a wait for the model catalog, a permission
 * policy passed through the environment, prompt validation and session storage. Models come from
 * the session config option whose category is "model". The model list waits up to 15 s for that
 * option; a longer adapter wait is capped at 90 s.
 * Must handle: an adapter without a minimum version (any version runs), tool name hints that
 * override the ACP tool kind (Pi's `find` is a glob), an adapter whose model list arrives late
 * (waitForModelCatalogMs), agent-specific environment for the approval policy, a prompt the agent
 * cannot run, and an agent that needs its own session storage folder and id prefix.
 * Test first: see adapters.test.ts.
 * Our design choice: hooks are optional, so Pi declares only what it needs. A hook that can fail
 * returns Result, like the rest of the sidecar.
 */

import type { SessionConfigOption, SessionConfigSelectGroup } from "@agentclientprotocol/sdk";
import type { CanonicalTool, ModelInfo } from "@conducted/protocol";
import type { AcpAgent, AppError, Result } from "@conducted/shared";

/** The longest the runner waits for the model option, including an adapter's own wait. */
export const ACP_MODEL_LIST_CAP_MS = 90_000;
/** How long an ACP agent may take to report its slash commands after session/new. */
export const ACP_COMMAND_LIST_WAIT_MS = 2_000;

/** The wait for the model option, never longer than the adapter asks or the 90 s cap allows. */
export function modelCatalogWaitMs(adapterWaitMs: number, elapsedMs: number): number {
	const room = ACP_MODEL_LIST_CAP_MS - Math.max(0, elapsedMs);
	return Math.max(0, Math.min(adapterWaitMs, room));
}

/** Everything an environment hook may need to build the agent's environment. */
export interface AcpAdapterContext {
	/** The version the agent reported, when it is known. */
	agentVersion?: string | undefined;
	/** The environment the agent will inherit, so a hook can merge a value the user already set. */
	env?: Readonly<Record<string, string>> | undefined;
}

/** A folder the agent keeps its sessions in, and the prefix that keeps its ids unique. */
export interface AcpSessionStorage {
	env: Record<string, string>;
	sessionIdPrefix: string;
}

export interface AcpAdapter {
	id: AcpAgent;
	displayName: string;
	/** The program to start, looked up on the login-shell PATH, and its arguments. */
	command: { executable: string; args: readonly string[] };
	/** Arguments that make the program print its version. */
	versionArgs: readonly string[];
	/** The lowest version we run against. Older versions are reported as "update needed". */
	minimumVersion?: string;
	/** Native tool names that need a canonical tool the ACP tool kind does not give. */
	toolNameHints: Readonly<Record<string, CanonicalTool>>;
	/** How long to wait after session/new for the model option to appear, in ms. 0: do not wait. */
	waitForModelCatalogMs: number;
	/** Extra environment that makes the agent ask or not ask for permission. */
	permissionEnv(
		requireToolApproval: boolean,
		context?: AcpAdapterContext,
	): Result<Record<string, string>, AppError>;
	/** Rejects a prompt the agent cannot run, such as an unknown slash command. */
	checkPrompt?(text: string, availableCommands: readonly string[]): Result<void, AppError>;
	/** Where the agent keeps its sessions, and the prefix that keeps their ids unique. */
	sessionStorage?(workspacePath: string): AcpSessionStorage;
}

type ModelConfigOption = Extract<SessionConfigOption, { type: "select" }>;

/** The select option that holds the agent's models, if it has one. */
export function modelOptionFromConfig(
	options: readonly SessionConfigOption[],
): ModelConfigOption | undefined {
	return options.find(
		(option): option is ModelConfigOption =>
			option.type === "select" && (option.category === "model" || option.id === "model"),
	);
}

/** The choices of a select option, flattened across groups. */
function modelChoices(option: ModelConfigOption): readonly { value: string; name: string }[] {
	const entries = option.options;
	if (entries.length === 0) return [];
	const first = entries[0];
	if (first !== undefined && "group" in first) {
		return (entries as readonly SessionConfigSelectGroup[]).flatMap((group) => group.options);
	}
	return entries as readonly { value: string; name: string }[];
}

/**
 * Maps the model config option to the model list the picker uses. The option gives only ids and
 * labels; a later feature adds the per-model options (effort and the like).
 */
export function modelsFromConfigOptions(options: readonly SessionConfigOption[]): ModelInfo[] {
	const option = modelOptionFromConfig(options);
	if (option === undefined) return [];
	return modelChoices(option).map((choice) => ({
		id: choice.value,
		label: choice.name,
		status: "picker",
		isNew: false,
		isDefault: choice.value === option.currentValue,
		efforts: [],
		defaultEffort: "none",
		effortAxis: "effort",
		liveEffortChange: false,
		supportsFastMode: false,
	}));
}
