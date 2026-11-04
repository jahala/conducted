/**
 * @feature SET-05 MCP servers: list and status
 * Owns: asking the sidecar which MCP servers an agent sees in a workspace and their status.
 * Behaviour: services-map.md 5B.6 (per-session availability; local agents read their own native
 * config files, Conducted stores nothing for local MCP), ui-map.md 3.10 (MCP status popover).
 * Must handle: a server that needs sign-in (`needs_auth`) is shown with that state, not hidden;
 * a failing agent start returns an Err, not an empty list; the list is per workspace and agent,
 * and refreshing replaces it; only the newest answer for a key wins.
 * Our design choice: the cloud parts (organisation servers, catalogue, import scan) are out. This
 * service only reads status.
 * Test first: a refresh that answers after a newer refresh does not replace the newer list.
 */
import type { AcpAgent, AgentKind, Result, SessionId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { Loadable } from "../api.ts";
import type { SidecarClient } from "../sidecar/tunnel.ts";

export interface McpServerStatus {
	name: string;
	status: "connected" | "failed" | "needs_auth" | "pending" | "disabled";
	toolCount?: number;
}

export interface McpState {
	/** Keyed by `<workspacePath>|<agent key>`. */
	servers: Readonly<Record<string, Loadable<McpServerStatus[]>>>;
}

export interface McpServiceDeps {
	sidecar: Pick<SidecarClient, "request">;
}

export class McpService {
	readonly store: StoreApi<McpState>;
	readonly #deps: McpServiceDeps;

	constructor(deps: McpServiceDeps) {
		this.#deps = deps;
		this.store = createStore<McpState>(() => ({ servers: {} }));
	}

	refresh(_input: {
		agent: AgentKind;
		acpAgent?: AcpAgent;
		workspacePath: string;
	}): Promise<Result<McpServerStatus[]>> {
		void this.#deps;
		return notImplemented("SET-05");
	}

	/** Backs `Actions.mcp.refresh`: refreshes the servers of one chat's agent and workspace. */
	refreshSession(_sessionId: SessionId): Promise<Result<void>> {
		return notImplemented("SET-05");
	}
}
