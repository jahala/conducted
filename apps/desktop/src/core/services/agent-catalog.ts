/**
 * @feature SET-03 Agent catalogue: installs, models, slash commands, sign-in; SET-09 provider keys;
 * SET-10 OpenCode providers and their keys
 * @feature SET-12 Claude settings and Codex config editors
 * @feature SIDE-22 Slash command cache that works before a chat starts
 * @feature SET-08 Sync agent configs between Claude Code and Codex
 * Owns: what the sidecar says about agents: which are installed and signed in, the model list per
 * agent, the slash commands of a workspace and of a repository before a workspace exists, starting
<<<<<<< HEAD
 * a sign-in flow, an agent's provider keys and the providers an agent can use, and the preview and
 * copy of MCP servers, slash commands and skills from one agent's config to the other's.
 * Also the display name and catalogue key that the Agents page and the model picker share.
=======
 * a sign-in flow, an agent's provider keys and the providers an agent can use.
 * Also the display name and catalogue key that the Agents page and the model picker share, and
 * the text of an agent's own settings file for its editor on the Agents page.
>>>>>>> ae65f4dbcf4fb5ca8db05e0e598779fdaeef6796
 * Behaviour: other-runners.md 5 (model catalog, detection), claude-runner.md 7 (slash commands),
 * services-map.md 5B.5 (model catalog and favourites), ui-map.md 6 (Agents page states, provider
 * credential forms and the Claude settings and Codex config editors), services-map.md 4.2.8
 * (provider keys), D033 (one strip list; only the agent's own provider keys reach it).
 * Must handle: the sidecar is not up yet (the install list stays "loading" until the request
 * answers, and a request that fails shows its error); an `agentInstallsChanged` notification
 * replaces the list without a request; a model
 * list request for an agent that is not installed returns an Err with the sidecar's code
 * `agentNotInstalled`; slow model lists (ACP) must not block the picker's other agents; only the
 * newest answer for an install list, a provider-key list or a provider list wins; a sign-in flow returns
 * instructions and optionally a URL, a user code or a terminal command, ends with finishLogin or
 * cancelLogin. A key an agent hands back (Cursor) is refused: the user enters it in the provider
 * forms instead. A provider key typed on the page goes into the Keychain and its row into
 * `provider_keys`; "use the key from this Mac" stores only the choice. Removing a key removes both
 * the row and its Keychain entry. OpenCode and Pi read every stored key at once, and OpenCode's
 * catalogue gives one variable to several providers (ZHIPU_API_KEY for Z.AI and Zhipu AI), so
 * for an ACP agent a variable has one row: saving it under one provider replaces the rows of the
 * same variable under the others, and removing it removes it for every provider. A config file is
 * read from the agent's own home folder (`~/.claude/settings.json` or `~/.codex/config.toml`); a
 * missing file reads as empty text, and a save refuses when the file changed since it was read.
 * Our design choice: the catalogue caches per agent key in memory only. Nothing about models is
 * saved to disk. A provider key's Keychain name is built from the agent, ACP agent, provider and
 * variable, so saving the same key twice replaces one entry. OpenCode and Pi use OpenCode's own
 * provider catalogue (SET-10).
 * Our design choice: the sync reads Claude's `~/.claude.json` `mcpServers`, `~/.claude/commands`
 * and `~/.claude/skills`, and writes Codex's `~/.codex/config.toml` `mcp_servers`,
 * `~/.codex/prompts` and `~/.codex/skills`. MCP entries keep their keys and values; a Codex
 * config that already exists is patched, so its comments stay. The research does not verify the
 * dialog's details (ui-map.md 10), so the file layouts are ours.
 * Test first: two refreshes of the install list, answered out of order, leave the newer answer;
 * two model lists for one agent key, answered out of order, leave the newer answer; two provider
 * key lists for one agent, answered out of order, leave the newer answer; two provider lists for
<<<<<<< HEAD
 * one agent, answered out of order, leave the newer answer; two config-sync previews for one
 * source, answered out of order, leave the newer answer.
=======
 * one agent, answered out of order, leave the newer answer; two config reads for one agent,
 * answered out of order, leave the newer answer.
>>>>>>> ae65f4dbcf4fb5ca8db05e0e598779fdaeef6796
 */
import {
	AGENT_PROVIDER_TABLE,
	type AgentInstall,
	type AgentLaunch,
	type AgentLogin,
	type AgentProvider,
	type ModelInfo,
	type SlashCommand,
} from "@conducted/protocol";
import type { AcpAgent, AgentKind, Result, SessionId } from "@conducted/shared";
import { appError, err, notImplemented, ok } from "@conducted/shared";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { FileSystem, Keychain } from "../../platform/platform.ts";
import type { Loadable, ProviderKeyRef } from "../api.ts";
import { createLatestWins } from "../async/latest-wins.ts";
import type { ProviderKey, ProviderKeyRepository } from "../db/provider-keys.ts";
import type {
	AgentConfigFile,
	ConfigSyncCategory,
	ConfigSyncChange,
	ConfigSyncResult,
	ProviderKeyView,
} from "../model.ts";
import type { SidecarClient } from "../sidecar/tunnel.ts";
import type { TomlCodec } from "./settings.ts";

export interface AgentCatalogState {
	installs: Loadable<AgentInstall[]>;
	/** Keyed by `agentKey(agent, acpAgent)`. */
	models: Readonly<Record<string, Loadable<ModelInfo[]>>>;
	slashCommands: Readonly<Record<string, Loadable<SlashCommand[]>>>;
	/** Saved lists for a repository, keyed by `preWorkspaceSlashKey`, before a workspace exists. */
	preWorkspaceSlashCommands?: Readonly<Record<string, Loadable<SlashCommand[]>>>;
	/** Keyed by `agentKey(agent, acpAgent)`. Optional so older test stores need no new slice. */
	providerKeys?: Readonly<Record<string, Loadable<ProviderKeyView[]>>>;
	/** The providers an agent can use, keyed by `agentKey(agent, acpAgent)`. */
	providers?: Readonly<Record<string, Loadable<AgentProvider[]>>>;
<<<<<<< HEAD
	/** What a sync would change, keyed by `configSyncKey` (SET-08). */
	configSyncPreview?: Readonly<Record<string, Loadable<ConfigSyncChange[]>>>;
=======
	/** The two config files the Agents page edits, keyed by agent. */
	configFiles?: Readonly<Record<string, Loadable<AgentConfigFile>>>;
>>>>>>> ae65f4dbcf4fb5ca8db05e0e598779fdaeef6796
}

export const agentKey = (agent: AgentKind, acpAgent?: AcpAgent): string =>
	acpAgent === undefined ? agent : `${agent}:${acpAgent}`;

/** The store key of a repository's saved list, before any workspace exists (SIDE-22). */
export const preWorkspaceSlashKey = (
	repoRootPath: string,
	agent: AgentKind,
	acpAgent?: AcpAgent,
): string => `repo:${repoRootPath}:${agentKey(agent, acpAgent)}`;

/** The name the user sees. ACP agents share one agent kind but keep their own names. */
export function agentDisplayName(choice: { agent: AgentKind; acpAgent?: AcpAgent }): string {
	if (choice.agent === "claude") return "Claude Code";
	if (choice.agent === "codex") return "Codex";
	if (choice.agent === "cursor") return "Cursor";
	if (choice.acpAgent === "pi") return "Pi";
	if (choice.acpAgent === "opencode") return "OpenCode";
	return "ACP agent";
}

export interface AgentCatalogServiceDeps {
	sidecar: Pick<SidecarClient, "request">;
	/** Workspace folder of a chat, for slash commands. */
	workspacePathOf: (sessionId: SessionId) => Promise<Result<string>>;
	/**
	 * Root folder of a chat's repository. The sidecar saves an open chat's slash commands under it,
	 * which is the key the new-workspace composer reads before any workspace exists (SIDE-22).
	 */
	repoRootPathOf: (sessionId: SessionId) => Promise<Result<string>>;
	/**
	 * How the agent would start (SIDE-21): its program, variables and keys, for a chat's workspace
	 * when `sessionId` is given and with the global variables otherwise. Model and slash-command
	 * lists send it, so the sidecar lists with the program and keys the user chose.
	 */
	launchFor: (
		agent: AgentKind,
		acpAgent: AcpAgent | undefined,
		sessionId: SessionId | null,
	) => Promise<Result<AgentLaunch>>;
	/** The provider key rows. Absent only in tests that do not use provider keys. */
	providerKeys?: ProviderKeyRepository;
	/** Where a typed provider key is kept. Absent only in tests that do not use provider keys. */
	keychain?: Pick<Keychain, "get" | "set" | "delete">;
<<<<<<< HEAD
	/** The files of both agents' config folders (SET-08). Absent only in tests that do not sync. */
	files?: FileSystem;
	/** Reads and writes the Codex TOML config (SET-08). Absent only in tests that do not sync. */
	toml?: TomlCodec;
=======
	/** The file system and home folder of the two config files. Absent only in tests that do not use them. */
	fs?: ConfigFileSystem;
>>>>>>> ae65f4dbcf4fb5ca8db05e0e598779fdaeef6796
}

/** The category order the sync dialog shows (SET-08). */
export const CONFIG_SYNC_CATEGORIES: readonly ConfigSyncCategory[] = [
	"mcp_servers",
	"slash_commands",
	"skills",
];

/** The store key of one preview: the source agent and its selected categories. */
export function configSyncKey(
	from: "claude" | "codex",
	categories: readonly ConfigSyncCategory[],
): string {
	return `${from}:${[...categories].sort().join(",")}`;
}

/** The categories a preview key names. */
export function categoriesOfConfigSyncKey(key: string): ConfigSyncCategory[] {
	const list = key.slice(key.indexOf(":") + 1);
	if (list === "") return [];
	return list.split(",") as ConfigSyncCategory[];
}

/** One agent's config as the sync reads it: servers, commands and skills by name. */
interface AgentConfigSnapshot {
	mcpServers: Record<string, Record<string, unknown>>;
	slashCommands: Record<string, string>;
	skills: Record<string, string>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value);

/** One value in a stable text form, so two entries compare whatever their key order. */
function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (isRecord(value)) {
		const keys = Object.keys(value).sort();
		return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
	}
	return JSON.stringify(value) ?? "null";
}

/** The changed lines of one entry, for the dialog's review step. */
function shortDiff(previous: string | null, next: string): string {
	const added = next.split("\n");
	if (previous === null) return added.map((line) => `+ ${line}`).join("\n");
	const removed = previous.split("\n");
	let start = 0;
	while (start < removed.length && start < added.length && removed[start] === added[start]) {
		start += 1;
	}
	let removedEnd = removed.length - 1;
	let addedEnd = added.length - 1;
	while (removedEnd >= start && addedEnd >= start && removed[removedEnd] === added[addedEnd]) {
		removedEnd -= 1;
		addedEnd -= 1;
	}
	return [
		...removed.slice(start, removedEnd + 1).map((line) => `- ${line}`),
		...added.slice(start, addedEnd + 1).map((line) => `+ ${line}`),
	].join("\n");
}

const otherAgent = (agent: "claude" | "codex"): "claude" | "codex" =>
	agent === "claude" ? "codex" : "claude";

const configFolder = (home: string, agent: "claude" | "codex"): string =>
	agent === "claude" ? `${home}/.claude` : `${home}/.codex`;

const mcpConfigPath = (home: string, agent: "claude" | "codex"): string =>
	agent === "claude" ? `${home}/.claude.json` : `${home}/.codex/config.toml`;

const commandsFolder = (home: string, agent: "claude" | "codex"): string =>
	agent === "claude" ? `${home}/.claude/commands` : `${home}/.codex/prompts`;

const skillsFolder = (home: string, agent: "claude" | "codex"): string =>
	`${configFolder(home, agent)}/skills`;

const baseName = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

/**
 * Whether every stored key of the agent reaches its launch, whatever the provider: true for an agent
 * that picks a provider in its own config (the agent-provider table's `configProviders`, OpenCode
 * and Pi), so the container passes them all.
 */
const keysShareVariables = (agent: AgentKind): boolean =>
	AGENT_PROVIDER_TABLE[agent].configProviders !== undefined;

/** The Keychain entry for one provider key. Stable, so saving twice replaces one entry. */
export function providerKeychainRef(key: ProviderKeyRef): string {
	return ["provider", key.agent, key.acpAgent ?? "", key.provider, key.envVar].join(":");
}

/** What the page may know about a saved key: never the value. */
function providerKeyView(key: ProviderKey): ProviderKeyView {
	return {
		agent: key.agent,
		acpAgent: key.acpAgent,
		provider: key.provider,
		envVar: key.envVar,
		source: key.source,
	};
}

/** The folder and file of an agent's own settings, under the user's home folder. */
function configFileFor(
	home: string,
	agent: AgentConfigFile["agent"],
): { folder: string; path: string } {
	const root = home.replace(/\/+$/, "");
	const folder = agent === "claude" ? `${root}/.claude` : `${root}/.codex`;
	const name = agent === "claude" ? "settings.json" : "config.toml";
	return { folder, path: `${folder}/${name}` };
}

type ConfigFileSystem = Pick<
	FileSystem,
	"readText" | "writeTextAtomic" | "stat" | "mkdirp" | "registerRoot" | "paths"
>;

export class AgentCatalogService {
	readonly store: StoreApi<AgentCatalogState>;
	readonly #deps: AgentCatalogServiceDeps;
	/** The newest model request per agent key. An older answer never changes the store. */
	readonly #modelRequests = new Map<string, number>();
	/** The newest install request. An older answer that arrives late changes nothing. */
	#installRequest = 0;
	/** Only the newest slash-command request for a chat changes state. */
	readonly #slashRequests = createLatestWins<SessionId>();
	/** Only the newest saved-list request for one repository and agent changes state. */
	readonly #preWorkspaceSlashRequests = createLatestWins<string>();
	/** Only the newest provider-key request for an agent changes state. */
	readonly #providerKeyRequests = createLatestWins<string>();
	/** Only the newest provider-list request for an agent changes state. */
	readonly #providerRequests = createLatestWins<string>();
<<<<<<< HEAD
	/** Only the newest config-sync preview for one source and category set changes state. */
	readonly #configSyncRequests = createLatestWins<string>();
=======
	/** Only the newest config-file request for an agent changes state. */
	readonly #configFileRequests = createLatestWins<AgentConfigFile["agent"]>();
>>>>>>> ae65f4dbcf4fb5ca8db05e0e598779fdaeef6796

	constructor(deps: AgentCatalogServiceDeps) {
		this.#deps = deps;
		this.store = createStore<AgentCatalogState>(() => ({
			installs: { state: "loading" },
			models: {},
			slashCommands: {},
			preWorkspaceSlashCommands: {},
			providerKeys: {},
			providers: {},
<<<<<<< HEAD
			configSyncPreview: {},
=======
			configFiles: {},
>>>>>>> ae65f4dbcf4fb5ca8db05e0e598779fdaeef6796
		}));
	}

	/** Backs `Actions.agents.refresh`. */
	async refresh(): Promise<Result<void>> {
		const request = ++this.#installRequest;
		const result = await this.#deps.sidecar.request("getAgentInstalls", {});
		if (request !== this.#installRequest) return ok(undefined);
		if (!result.ok) {
			this.store.setState({ installs: { state: "error", error: result.error } });
			return result;
		}
		this.store.setState({ installs: { state: "ready", data: result.value.agents } });
		return ok(undefined);
	}

	/** Called by the notification handler. It is newer truth than any request in flight. */
	setInstalls(agents: AgentInstall[]): void {
		this.#installRequest += 1;
		this.store.setState({ installs: { state: "ready", data: agents } });
	}

	async loadModels(agent: AgentKind, acpAgent?: AcpAgent): Promise<Result<ModelInfo[]>> {
		const key = agentKey(agent, acpAgent);
		const request = (this.#modelRequests.get(key) ?? 0) + 1;
		this.#modelRequests.set(key, request);
		this.store.setState((state) => ({
			models: { ...state.models, [key]: { state: "loading" } },
		}));
		const launch = await this.#deps.launchFor(agent, acpAgent, null);
		const result = launch.ok
			? await this.#deps.sidecar.request(
					"listModels",
					acpAgent === undefined
						? { agent, launch: launch.value }
						: { agent, acpAgent, launch: launch.value },
				)
			: launch;
		if (this.#modelRequests.get(key) !== request) {
			return result.ok ? ok(result.value.models) : err(result.error);
		}
		if (!result.ok) {
			this.store.setState((state) => ({
				models: { ...state.models, [key]: { state: "error", error: result.error } },
			}));
			return err(result.error);
		}
		this.store.setState((state) => ({
			models: { ...state.models, [key]: { state: "ready", data: result.value.models } },
		}));
		return ok(result.value.models);
	}

	/**
	 * Loads the slash commands of a chat's agent from the sidecar. The list is keyed by the chat,
	 * so a late answer for an older request never replaces the newer one.
	 */
	async loadSlashCommands(
		sessionId: SessionId,
		agent: AgentKind,
		acpAgent?: AcpAgent,
	): Promise<Result<SlashCommand[]>> {
		const ticket = this.#slashRequests.begin(sessionId);
		this.store.setState((state) => ({
			slashCommands: { ...state.slashCommands, [sessionId]: { state: "loading" } },
		}));
		const folders = await this.#chatFolders(sessionId, agent, acpAgent);
		if (!folders.ok) {
			if (this.#slashRequests.isLatest(ticket)) {
				this.#slashRequests.settle(ticket);
				this.store.setState((state) => ({
					slashCommands: {
						...state.slashCommands,
						[sessionId]: { state: "error", error: folders.error },
					},
				}));
			}
			return err(folders.error);
		}
		const result = await this.#deps.sidecar.request("listSlashCommands", {
			agent,
			acpAgent,
			// The sidecar lists from `workspacePath` and saves the list under `repoRootPath`, the key
			// the new-workspace composer reads before a workspace exists (SIDE-22).
			workspacePath: folders.value.workspacePath,
			repoRootPath: folders.value.repoRootPath,
			launch: folders.value.launch,
		});
		if (!this.#slashRequests.isLatest(ticket)) {
			this.#slashRequests.settle(ticket);
			return result.ok ? ok(result.value.commands) : err(result.error);
		}
		this.#slashRequests.settle(ticket);
		if (!result.ok) {
			this.store.setState((state) => ({
				slashCommands: {
					...state.slashCommands,
					[sessionId]: { state: "error", error: result.error },
				},
			}));
			return err(result.error);
		}
		this.store.setState((state) => ({
			slashCommands: {
				...state.slashCommands,
				[sessionId]: { state: "ready", data: result.value.commands },
			},
		}));
		return ok(result.value.commands);
	}

	/** A chat's workspace folder, its repository's root folder, and how its agent would start. */
	async #chatFolders(
		sessionId: SessionId,
		agent: AgentKind,
		acpAgent: AcpAgent | undefined,
	): Promise<Result<{ workspacePath: string; repoRootPath: string; launch: AgentLaunch }>> {
		const workspacePath = await this.#deps.workspacePathOf(sessionId);
		if (!workspacePath.ok) return workspacePath;
		const repoRootPath = await this.#deps.repoRootPathOf(sessionId);
		if (!repoRootPath.ok) return repoRootPath;
		const launch = await this.#deps.launchFor(agent, acpAgent, sessionId);
		if (!launch.ok) return launch;
		return ok({
			workspacePath: workspacePath.value,
			repoRootPath: repoRootPath.value,
			launch: launch.value,
		});
	}

	/**
	 * Loads the saved slash commands and skills of a repository, before any workspace path exists.
	 * The sidecar answers from its cache (SIDE-22). Only the newest request for the key wins.
	 */
	async loadPreWorkspaceSlashCommands(
		repoRootPath: string,
		agent: AgentKind,
		acpAgent?: AcpAgent,
	): Promise<Result<SlashCommand[]>> {
		const key = preWorkspaceSlashKey(repoRootPath, agent, acpAgent);
		const ticket = this.#preWorkspaceSlashRequests.begin(key);
		this.store.setState((state) => ({
			preWorkspaceSlashCommands: {
				...state.preWorkspaceSlashCommands,
				[key]: { state: "loading" },
			},
		}));
		const result = await this.#deps.sidecar.request("listSlashCommands", {
			agent,
			acpAgent,
			repoRootPath,
		});
		if (!this.#preWorkspaceSlashRequests.isLatest(ticket)) {
			this.#preWorkspaceSlashRequests.settle(ticket);
			return result.ok ? ok(result.value.commands) : err(result.error);
		}
		this.#preWorkspaceSlashRequests.settle(ticket);
		if (!result.ok) {
			this.store.setState((state) => ({
				preWorkspaceSlashCommands: {
					...state.preWorkspaceSlashCommands,
					[key]: { state: "error", error: result.error },
				},
			}));
			return err(result.error);
		}
		this.store.setState((state) => ({
			preWorkspaceSlashCommands: {
				...state.preWorkspaceSlashCommands,
				[key]: { state: "ready", data: result.value.commands },
			},
		}));
		return ok(result.value.commands);
	}

	/** Backs `Actions.agents.login`. */
	async login(agent: AgentKind, acpAgent?: AcpAgent): Promise<Result<AgentLogin>> {
		return this.#deps.sidecar.request("startAgentLogin", { agent, acpAgent });
	}

	/** Backs `Actions.agents.finishLogin`. A key Cursor hands back is refused, never stored. */
	async finishLogin(
		loginId: string,
		code?: string,
	): Promise<Result<{ outcome: "signed_in" | "failed" | "cancelled"; message: string | null }>> {
		const result = await this.#deps.sidecar.request("finishAgentLogin", {
			loginId,
			...(code === undefined ? {} : { code }),
		});
		if (!result.ok) return result;
		if (result.value.apiKey !== undefined) {
			return err(
				appError(
					"agent_key_not_stored",
					"This agent signs in with an API key. Enter it under Providers on the Agents page.",
				),
			);
		}
		return ok({ outcome: result.value.outcome, message: result.value.message ?? null });
	}

	/** Backs `Actions.agents.cancelLogin`. */
	async cancelLogin(loginId: string): Promise<Result<void>> {
		const result = await this.#deps.sidecar.request("cancelAgentLogin", { loginId });
		return result.ok ? ok(undefined) : result;
	}

	/**
	 * Backs `useProviderKeys`. Reads the rows of one agent. A late answer for an older request
	 * never replaces the newer list.
	 */
	async loadProviderKeys(
		agent: AgentKind,
		acpAgent?: AcpAgent,
	): Promise<Result<ProviderKeyView[]>> {
		const key = agentKey(agent, acpAgent);
		const ticket = this.#providerKeyRequests.begin(key);
		this.store.setState((state) => ({
			providerKeys: { ...state.providerKeys, [key]: { state: "loading" } },
		}));
		if (this.#deps.providerKeys === undefined) {
			const failure = appError(
				"agent_key_store_unavailable",
				"The provider key store is not available.",
			);
			this.#providerKeyRequests.settle(ticket);
			this.store.setState((state) => ({
				providerKeys: { ...state.providerKeys, [key]: { state: "error", error: failure } },
			}));
			return err(failure);
		}
		const listed = await this.#deps.providerKeys.listForAgent(agent, acpAgent ?? null);
		if (!this.#providerKeyRequests.isLatest(ticket)) {
			this.#providerKeyRequests.settle(ticket);
			return listed.ok ? ok(listed.value.map(providerKeyView)) : err(listed.error);
		}
		this.#providerKeyRequests.settle(ticket);
		if (!listed.ok) {
			this.store.setState((state) => ({
				providerKeys: { ...state.providerKeys, [key]: { state: "error", error: listed.error } },
			}));
			return err(listed.error);
		}
		const views = listed.value.map(providerKeyView);
		this.store.setState((state) => ({
			providerKeys: { ...state.providerKeys, [key]: { state: "ready", data: views } },
		}));
		return ok(views);
	}

	/**
	 * Backs `useAgentProviders`. Reads the providers one agent can use and the variables their keys
	 * go to. A late answer for an older request never replaces the newer list.
	 */
	async loadProviders(agent: AgentKind, acpAgent?: AcpAgent): Promise<Result<AgentProvider[]>> {
		const key = agentKey(agent, acpAgent);
		const ticket = this.#providerRequests.begin(key);
		this.store.setState((state) => ({
			providers: { ...state.providers, [key]: { state: "loading" } },
		}));
		const listed = await this.#deps.sidecar.request(
			"listAgentProviders",
			acpAgent === undefined ? { agent } : { agent, acpAgent },
		);
		if (!this.#providerRequests.isLatest(ticket)) {
			this.#providerRequests.settle(ticket);
			return listed.ok ? ok(listed.value.providers) : err(listed.error);
		}
		this.#providerRequests.settle(ticket);
		if (!listed.ok) {
			this.store.setState((state) => ({
				providers: { ...state.providers, [key]: { state: "error", error: listed.error } },
			}));
			return err(listed.error);
		}
		this.store.setState((state) => ({
			providers: { ...state.providers, [key]: { state: "ready", data: listed.value.providers } },
		}));
		return ok(listed.value.providers);
	}

	/** Backs `Actions.agents.setProviderKey`. */
	async setProviderKey(
		key: ProviderKeyRef,
		value: { kind: "entered"; value: string } | { kind: "this_mac" },
	): Promise<Result<void>> {
		const repository = this.#deps.providerKeys;
		const keychain = this.#deps.keychain;
		if (repository === undefined || keychain === undefined) {
			return err(
				appError("agent_key_store_unavailable", "The provider key store is not available."),
			);
		}
		const name = {
			agent: key.agent,
			acpAgent: key.acpAgent,
			provider: key.provider,
			envVar: key.envVar,
		};
		const existing = await repository.get(name);
		if (!existing.ok) return err(existing.error);

		if (value.kind === "entered") {
			const secret = value.value.trim();
			if (secret === "") {
				return err(appError("agent_key_empty", `Enter a value for ${key.envVar}.`));
			}
			const ref = providerKeychainRef(key);
			const stored = await keychain.set(ref, secret);
			if (!stored.ok) {
				return err(
					appError(
						"agent_key_not_saved",
						`The key could not be saved in the Keychain: ${stored.error.message}`,
						stored.error,
					),
				);
			}
			const saved = await repository.set(name, { source: "entered", keychainRef: ref });
			if (!saved.ok) {
				const removed = await keychain.delete(ref);
				return removed.ok ? err(saved.error) : err(removed.error);
			}
			const oldRef = existing.value?.keychainRef;
			if (oldRef !== null && oldRef !== undefined && oldRef !== ref) {
				const removed = await keychain.delete(oldRef);
				if (!removed.ok) return err(removed.error);
			}
		} else {
			const saved = await repository.set(name, { source: "this_mac" });
			if (!saved.ok) return err(saved.error);
			const oldRef = existing.value?.keychainRef;
			if (oldRef !== null && oldRef !== undefined) {
				const removed = await keychain.delete(oldRef);
				if (!removed.ok) return err(removed.error);
			}
		}
		if (keysShareVariables(key.agent)) {
			const others = await this.#removeVariable(key, (provider) => provider !== key.provider);
			if (!others.ok) return others;
		}
		const loaded = await this.loadProviderKeys(key.agent, key.acpAgent ?? undefined);
		return loaded.ok ? ok(undefined) : err(loaded.error);
	}

	/**
	 * Removes the agent's rows of `key.envVar` whose provider `matches`, with their Keychain entries.
	 * Stops at the first failure.
	 */
	async #removeVariable(
		key: ProviderKeyRef,
		matches: (provider: string) => boolean,
	): Promise<Result<void>> {
		const repository = this.#deps.providerKeys;
		const keychain = this.#deps.keychain;
		if (repository === undefined || keychain === undefined) {
			return err(
				appError("agent_key_store_unavailable", "The provider key store is not available."),
			);
		}
		const listed = await repository.listForAgent(key.agent, key.acpAgent);
		if (!listed.ok) return err(listed.error);
		for (const row of listed.value) {
			if (row.envVar !== key.envVar || !matches(row.provider)) continue;
			const deleted = await repository.delete(row);
			if (!deleted.ok) return err(deleted.error);
			if (row.keychainRef !== null) {
				const removed = await keychain.delete(row.keychainRef);
				if (!removed.ok) return err(removed.error);
			}
		}
		return ok(undefined);
	}

	/** Backs `Actions.agents.removeProviderKey`. Also removes the Keychain entry. */
	async removeProviderKey(key: ProviderKeyRef): Promise<Result<void>> {
		const repository = this.#deps.providerKeys;
		const keychain = this.#deps.keychain;
		if (repository === undefined || keychain === undefined) {
			return err(
				appError("agent_key_store_unavailable", "The provider key store is not available."),
			);
		}
		const name = {
			agent: key.agent,
			acpAgent: key.acpAgent,
			provider: key.provider,
			envVar: key.envVar,
		};
		if (keysShareVariables(key.agent)) {
			const removedAll = await this.#removeVariable(key, () => true);
			if (!removedAll.ok) return removedAll;
		} else {
			const existing = await repository.get(name);
			if (!existing.ok) return err(existing.error);
			const deleted = await repository.delete(name);
			if (!deleted.ok) return err(deleted.error);
			const ref = existing.value?.keychainRef;
			if (ref !== null && ref !== undefined) {
				const removed = await keychain.delete(ref);
				if (!removed.ok) return err(removed.error);
			}
		}
		const loaded = await this.loadProviderKeys(key.agent, key.acpAgent ?? undefined);
		return loaded.ok ? ok(undefined) : err(loaded.error);
	}

<<<<<<< HEAD
	/** The file and TOML dependencies, or an error when this service was built without them. */
	#configDeps(): Result<{ files: FileSystem; toml: TomlCodec }> {
		const { files, toml } = this.#deps;
		if (files === undefined || toml === undefined) {
			return err(appError("agent_config_sync_unavailable", "Agent config sync is not available."));
		}
		return ok({ files, toml });
	}

	/** Lets the file commands reach an agent's own folder before the sync reads or writes it. */
	async #ensureAgentScope(agent: "claude" | "codex"): Promise<Result<void>> {
		const deps = this.#configDeps();
		if (!deps.ok) return deps;
		return deps.value.files.registerRoot(configFolder(deps.value.files.paths.home, agent));
	}

	/** One agent's MCP server table from its own config file. A missing file holds none. */
	async #readMcpServers(
		agent: "claude" | "codex",
	): Promise<Result<Record<string, Record<string, unknown>>>> {
		const deps = this.#configDeps();
		if (!deps.ok) return deps;
		const { files, toml } = deps.value;
		const path = mcpConfigPath(files.paths.home, agent);
		if (!(await files.exists(path))) return ok({});
		const text = await files.readText(path);
		if (!text.ok) return err(text.error);
		if (text.value.trim() === "") return ok({});
		let document: Record<string, unknown>;
		if (agent === "claude") {
			try {
				const parsed: unknown = JSON.parse(text.value);
				if (!isRecord(parsed)) {
					return err(appError("agent_config_invalid", `${path} is not a JSON object.`));
				}
				document = parsed;
			} catch (cause) {
				return err(appError("agent_config_invalid", `${path} is not valid JSON.`, cause));
			}
		} else {
			const parsed = toml.parse(text.value);
			if (!parsed.ok) return err(parsed.error);
			document = parsed.value;
		}
		const table = document[agent === "claude" ? "mcpServers" : "mcp_servers"];
		if (table === undefined) return ok({});
		if (!isRecord(table)) {
			return err(appError("agent_config_invalid", `${path} does not hold an MCP server table.`));
		}
		const servers: Record<string, Record<string, unknown>> = {};
		for (const [name, value] of Object.entries(table)) {
			if (!isRecord(value)) {
				return err(
					appError("agent_config_invalid", `${path} has no valid entry for MCP server ${name}.`),
				);
			}
			servers[name] = value;
		}
		return ok(servers);
	}

	/** Every `.md` file of a commands folder, by its name without the extension. */
	async #readMarkdownFolder(folder: string): Promise<Result<Record<string, string>>> {
		const deps = this.#configDeps();
		if (!deps.ok) return deps;
		const files = deps.value.files;
		if (!(await files.exists(folder))) return ok({});
		const listed = await files.readDir(folder);
		if (!listed.ok) return err(listed.error);
		const entries: Record<string, string> = {};
		for (const entry of listed.value) {
			if (entry.isDirectory || !entry.path.endsWith(".md")) continue;
			const name = baseName(entry.path).slice(0, -3);
			if (name === "") continue;
			const text = await files.readText(entry.path);
			if (!text.ok) return err(text.error);
			entries[name] = text.value;
		}
		return ok(entries);
	}

	/** Every skill folder with a `SKILL.md`, by the folder's name. */
	async #readSkillsFolder(folder: string): Promise<Result<Record<string, string>>> {
		const deps = this.#configDeps();
		if (!deps.ok) return deps;
		const files = deps.value.files;
		if (!(await files.exists(folder))) return ok({});
		const listed = await files.readDir(folder);
		if (!listed.ok) return err(listed.error);
		const entries: Record<string, string> = {};
		for (const entry of listed.value) {
			if (!entry.isDirectory) continue;
			const name = baseName(entry.path);
			const path = `${entry.path}/SKILL.md`;
			if (name === "" || !(await files.exists(path))) continue;
			const text = await files.readText(path);
			if (!text.ok) return err(text.error);
			entries[name] = text.value;
		}
		return ok(entries);
	}

	/** One agent's servers, commands and skills, read from its own config files. */
	async #readConfigSnapshot(
		agent: "claude" | "codex",
		categories: readonly ConfigSyncCategory[],
	): Promise<Result<AgentConfigSnapshot>> {
		const deps = this.#configDeps();
		if (!deps.ok) return deps;
		const scope = await this.#ensureAgentScope(agent);
		if (!scope.ok) return scope;
		const home = deps.value.files.paths.home;
		const snapshot: AgentConfigSnapshot = { mcpServers: {}, slashCommands: {}, skills: {} };
		if (categories.includes("mcp_servers")) {
			const servers = await this.#readMcpServers(agent);
			if (!servers.ok) return err(servers.error);
			snapshot.mcpServers = servers.value;
		}
		if (categories.includes("slash_commands")) {
			const commands = await this.#readMarkdownFolder(commandsFolder(home, agent));
			if (!commands.ok) return err(commands.error);
			snapshot.slashCommands = commands.value;
		}
		if (categories.includes("skills")) {
			const skills = await this.#readSkillsFolder(skillsFolder(home, agent));
			if (!skills.ok) return err(skills.error);
			snapshot.skills = skills.value;
		}
		return ok(snapshot);
	}

	/** The changes a sync would make, with both sides read from disk. */
	async #configChanges(
		from: "claude" | "codex",
		categories: readonly ConfigSyncCategory[],
	): Promise<Result<ConfigSyncChange[]>> {
		const source = await this.#readConfigSnapshot(from, categories);
		if (!source.ok) return err(source.error);
		const destination = await this.#readConfigSnapshot(otherAgent(from), categories);
		if (!destination.ok) return err(destination.error);
		return ok(configChangesOf(source.value, destination.value, categories));
	}

	/**
	 * Backs `useConfigSyncPreview`. Reads both agents' configs and keeps the newest answer for one
	 * source and category set.
	 */
	async loadConfigSyncPreview(
		from: "claude" | "codex",
		categories: readonly ConfigSyncCategory[],
	): Promise<Result<ConfigSyncChange[]>> {
		const key = configSyncKey(from, categories);
		const ticket = this.#configSyncRequests.begin(key);
		this.store.setState((state) => ({
			configSyncPreview: {
				...state.configSyncPreview,
				[key]: { state: "loading" },
			},
		}));
		const changes = await this.#configChanges(from, categories);
		if (!this.#configSyncRequests.isLatest(ticket)) {
			this.#configSyncRequests.settle(ticket);
			return changes;
		}
		this.#configSyncRequests.settle(ticket);
		if (!changes.ok) {
			this.store.setState((state) => ({
				configSyncPreview: {
					...state.configSyncPreview,
					[key]: { state: "error", error: changes.error },
				},
			}));
			return err(changes.error);
		}
		this.store.setState((state) => ({
			configSyncPreview: {
				...state.configSyncPreview,
				[key]: { state: "ready", data: changes.value },
			},
		}));
		return ok(changes.value);
	}

	/** Writes one agent's MCP table into its own config file. */
	async #writeMcpServers(
		agent: "claude" | "codex",
		servers: Record<string, Record<string, unknown>>,
	): Promise<Result<void>> {
		const deps = this.#configDeps();
		if (!deps.ok) return deps;
		const { files, toml } = deps.value;
		const scope = await this.#ensureAgentScope(agent);
		if (!scope.ok) return scope;
		const made = await files.mkdirp(configFolder(files.paths.home, agent));
		if (!made.ok) return err(made.error);
		const path = mcpConfigPath(files.paths.home, agent);
		const existing = (await files.exists(path)) ? await files.readText(path) : null;
		if (existing !== null && !existing.ok) return err(existing.error);
		let text: string;
		if (agent === "claude") {
			let document: Record<string, unknown> = {};
			if (existing?.ok && existing.value.trim() !== "") {
				try {
					const parsed: unknown = JSON.parse(existing.value);
					if (!isRecord(parsed)) {
						return err(appError("agent_config_invalid", `${path} is not a JSON object.`));
					}
					document = parsed;
				} catch (cause) {
					return err(appError("agent_config_invalid", `${path} is not valid JSON.`, cause));
				}
			}
			document.mcpServers = servers;
			text = `${JSON.stringify(document, null, 2)}\n`;
		} else if (existing?.ok && existing.value.trim() !== "") {
			const parsed = toml.parse(existing.value);
			if (!parsed.ok) return err(parsed.error);
			const patched = toml.patch(existing.value, { ...parsed.value, mcp_servers: servers });
			if (!patched.ok) return err(patched.error);
			text = patched.value;
		} else {
			text = `${toml.stringify({ mcp_servers: servers })}\n`;
		}
		return files.writeTextAtomic(path, text);
	}

	/**
	 * Backs `Actions.agents.syncConfigs`. Copies the selected categories from one agent's config
	 * into the other's. One entry that cannot be written does not stop the rest.
	 */
	async syncConfigs(
		from: "claude" | "codex",
		categories: readonly ConfigSyncCategory[],
	): Promise<Result<ConfigSyncResult>> {
		const deps = this.#configDeps();
		if (!deps.ok) return deps;
		const to = otherAgent(from);
		const source = await this.#readConfigSnapshot(from, categories);
		if (!source.ok) return err(source.error);
		const destination = await this.#readConfigSnapshot(to, categories);
		if (!destination.ok) return err(destination.error);
		const changes = configChangesOf(source.value, destination.value, categories);
		const failures: ConfigSyncResult["failures"] = [];
		let applied = 0;

		const mcpChanges = changes.filter((change) => change.category === "mcp_servers");
		if (mcpChanges.length > 0) {
			const servers = { ...destination.value.mcpServers };
			for (const change of mcpChanges) {
				const server = source.value.mcpServers[change.name];
				if (server !== undefined) servers[change.name] = server;
			}
			const written = await this.#writeMcpServers(to, servers);
			if (written.ok) {
				applied += mcpChanges.length;
			} else {
				for (const change of mcpChanges) {
					failures.push({
						category: change.category,
						name: change.name,
						message: written.error.message,
					});
				}
			}
		}

		const home = deps.value.files.paths.home;
		for (const change of changes) {
			if (change.category === "mcp_servers") continue;
			const entries =
				change.category === "slash_commands" ? source.value.slashCommands : source.value.skills;
			const text = entries[change.name];
			if (text === undefined) continue;
			const folder =
				change.category === "slash_commands" ? commandsFolder(home, to) : skillsFolder(home, to);
			const path =
				change.category === "slash_commands"
					? `${folder}/${change.name}.md`
					: `${folder}/${change.name}/SKILL.md`;
			const made = await deps.value.files.mkdirp(
				change.category === "slash_commands" ? folder : `${folder}/${change.name}`,
			);
			if (!made.ok) {
				failures.push({
					category: change.category,
					name: change.name,
					message: made.error.message,
				});
				continue;
			}
			const written = await deps.value.files.writeTextAtomic(path, text);
			if (written.ok) {
				applied += 1;
			} else {
				failures.push({
					category: change.category,
					name: change.name,
					message: written.error.message,
				});
			}
		}

		const key = configSyncKey(from, categories);
		const remaining = await this.#configChanges(from, categories);
		this.#configSyncRequests.invalidate(key);
		this.store.setState((state) => ({
			configSyncPreview: {
				...state.configSyncPreview,
				[key]: remaining.ok
					? { state: "ready", data: remaining.value }
					: { state: "error", error: remaining.error },
			},
		}));
		return ok({ applied, failures });
	}

	/** Backs `Actions.agents.saveConfigFile`. */
	saveConfigFile(
		_agent: AgentConfigFile["agent"],
		_text: string,
		_expectedModifiedAt: number | null,
=======
	/**
	 * Backs `useAgentConfigFile`. Reads one agent's own settings file. A missing file is a ready
	 * value with empty text, so the editor can create it. A late answer for an older read never
	 * replaces the newer one.
	 */
	async loadConfigFile(agent: AgentConfigFile["agent"]): Promise<Result<AgentConfigFile>> {
		const ticket = this.#configFileRequests.begin(agent);
		this.store.setState((state) => ({
			configFiles: { ...state.configFiles, [agent]: { state: "loading" } },
		}));
		const read = await this.#readConfigFile(agent);
		if (!this.#configFileRequests.isLatest(ticket)) {
			this.#configFileRequests.settle(ticket);
			return read;
		}
		this.#configFileRequests.settle(ticket);
		if (!read.ok) {
			this.store.setState((state) => ({
				configFiles: { ...state.configFiles, [agent]: { state: "error", error: read.error } },
			}));
			return read;
		}
		this.store.setState((state) => ({
			configFiles: { ...state.configFiles, [agent]: { state: "ready", data: read.value } },
		}));
		return read;
	}

	/**
	 * Backs `Actions.agents.saveConfigFile`. Writes the text only when the file still has the
	 * modified time the editor read, so a change made elsewhere is never overwritten. On success
	 * the store reloads from disk.
	 */
	async saveConfigFile(
		agent: AgentConfigFile["agent"],
		text: string,
		expectedModifiedAt: number | null,
>>>>>>> ae65f4dbcf4fb5ca8db05e0e598779fdaeef6796
	): Promise<Result<void>> {
		const fs = this.#deps.fs;
		if (fs === undefined) return err(this.#configFilesUnavailable());
		const { folder, path } = configFileFor(fs.paths.home, agent);
		const registered = await fs.registerRoot(folder);
		if (!registered.ok) return err(registered.error);

		const info = await fs.stat(path);
		let current: number | null;
		if (info.ok) current = info.value.modifiedAt;
		else if (info.error.code === "fs_not_found") current = null;
		else return err(info.error);

		if (current !== expectedModifiedAt) {
			return err(
				appError(
					"changed_on_disk",
					`${path} changed on disk since it was opened. Close and reopen the editor to see the new text.`,
				),
			);
		}

		const made = await fs.mkdirp(folder);
		if (!made.ok) return err(made.error);
		const written = await fs.writeTextAtomic(path, text);
		if (!written.ok) return err(written.error);
		const loaded = await this.loadConfigFile(agent);
		return loaded.ok ? ok(undefined) : err(loaded.error);
	}

	async #readConfigFile(agent: AgentConfigFile["agent"]): Promise<Result<AgentConfigFile>> {
		const fs = this.#deps.fs;
		if (fs === undefined) return err(this.#configFilesUnavailable());
		const { folder, path } = configFileFor(fs.paths.home, agent);
		const registered = await fs.registerRoot(folder);
		if (!registered.ok) return err(registered.error);

		const info = await fs.stat(path);
		if (!info.ok) {
			if (info.error.code === "fs_not_found") {
				return ok({ agent, path, text: "", exists: false, modifiedAt: null });
			}
			return err(info.error);
		}
		const read = await fs.readText(path);
		if (!read.ok) return err(read.error);
		return ok({ agent, path, text: read.value, exists: true, modifiedAt: info.value.modifiedAt });
	}

	#configFilesUnavailable() {
		return appError("agent_config_unavailable", "The agent configuration files are not available.");
	}
}

/** The changes from one snapshot to the other, in the dialog's category order. */
function configChangesOf(
	source: AgentConfigSnapshot,
	destination: AgentConfigSnapshot,
	categories: readonly ConfigSyncCategory[],
): ConfigSyncChange[] {
	const changes: ConfigSyncChange[] = [];
	if (categories.includes("mcp_servers")) {
		for (const name of Object.keys(source.mcpServers).sort()) {
			const next = source.mcpServers[name];
			if (next === undefined) continue;
			const previous = destination.mcpServers[name];
			const renderedNext = JSON.stringify(next, null, 2);
			if (previous === undefined) {
				changes.push({
					category: "mcp_servers",
					name,
					change: "add",
					diff: shortDiff(null, renderedNext),
				});
			} else if (canonicalJson(previous) !== canonicalJson(next)) {
				changes.push({
					category: "mcp_servers",
					name,
					change: "update",
					diff: shortDiff(JSON.stringify(previous, null, 2), renderedNext),
				});
			}
		}
	}
	for (const category of ["slash_commands", "skills"] as const) {
		if (!categories.includes(category)) continue;
		const sourceEntries = category === "slash_commands" ? source.slashCommands : source.skills;
		const destinationEntries =
			category === "slash_commands" ? destination.slashCommands : destination.skills;
		for (const name of Object.keys(sourceEntries).sort()) {
			const next = sourceEntries[name];
			if (next === undefined) continue;
			const previous = destinationEntries[name];
			if (previous === undefined) {
				changes.push({ category, name, change: "add", diff: shortDiff(null, next) });
			} else if (previous !== next) {
				changes.push({
					category,
					name,
					change: "update",
					diff: shortDiff(previous, next),
				});
			}
		}
	}
	return changes;
}
