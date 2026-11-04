/**
 * @feature SET-05 MCP servers section
 * Owns: the list of MCP servers on the Agents page: name, source, status, tool count, and a Refresh
 * action.
 * Behaviour: ui-map.md 3.10 ("MCP status", "No MCP servers configured.", "Refresh MCP status",
 * logs). Left out: the organization MCP page (install, recommended, import), which is a cloud
 * feature.
 * Children: McpStatusDialog (logs of one server).
 * Must handle: no servers (designed empty state), a server that needs sign-in (status text, no
 * fake sign-in button, since the agent does that), a failed server (error line, open log), refresh
 * in flight, a list that needs an active chat to ask (the status comes from a running session;
 * say so when there is none), and a long list (scrolls).
 * Test first: with one failed server the row shows its error and a "View log" action.
 */
import { notImplemented } from "@conducted/shared";
import type { McpServerView } from "../../../core/model.ts";

export interface McpServersSectionProps {
	servers: McpServerView[];
	hasSession: boolean;
	refreshing: boolean;
	onRefresh: () => void;
	onViewLog: (name: string) => void;
}

export function McpServersSection(_props: McpServersSectionProps): never {
	return notImplemented("SET-05");
}
