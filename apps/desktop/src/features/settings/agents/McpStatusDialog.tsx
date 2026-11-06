/**
 * @feature SET-05 MCP status dialog
 * Owns: the dialog that shows one MCP server's status and log. It opens from the Agents page's MCP
 * servers list; the chat's MCP failure card belongs to chat tooling (not built here).
 * Behaviour: ui-map.md 3.10 ("MCP status", "No MCP servers configured.", logs); ui-map.md 5.2
 * ("MCP status" dialog title).
 * Must handle: no server chosen (says none are configured), no log lines (says none were
 * captured), a long log (scrolls), and copy of the log. The sidecar's failure text is the log
 * this build has; a separate live log stream is not in the protocol yet.
 * Test first: the dialog shows the log lines in order and a copy action puts them on the
 * clipboard.
 */
import type { McpServerView } from "../../../core/model.ts";
import { Badge } from "../../../ui/Badge.tsx";
import { CopyButton } from "../../../ui/CopyButton.tsx";
import { Dialog, DialogContent } from "../../../ui/Dialog.tsx";
import { mcpStatusLabel, mcpStatusTone, mcpToolCount } from "./mcp-status-text.ts";

export interface McpStatusDialogProps {
	open: boolean;
	server: McpServerView | null;
	onOpenChange: (open: boolean) => void;
	/** Receives the log text to put on the clipboard. */
	onCopyLog: (text: string) => unknown;
}

/** A key per line that stays unique when the same line repeats. */
function keyedLines(lines: readonly string[]): { key: string; line: string }[] {
	const seen = new Map<string, number>();
	return lines.map((line) => {
		const occurrence = (seen.get(line) ?? 0) + 1;
		seen.set(line, occurrence);
		return { key: `${line}#${occurrence}`, line };
	});
}

export function McpStatusDialog({ open, server, onOpenChange, onCopyLog }: McpStatusDialogProps) {
	const log = server?.logTail ?? [];
	const logText = log.join("\n");
	const lines = keyedLines(log);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent title="MCP status" description={server?.name} size="lg">
				{server === null ? (
					<p className="text-sm text-fg-muted">No MCP servers configured.</p>
				) : (
					<>
						<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
							<dt className="text-fg-muted">Status</dt>
							<dd>
								<Badge tone={mcpStatusTone(server.status)}>{mcpStatusLabel(server.status)}</Badge>
							</dd>
							<dt className="text-fg-muted">Source</dt>
							<dd className="text-fg">{server.source === "project" ? "Project" : "User"}</dd>
							<dt className="text-fg-muted">Transport</dt>
							<dd className="text-fg">{server.transport}</dd>
							<dt className="text-fg-muted">Tools</dt>
							<dd className="text-fg">{mcpToolCount(server.toolCount)}</dd>
							{server.error === null ? null : (
								<>
									<dt className="text-fg-muted">Error</dt>
									<dd className="text-danger">{server.error}</dd>
								</>
							)}
						</dl>

						<div className="flex flex-col gap-2">
							<div className="flex items-center justify-between gap-3">
								<h3 className="text-sm font-medium text-fg">Log</h3>
								<CopyButton
									text={logText}
									onCopy={onCopyLog}
									label="Copy log"
									disabled={log.length === 0}
								/>
							</div>
							{log.length === 0 ? (
								<p className="text-sm text-fg-muted">No log lines were captured.</p>
							) : (
								<ol
									aria-label="MCP server log"
									className="max-h-64 overflow-auto rounded-md border border-border bg-surface p-3 font-mono text-xs text-fg"
								>
									{lines.map((entry) => (
										<li key={entry.key} className="whitespace-pre-wrap">
											{entry.line}
										</li>
									))}
								</ol>
							)}
						</div>
					</>
				)}
			</DialogContent>
		</Dialog>
	);
}
