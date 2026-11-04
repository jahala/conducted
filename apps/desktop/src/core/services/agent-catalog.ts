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
 * returns instructions and optionally a URL and code, and never stores a token itself.
 * Our design choice: the catalogue caches per agent key in memory only. Nothing about models is
 * saved to disk.
 * Test first: two requests for one agent key, answered out of order, leave the newer answer.
 */
import type { AgentInstall, ModelInfo, SlashCommand } from "@conducted/protocol";
import type { AcpAgent, AgentKind, Result, SessionId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { Loadable } from "../api.ts";
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
	login(
		_agent: AgentKind,
		_acpAgent?: AcpAgent,
	): Promise<Result<{ url?: string; code?: string; instructions: string }>> {
		return notImplemented("SET-03");
	}
}
