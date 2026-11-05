/**
 * @feature SET-03 Agent catalogue: installs, models, slash commands, sign-in
 * Owns: what the sidecar says about agents: which are installed and signed in, the model list per
 * agent, the slash commands of a workspace, and starting a sign-in flow.
 * Behaviour: other-runners.md 5 (model catalog, detection), claude-runner.md 7 (slash commands),
 * services-map.md 5B.5 (model catalog and favourites), ui-map.md 6 (Agents page states).
 * Must handle: the sidecar is not up yet (the state stays "loading", requests wait for the
 * tunnel); an `agentInstallsChanged` notification replaces the list without a request; a model
 * list request for an agent that is not installed returns an Err with the sidecar's code
 * `agentNotInstalled`; slow model lists (ACP) must not block the picker's other agents; only the
 * newest answer for an install list wins (a late answer for an older request is dropped); a
 * sign-in flow returns instructions and optionally a URL, a user code or a terminal command, ends
 * with finishLogin or cancelLogin. A key an agent hands back (Cursor) has no Keychain home until
 * SET-09 builds it, so this service refuses the outcome instead of dropping the secret on the
 * floor.
 * Our design choice: the catalogue caches per agent key in memory only. Nothing about models is
 * saved to disk.
 * Test first: two refreshes of the install list, answered out of order, leave the newer answer.
 */
import type { AgentInstall, AgentLogin, ModelInfo, SlashCommand } from "@conducted/protocol";
import type { AcpAgent, AgentKind, Result, SessionId } from "@conducted/shared";
import { appError, err, notImplemented, ok } from "@conducted/shared";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { Loadable, ProviderKeyRef } from "../api.ts";
import type { AgentConfigFile, ConfigSyncCategory, ConfigSyncResult } from "../model.ts";
import type { SidecarClient } from "../sidecar/tunnel.ts";

export interface AgentCatalogState {
	installs: Loadable<AgentInstall[]>;
	/** Keyed by `agentKey(agent, acpAgent)`. */
	models: Readonly<Record<string, Loadable<ModelInfo[]>>>;
	slashCommands: Readonly<Record<string, Loadable<SlashCommand[]>>>;
}

export const agentKey = (agent: AgentKind, acpAgent?: AcpAgent): string =>
	acpAgent === undefined ? agent : `${agent}:${acpAgent}`;

export interface AgentCatalogServiceDeps {
	sidecar: Pick<SidecarClient, "request">;
	/** Workspace folder of a chat, for slash commands. */
	workspacePathOf: (sessionId: SessionId) => Promise<Result<string>>;
}

export class AgentCatalogService {
	readonly store: StoreApi<AgentCatalogState>;
	readonly #deps: AgentCatalogServiceDeps;
	/** The newest model request per agent key. An older answer never changes the store. */
	readonly #modelRequests = new Map<string, number>();
	/** The newest install request. An older answer that arrives late changes nothing. */
	#installRequest = 0;

	constructor(deps: AgentCatalogServiceDeps) {
		this.#deps = deps;
		this.store = createStore<AgentCatalogState>(() => ({
			installs: { state: "loading" },
			models: {},
			slashCommands: {},
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

	loadSlashCommands(_sessionId: SessionId): Promise<Result<SlashCommand[]>> {
		return notImplemented("COMP-06");
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
					"This agent signs in with an API key, and storing that key is not built yet. Enter the key in the agent's own settings.",
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

	/** Backs `Actions.agents.setProviderKey`. */
	setProviderKey(
		_key: ProviderKeyRef,
		_value: { kind: "entered"; value: string } | { kind: "this_mac" },
	): Promise<Result<void>> {
		return notImplemented("SET-09");
	}

	/** Backs `Actions.agents.removeProviderKey`. Also removes the Keychain entry. */
	removeProviderKey(_key: ProviderKeyRef): Promise<Result<void>> {
		return notImplemented("SET-09");
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
