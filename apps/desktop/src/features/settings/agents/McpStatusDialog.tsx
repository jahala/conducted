/**
 * @feature SET-05 MCP status dialog
 * Owns: the dialog that shows one MCP server's status and log. It also opens from the chat when an
 * MCP tool fails.
 * Behaviour: ui-map.md 3.10 ("MCP status", logs). Not in the entry list of the scaffold brief: the
 * chat feature may open it. Data: useMcpServers(sessionId) and useActions().mcp.refresh.
 * Must handle: no log lines (says none were captured), a very long log (windowed), copy of the log,
 * a server that disappears while the dialog is open, and secrets in log lines (the sidecar strips
 * known secret patterns before they reach the UI; the dialog does not try to guess).
 * Test first: the dialog shows the log lines in order and a copy action puts them on the clipboard.
 */
import { notImplemented } from "@conducted/shared";
import type { McpServerView } from "../../../core/model.ts";

export interface McpStatusDialogProps {
	open: boolean;
	server: McpServerView | null;
	onOpenChange: (open: boolean) => void;
	onCopyLog: () => void;
}

export function McpStatusDialog(_props: McpStatusDialogProps): never {
	return notImplemented("SET-05");
}
