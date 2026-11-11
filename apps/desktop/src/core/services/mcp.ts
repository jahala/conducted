/**
 * @feature SET-05 MCP servers: list, status and logs
 * Owns: asking the sidecar which MCP servers an agent sees in a workspace and their status, and
 * refreshing that list for one chat.
 * Behaviour: services-map.md 5B.6 (per-session availability; local agents read their own native
 * config files, Conducted stores nothing for local MCP), ui-map.md 3.10 (MCP status popover).
 * Must handle: a server that needs sign-in (`needs_auth`) is shown with that state, not hidden;
 * a server the agent reports without a scope or transport (null, never a guess);
 * a failing agent start returns an Err, not an empty list; the list is per workspace and agent,
 * and refreshing replaces it; only the newest answer for a key wins; a forgotten chat asks the
 * sidecar again on its next view, and a refresh already running cannot put the old list back.
 * Our design choice: the cloud parts (organisation servers, catalogue, import scan) are out. This
 * service only reads status.
 * Our design choice: the sidecar reports no separate log stream for an MCP server today. The log
 * shown for a failed server is the failure text the sidecar reported, so the user can read it and
 * copy it.
 * Test first: a refresh that answers after a newer refresh does not replace the newer list.
 */
import type { AgentLaunch, appToSidecarRequests, ResultOf } from "@conducted/protocol";
import type { AcpAgent, AgentKind, AppError, Result, SessionId } from "@conducted/shared";
import { err, ok } from "@conducted/shared";
import { createStore, type StoreApi } from "zustand/vanilla";
import { agentKey } from "../agent-catalog.ts";
import type { Loadable } from "../api.ts";
import { createLatestWins, type LatestTicket } from "../async/latest-wins.ts";
import type { McpServerView } from "../model.ts";
import type { SidecarClient } from "../sidecar/tunnel.ts";

type ListedServer = ResultOf<typeof appToSidecarRequests.listMcpServers>["servers"][number];

export interface McpState {
	/** Keyed by `<workspacePath>|<agent key>`. */
	servers: Readonly<Record<string, Loadable<McpServerView[]>>>;
}

export interface McpRefreshInput {
	agent: AgentKind;
	acpAgent?: AcpAgent;
	workspacePath: string;
	/** The chat whose launch the list uses. Left out when no chat is involved. */
	sessionId?: SessionId;
}

export interface McpServiceDeps {
	sidecar: Pick<SidecarClient, "request">;
	/** Folder of the workspace a chat belongs to. */
	workspacePathOf: (sessionId: SessionId) => Promise<Result<string>>;
	/** The agent a chat runs. */
	agentOf: (sessionId: SessionId) => Result<{ agent: AgentKind; acpAgent?: AcpAgent }>;
	/** How a chat's agent would start (SIDE-21), so the list runs the chosen program and keys. */
	launchFor: (
		agent: AgentKind,
		acpAgent: AcpAgent | undefined,
		sessionId: SessionId | null,
	) => Promise<Result<AgentLaunch>>;
}

/** The store key for one workspace and agent. */
export const mcpKey = (workspacePath: string, agent: AgentKind, acpAgent?: AcpAgent): string =>
	`${workspacePath}|${agentKey(agent, acpAgent)}`;

/**
 * A listed server as the list and dialog show it. The scope and transport are the agent's own
 * words, and null when it gives none: the app does not guess where a server came from.
 */
function toView(server: ListedServer): McpServerView {
	const error = server.error ?? null;
	return {
		name: server.name,
		source: server.scope ?? null,
		transport: server.transport ?? null,
		status: server.status,
		toolCount: server.toolCount ?? (server.tools === undefined ? null : server.tools.length),
		error,
		logTail: error === null ? [] : [error],
	};
}

export class McpService {
	readonly store: StoreApi<McpState>;
	readonly #deps: McpServiceDeps;
	/** Only the newest refresh for one workspace and agent changes state. */
	readonly #requests = createLatestWins<string>();

	constructor(deps: McpServiceDeps) {
		this.#deps = deps;
		this.store = createStore<McpState>(() => ({ servers: {} }));
	}

	async refresh(input: McpRefreshInput): Promise<Result<McpServerView[]>> {
		const key = mcpKey(input.workspacePath, input.agent, input.acpAgent);
		const ticket = this.#requests.begin(key);
		this.store.setState((state) => ({
			servers: { ...state.servers, [key]: { state: "loading" } },
		}));

		const launch =
			input.sessionId === undefined
				? ok<AgentLaunch | undefined>(undefined)
				: await this.#deps.launchFor(input.agent, input.acpAgent, input.sessionId);
		if (!launch.ok) {
			return this.#finish(ticket, key, launch);
		}
		const result = await this.#deps.sidecar.request("listMcpServers", {
			agent: input.agent,
			acpAgent: input.acpAgent,
			workspacePath: input.workspacePath,
			...(launch.value === undefined ? {} : { launch: launch.value }),
		});
		if (!result.ok) return this.#finish(ticket, key, result);

		const servers = result.value.servers.map(toView);
		if (!this.#requests.isLatest(ticket)) {
			this.#requests.settle(ticket);
			return ok(servers);
		}
		this.#requests.settle(ticket);
		this.store.setState((state) => ({
			servers: { ...state.servers, [key]: { state: "ready", data: servers } },
		}));
		return ok(servers);
	}

	/** Backs `Actions.mcp.refresh`: refreshes the servers of one chat's agent and workspace. */
	async refreshSession(sessionId: SessionId): Promise<Result<void>> {
		const agent = this.#deps.agentOf(sessionId);
		if (!agent.ok) return err(agent.error);
		const workspacePath = await this.#deps.workspacePathOf(sessionId);
		if (!workspacePath.ok) return err(workspacePath.error);
		const refreshed = await this.refresh({
			agent: agent.value.agent,
			acpAgent: agent.value.acpAgent,
			workspacePath: workspacePath.value,
			sessionId,
		});
		return refreshed.ok ? ok(undefined) : err(refreshed.error);
	}

	/**
	 * Backs `Actions.mcp.forget`: drops a chat's cached list, so the next look asks the agent again.
	 * The composer calls it after a terminal command changed the agent's own config files. A refresh
	 * already in flight for the key is made stale, so its late answer cannot restore the old list.
	 */
	async forgetSession(sessionId: SessionId): Promise<Result<void>> {
		const agent = this.#deps.agentOf(sessionId);
		if (!agent.ok) return err(agent.error);
		const workspacePath = await this.#deps.workspacePathOf(sessionId);
		if (!workspacePath.ok) return err(workspacePath.error);
		const key = mcpKey(workspacePath.value, agent.value.agent, agent.value.acpAgent);
		this.#requests.invalidate(key);
		this.store.setState((state) => {
			const servers = { ...state.servers };
			delete servers[key];
			return { servers };
		});
		return ok(undefined);
	}

	/** Stores a failure for the newest request, and keeps the newest request's state for older ones. */
	#finish(
		ticket: LatestTicket<string>,
		key: string,
		failure: { ok: false; error: AppError },
	): Result<never> {
		if (!this.#requests.isLatest(ticket)) {
			this.#requests.settle(ticket);
			return err(failure.error);
		}
		this.#requests.settle(ticket);
		this.store.setState((state) => ({
			servers: { ...state.servers, [key]: { state: "error", error: failure.error } },
		}));
		return err(failure.error);
	}
}
