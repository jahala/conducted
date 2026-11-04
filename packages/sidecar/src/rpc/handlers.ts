/**
 * @feature SIDE-02 JSON-RPC over a Unix socket
 * Owns: wiring the method tables to the modules that implement them. This is the one place that
 * knows which module answers which request.
 * Behaviour: research/conductor/sessions.md section 10 (Conductor registers every method in one
 * setup function on each connection).
 * eventPersisted acknowledges the event in the write-ahead log (outbox/); setLogLevel changes the
 * root logger.
 * Must handle: every key of appToSidecarRequests and appToSidecarNotifications has a handler (the
 * type enforces it), requests that need a session look it up and return RPC_ERRORS.sessionUnknown
 * when it is missing, and cancel never waits on the per-session queue.
 * Test first: the keys of the returned tables equal the keys of the protocol tables.
 */
import { notImplemented } from "@conducted/shared";
import type { AgentDetector } from "../models/agent-detection.ts";
import type { ModelCatalog } from "../models/catalog.ts";
import type { McpServerLister, SlashCommandLister } from "../models/slash-and-mcp.ts";
import type { UsageReader } from "../models/usage.ts";
import type { EventOutbox } from "../outbox/event-outbox.ts";
import type { SessionManager } from "../session/manager.ts";
import type { ShellEnvProvider } from "../shell-env/capture.ts";
import type { AppToSidecarHandlers, AppToSidecarNotificationHandlers } from "./types.ts";

export interface HandlerDeps {
	sessions: SessionManager;
	outbox: EventOutbox;
	models: ModelCatalog;
	agents: AgentDetector;
	slashCommands: SlashCommandLister;
	mcpServers: McpServerLister;
	usage: UsageReader;
	shellEnv: ShellEnvProvider;
	/** Applies setLogLevel to the root logger. */
	setLogLevel(level: "error" | "warn" | "info" | "debug"): void;
}

export function buildHandlers(_deps: HandlerDeps): {
	requests: AppToSidecarHandlers;
	notifications: AppToSidecarNotificationHandlers;
} {
	return notImplemented("SIDE-02");
}
