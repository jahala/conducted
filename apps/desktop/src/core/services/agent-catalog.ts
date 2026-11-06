/**
 * @feature SET-03 Agent catalogue: installs, models, slash commands, sign-in; SET-09 provider keys;
 * SET-10 OpenCode providers and their keys
 * @feature SIDE-22 Slash command cache that works before a chat starts
 * Owns: what the sidecar says about agents: which are installed and signed in, the model list per
 * agent, the slash commands of a workspace and of a repository before a workspace exists, starting
 * a sign-in flow, an agent's provider keys and the providers an agent can use.
 * Also the display name and catalogue key that the Agents page and the model picker share.
 * Behaviour: other-runners.md 5 (model catalog, detection), claude-runner.md 7 (slash commands),
 * services-map.md 5B.5 (model catalog and favourites), ui-map.md 6 (Agents page states and provider
 * credential forms), services-map.md 4.2.8 (provider keys), D033 (one strip list; only the agent's
 * own provider keys reach it).
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
 * same variable under the others, and removing it removes it for every provider.
 * Our design choice: the catalogue caches per agent key in memory only. Nothing about models is
 * saved to disk. A provider key's Keychain name is built from the agent, ACP agent, provider and
 * variable, so saving the same key twice replaces one entry. OpenCode and Pi use OpenCode's own
 * provider catalogue (SET-10).
 * Test first: two refreshes of the install list, answered out of order, leave the newer answer;
 * two model lists for one agent key, answered out of order, leave the newer answer; two provider
 * key lists for one agent, answered out of order, leave the newer answer; two provider lists for
 * one agent, answered out of order, leave the newer answer.
 */
import type {
	AgentInstall,
	AgentLogin,
	AgentProvider,
	ModelInfo,
	SlashCommand,
} from "@conducted/protocol";
import type { AcpAgent, AgentKind, Result, SessionId } from "@conducted/shared";
import { appError, err, notImplemented, ok } from "@conducted/shared";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { Keychain } from "../../platform/platform.ts";
import type { Loadable, ProviderKeyRef } from "../api.ts";
import { createLatestWins } from "../async/latest-wins.ts";
import type { ProviderKey, ProviderKeyRepository } from "../db/provider-keys.ts";
import type {
	AgentConfigFile,
	ConfigSyncCategory,
	ConfigSyncResult,
	ProviderKeyView,
} from "../model.ts";
import type { SidecarClient } from "../sidecar/tunnel.ts";

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
	/** The provider key rows. Absent only in tests that do not use provider keys. */
	providerKeys?: ProviderKeyRepository;
	/** Where a typed provider key is kept. Absent only in tests that do not use provider keys. */
	keychain?: Pick<Keychain, "get" | "set" | "delete">;
}

/**
 * Whether every stored key of the agent reaches its launch, whatever the provider. True for the
 * ACP agents: they pick a provider in their own config, so the container passes them all.
 */
export const keysShareVariables = (agent: AgentKind): boolean => agent === "acp";

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

	constructor(deps: AgentCatalogServiceDeps) {
		this.#deps = deps;
		this.store = createStore<AgentCatalogState>(() => ({
			installs: { state: "loading" },
			models: {},
			slashCommands: {},
			preWorkspaceSlashCommands: {},
			providerKeys: {},
			providers: {},
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
		const result = await this.#deps.sidecar.request(
			"listModels",
			acpAgent === undefined ? { agent } : { agent, acpAgent },
		);
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
		const folders = await this.#chatFolders(sessionId);
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

	/** A chat's workspace folder and its repository's root folder. */
	async #chatFolders(
		sessionId: SessionId,
	): Promise<Result<{ workspacePath: string; repoRootPath: string }>> {
		const workspacePath = await this.#deps.workspacePathOf(sessionId);
		if (!workspacePath.ok) return workspacePath;
		const repoRootPath = await this.#deps.repoRootPathOf(sessionId);
		if (!repoRootPath.ok) return repoRootPath;
		return ok({ workspacePath: workspacePath.value, repoRootPath: repoRootPath.value });
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

	/** Backs `Actions.agents.saveConfigFile`. */
	saveConfigFile(
		_agent: AgentConfigFile["agent"],
		_text: string,
		_expectedModifiedAt: number | null,
	): Promise<Result<void>> {
		return notImplemented("SET-12");
	}

	/** Backs `Actions.agents.syncConfigs`. */
	syncConfigs(
		_from: "claude" | "codex",
		_categories: readonly ConfigSyncCategory[],
	): Promise<Result<ConfigSyncResult>> {
		return notImplemented("SET-08");
	}
}
