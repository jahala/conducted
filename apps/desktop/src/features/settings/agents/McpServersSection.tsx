/**
 * @feature SET-05 MCP servers section
 * Owns: the list of MCP servers on the Agents page: name, source, status, tool count, and a Refresh
 * action. It is the one place the MCP status dialog opens from today.
 * Behaviour: ui-map.md 3.10 ("MCP status", "No MCP servers configured.", "Refresh MCP status",
 * logs); ui-map.md 7.2 ("No matching MCP servers."). Left out: the organization MCP page (install,
 * recommended, import), which is a cloud feature.
 * Children: McpStatusDialog (logs of one server).
 * Must handle: no servers (designed empty state), a server that needs sign-in (status text, no
 * fake sign-in button, since the agent does that), a failed server (error line, open log), refresh
 * in flight, a list that needs an open chat to ask (the status comes from a running session; say
 * so when there is none), a filter with no match, and a long list (the page scrolls).
 * Test first: with one failed server the row shows its error and a "View log" action.
 */
import type { AppError, SessionId } from "@conducted/shared";
import { useState } from "react";
import { useActions, useMcpServers, useViewingSessionId } from "../../../core/hooks.ts";
import type { McpServerView } from "../../../core/model.ts";
import { Badge } from "../../../ui/Badge.tsx";
import { Button } from "../../../ui/Button.tsx";
import { EmptyState } from "../../../ui/EmptyState.tsx";
import { Input } from "../../../ui/Input.tsx";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "../../../ui/Table.tsx";
import { toastError } from "../../../ui/Toast.tsx";
import { McpStatusDialog } from "./McpStatusDialog.tsx";
import { mcpSourceLabel, mcpStatusLabel, mcpStatusTone, mcpToolCount } from "./mcp-status-text.ts";

export interface McpServersSectionProps {
	servers: McpServerView[];
	hasSession: boolean;
	refreshing: boolean;
	/** Why the list could not be read. Shown instead of an empty list. */
	error?: AppError;
	/** The first load is still running. */
	loading?: boolean;
	onRefresh: () => void;
	onViewLog: (name: string) => void;
}

export function McpServersSection({
	servers,
	hasSession,
	refreshing,
	error,
	loading = false,
	onRefresh,
	onViewLog,
}: McpServersSectionProps) {
	const [filter, setFilter] = useState("");
	const needle = filter.trim().toLowerCase();
	const filtered =
		needle === ""
			? servers
			: servers.filter((server) => server.name.toLowerCase().includes(needle));

	return (
		<section
			aria-label="MCP servers"
			className="flex flex-col gap-3 rounded-md border border-border bg-raised p-4"
		>
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<h2 className="text-base font-medium text-fg">MCP servers</h2>
					<p className="text-sm text-fg-muted">
						Servers the open chat's agent sees in this workspace.
					</p>
				</div>
				<Button
					variant="secondary"
					size="sm"
					onClick={onRefresh}
					disabled={!hasSession}
					loading={refreshing}
				>
					Refresh MCP status
				</Button>
			</div>

			{!hasSession ? (
				<EmptyState
					compact
					title="Open a chat to see its MCP servers."
					body="MCP status comes from a running chat."
				/>
			) : error !== undefined ? (
				<EmptyState
					compact
					tone="failed"
					title="Couldn't load MCP servers"
					body={error.message}
					action={
						<Button variant="secondary" size="sm" onClick={onRefresh}>
							Refresh MCP status
						</Button>
					}
				/>
			) : loading ? (
				<p role="status" aria-label="Loading MCP servers" className="text-sm text-fg-muted">
					Loading MCP servers…
				</p>
			) : servers.length === 0 ? (
				<EmptyState compact title="No MCP servers configured." />
			) : (
				<>
					<div className="max-w-sm">
						<Input
							type="search"
							aria-label="Search MCP servers"
							placeholder="Search MCP servers"
							value={filter}
							onChange={(event) => setFilter(event.target.value)}
						/>
					</div>
					{filtered.length === 0 ? (
						<EmptyState compact title="No matching MCP servers." />
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Name</TableHead>
									<TableHead>Source</TableHead>
									<TableHead>Status</TableHead>
									<TableHead>Tools</TableHead>
									<TableHead>
										<span className="sr-only">Actions</span>
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{filtered.map((server) => (
									<TableRow key={server.name}>
										<TableCell>
											<div className="flex flex-col">
												<span className="font-medium text-fg">{server.name}</span>
												{server.error === null ? null : (
													<span className="text-xs text-danger">{server.error}</span>
												)}
											</div>
										</TableCell>
										<TableCell className="text-fg-muted">{mcpSourceLabel(server.source)}</TableCell>
										<TableCell>
											<Badge tone={mcpStatusTone(server.status)}>
												{mcpStatusLabel(server.status)}
											</Badge>
										</TableCell>
										<TableCell className="text-fg-muted">
											{mcpToolCount(server.toolCount)}
										</TableCell>
										<TableCell className="text-right">
											<Button variant="ghost" size="sm" onClick={() => onViewLog(server.name)}>
												View log
											</Button>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
				</>
			)}
		</section>
	);
}

/**
 * The Agents page's MCP region. It reads the chat whose workspace screen is open, because MCP
 * status is per chat: the sidecar answers from that chat's agent, workspace and launch.
 */
export function McpServersPanel() {
	const viewingSessionId = useViewingSessionId();
	if (viewingSessionId === null) {
		return (
			<McpServersSection
				servers={[]}
				hasSession={false}
				refreshing={false}
				onRefresh={() => {}}
				onViewLog={() => {}}
			/>
		);
	}
	return <McpChatServers key={viewingSessionId} sessionId={viewingSessionId} />;
}

function McpChatServers({ sessionId }: { sessionId: SessionId }) {
	const value = useMcpServers(sessionId);
	const actions = useActions();
	const [refreshing, setRefreshing] = useState(false);
	const [logName, setLogName] = useState<string | null>(null);
	const servers = value.state === "ready" ? value.data : [];
	const selected = servers.find((server) => server.name === logName) ?? null;

	const refresh = async () => {
		setRefreshing(true);
		const result = await actions.mcp.refresh(sessionId);
		setRefreshing(false);
		if (!result.ok) toastError("Couldn't refresh MCP status", result.error);
	};

	return (
		<>
			<McpServersSection
				servers={servers}
				hasSession
				refreshing={refreshing}
				error={value.state === "error" ? value.error : undefined}
				loading={value.state === "loading"}
				onRefresh={() => void refresh()}
				onViewLog={setLogName}
			/>
			<McpStatusDialog
				open={logName !== null}
				server={selected}
				onOpenChange={(open) => {
					if (!open) setLogName(null);
				}}
				onCopyLog={(text) => actions.app.copyText(text)}
			/>
		</>
	);
}
