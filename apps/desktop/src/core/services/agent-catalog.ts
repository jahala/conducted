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
 * newest answer for a key wins (a late answer for an older request is dropped); a sign-in flow
 * returns instructions and optionally a URL, a user code or a terminal command, ends with
 * finishLogin or cancelLogin, and a key an agent hands back (Cursor) goes only to the Keychain.
 * Our design choice: the catalogue caches per agent key in memory only. Nothing about models is
 * saved to disk.
 * Test first: two requests for one agent key, answered out of order, leave the newer answer.
 */
import type { AgentInstall, AgentLogin, ModelInfo, SlashCommand } from "@conducted/protocol";
import type { AcpAgent, AgentKind, Result, SessionId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";
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

	constructor(deps: AgentCatalogServiceDeps) {
		this.#deps = deps;
		this.store = createStore<AgentCatalogState>(() => ({
			installs: { state: "loading" },
			models: {},
			slashCommands: {},
		}));
	}

	/** Backs `Actions.agents.refresh`. */
	refresh(): Promise<Result<void>> {
		void this.#deps;
		return notImplemented("SET-03");
	}

	/** Called by the notification handler. */
	setInstalls(_agents: AgentInstall[]): void {
		notImplemented("SET-03");
	}

	loadModels(_agent: AgentKind, _acpAgent?: AcpAgent): Promise<Result<ModelInfo[]>> {
		return notImplemented("COMP-02");
	}

	loadSlashCommands(_sessionId: SessionId): Promise<Result<SlashCommand[]>> {
		return notImplemented("COMP-06");
	}

	/** Backs `Actions.agents.login`. */
	login(_agent: AgentKind, _acpAgent?: AcpAgent): Promise<Result<AgentLogin>> {
		return notImplemented("SET-03");
	}

	/** Backs `Actions.agents.finishLogin`. A key Cursor hands back goes to the Keychain, never to the store. */
	finishLogin(
		_loginId: string,
		_code?: string,
	): Promise<Result<{ outcome: "signed_in" | "failed" | "cancelled"; message: string | null }>> {
		return notImplemented("SET-03");
	}

	/** Backs `Actions.agents.cancelLogin`. */
	cancelLogin(_loginId: string): Promise<Result<void>> {
		return notImplemented("SET-03");
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
