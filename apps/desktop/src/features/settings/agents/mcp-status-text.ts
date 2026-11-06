/**
 * @feature SET-05 MCP servers: list, status and logs
 * Owns: the words and badge tones the MCP list and dialog show for a server's state and tool count.
 * Behaviour: services-map.md 5B.6 (status values connected, failed, needs auth, pending, disabled);
 * ui-map.md 3.10 (MCP status).
 * Must handle: every status value; an agent that reported no tools (a dash, never a zero); a source
 * or transport the agent did not report (a dash).
 * Test first: the tests for the labels live with the section and the dialog that show them.
 */

import type { McpServerView } from "../../../core/model.ts";
import type { BadgeTone } from "../../../ui/Badge.tsx";

/** The state a server is in, in Conductor's words. */
export function mcpStatusLabel(status: McpServerView["status"]): string {
	if (status === "connected") return "Connected";
	if (status === "failed") return "Failed";
	if (status === "needs_auth") return "Needs auth";
	if (status === "pending") return "Pending";
	return "Disabled";
}

export function mcpStatusTone(status: McpServerView["status"]): BadgeTone {
	if (status === "connected") return "success";
	if (status === "failed") return "danger";
	if (status === "needs_auth") return "warning";
	return "neutral";
}

/** Where the server was configured, or a dash when the agent did not say. Our design choice: the words. */
export function mcpSourceLabel(source: McpServerView["source"]): string {
	if (source === "user") return "User";
	if (source === "project") return "Project";
	if (source === "local") return "Local";
	if (source === "plugin") return "Plugin";
	return "—";
}

/** The transport as the agent names it, or a dash when it did not say. */
export function mcpTransportLabel(transport: McpServerView["transport"]): string {
	return transport ?? "—";
}

/** "12 tools", "1 tool", or a dash when the agent did not report any. */
export function mcpToolCount(count: number | null): string {
	if (count === null) return "—";
	return count === 1 ? "1 tool" : `${count} tools`;
}
