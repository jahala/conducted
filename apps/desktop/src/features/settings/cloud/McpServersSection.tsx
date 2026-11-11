/**
 * @feature CLOUD-17 MCP servers in the cloud sandbox
 * Owns: the Cloud page's MCP servers: the servers every cloud workspace's agents get, the add and
 * edit panel, and "Import from local".
 * Behaviour: ui-map.md 6 Organization (MCP: "Installed", "Import from local", "Select MCP servers",
 * auth types None, OAuth, Bearer token, Custom headers) and renderApp (the add form's Name, URL and
 * Authentication fields, its wording, and the import sheet's search over name, URL and source and
 * its "Select all" / "Deselect all" toggle). Conductor's page is an organisation page, which D004 and
 * D018 keep out; ours is the personal Cloud page on the Mac's own Worker (D121). OAuth is not
 * offered: Conductor completes it through its hosted service's callback and token store (D004,
 * D018, D025), which this app has no equivalent to. A cloud server overrides the agent's local
 * server of the same name (D121).
 * Data: the `mcpServers` of useCloudSettings; Actions.cloud.saveMcpServer, removeMcpServer,
 * importMcpServers and scanLocalMcpServers.
 * Must handle: no servers (designed empty state); a save the Worker refuses (its reason stays on
 * the panel); a scan that finds nothing (the right one of Conductor's three messages); a search that
 * matches nothing (Conductor's "No matching MCP servers."); a config it cannot read (named); a server
 * already saved (not offered again); a name the Worker reserves (made unique or refused); every
 * secret never shown once saved.
 * Test first: adding a bearer-token server saves it and the list shows it without its token.
 */
import { type ReactNode, useEffect, useState } from "react";
import {
	type CloudMcpAuth,
	type CloudMcpServer,
	headerLines,
	type ImportedMcpServer,
	uniqueMcpServerName,
} from "../../../core/cloud-mcp.ts";
import { useActions } from "../../../core/hooks.ts";
import { Badge } from "../../../ui/Badge.tsx";
import { Button } from "../../../ui/Button.tsx";
import { Checkbox } from "../../../ui/Checkbox.tsx";
import { EmptyState } from "../../../ui/EmptyState.tsx";
import { Input, Label, Textarea } from "../../../ui/Input.tsx";
import { Select } from "../../../ui/Select.tsx";
import { Sheet, SheetContent } from "../../../ui/Sheet.tsx";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "../../../ui/Table.tsx";
import { toast } from "../../../ui/Toast.tsx";

/** Conductor's name rule, with our app tools' reserved name. */
const SERVER_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const RESERVED = new Set(["conductor", "conducted"]);

const AUTH_OPTIONS: readonly { value: CloudMcpAuth; label: string }[] = [
	{ value: "none", label: "None" },
	{ value: "bearer", label: "Bearer token" },
	{ value: "headers", label: "Custom headers" },
];

function nameProblem(name: string): string | null {
	if (!SERVER_NAME.test(name)) {
		return 'Names can be 1-64 letters, numbers, hyphens, or underscores — no spaces ("conducted" names are reserved)';
	}
	if (RESERVED.has(name.toLowerCase())) {
		return `${name} is reserved for the app's own tools. Choose another name.`;
	}
	return null;
}

function urlProblem(url: string): string | null {
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== "https:") return "Enter an HTTPS server URL";
		// A user name or password in the URL would reach the sandbox, so it is not a valid URL here.
		if (parsed.username !== "" || parsed.password !== "") return "Enter a valid server URL";
		return null;
	} catch {
		return "Enter a valid server URL";
	}
}

/** The authentication column's label. */
function authLabel(server: CloudMcpServer): string {
	if (server.authType === "bearer") return "Bearer token";
	if (server.authType === "headers") return "Custom headers";
	return "None";
}

interface Draft {
	name: string;
	url: string;
	authType: CloudMcpAuth;
	bearerToken: string;
	headersText: string;
	/** True when the saved server already has a credential the user may keep by leaving the field. */
	credentialSaved: boolean;
}

function draftFor(name: string, server: CloudMcpServer | null): Draft {
	if (server === null) {
		return {
			name: "",
			url: "",
			authType: "none",
			bearerToken: "",
			headersText: "",
			credentialSaved: false,
		};
	}
	return {
		name,
		url: server.url,
		authType: server.authType,
		bearerToken: "",
		headersText:
			server.authType === "headers"
				? Object.entries(server.headers ?? {})
						.map(([header, value]) => `${header}: ${value}`)
						.join("\n")
				: "",
		credentialSaved: server.authType !== "none",
	};
}

/** What stops a draft from being saved, in the panel's words, or null. */
function draftProblem(
	draft: Draft,
	taken: readonly string[],
	editing: string | null,
	previous: CloudMcpServer | null,
): { message: string } | { server: CloudMcpServer } {
	const name = draft.name.trim();
	const problem = nameProblem(name);
	if (problem !== null) return { message: problem };
	if (name !== editing && taken.includes(name)) {
		return { message: `An MCP server named "${name}" already exists` };
	}
	const url = draft.url.trim();
	const urlIssue = urlProblem(url);
	if (urlIssue !== null) return { message: urlIssue };
	if (draft.authType === "bearer") {
		const token = draft.bearerToken.trim();
		if (token === "") {
			if (draft.credentialSaved && previous?.authType === "bearer") {
				// The token is not shown again; an untouched field keeps the saved one.
				return { server: { url, authType: "bearer", bearerToken: previous.bearerToken } };
			}
			return { message: "Enter a bearer token" };
		}
		return { server: { url, authType: "bearer", bearerToken: token } };
	}
	if (draft.authType === "headers") {
		if (
			draft.credentialSaved &&
			draft.headersText.trim() === "" &&
			previous?.authType === "headers"
		) {
			return { server: { url, authType: "headers", headers: previous.headers } };
		}
		const lines = headerLines(draft.headersText);
		if (!lines.ok) return { message: lines.message };
		if (Object.keys(lines.headers).length === 0) {
			return { message: "Enter headers" };
		}
		return { server: { url, authType: "headers", headers: lines.headers } };
	}
	return { server: { url, authType: "none" } };
}

export interface CloudMcpServersSectionProps {
	servers: Readonly<Record<string, CloudMcpServer>>;
	/** Saves one server; false keeps the panel open. */
	onSave: (name: string, server: CloudMcpServer) => Promise<boolean>;
	onRemove: (name: string) => Promise<boolean>;
	onImport: (servers: Readonly<Record<string, CloudMcpServer>>) => Promise<boolean>;
}

export function CloudMcpServersSection({
	servers,
	onSave,
	onRemove,
	onImport,
}: CloudMcpServersSectionProps) {
	const [editing, setEditing] = useState<string | null | undefined>(undefined);
	const [importing, setImporting] = useState(false);
	const names = Object.keys(servers).sort((left, right) => left.localeCompare(right));

	return (
		<div className="flex flex-col gap-3 border-t border-border py-4">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="flex flex-col gap-1">
					<p className="text-sm font-medium text-fg">MCP servers</p>
					<p className="max-w-prose text-sm text-fg-muted">
						Configure MCP servers for cloud workspaces.
					</p>
				</div>
				<div className="flex gap-2">
					<Button variant="secondary" onClick={() => setImporting(true)}>
						Import from local
					</Button>
					<Button variant="default" onClick={() => setEditing(null)}>
						Add MCP server
					</Button>
				</div>
			</div>
			{names.length === 0 ? (
				<EmptyState compact title="No MCP servers configured." />
			) : (
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Name</TableHead>
							<TableHead>URL</TableHead>
							<TableHead>Authentication</TableHead>
							<TableHead>
								<span className="sr-only">Actions</span>
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{names.map((name) => {
							const server = servers[name] as CloudMcpServer;
							return (
								<TableRow key={name}>
									<TableCell>
										<span className="font-medium text-fg">{name}</span>
									</TableCell>
									<TableCell className="max-w-72 truncate font-mono text-fg-muted">
										{server.url}
									</TableCell>
									<TableCell>
										<Badge>{authLabel(server)}</Badge>
									</TableCell>
									<TableCell className="text-right">
										<div className="flex justify-end gap-1">
											<Button variant="ghost" size="sm" onClick={() => setEditing(name)}>
												Edit
											</Button>
											<Button
												variant="ghost"
												size="sm"
												onClick={() => {
													void onRemove(name).then((removed) => {
														if (!removed) {
															toast.error("Check your connection and try again.");
														}
													});
												}}
											>
												Remove
											</Button>
										</div>
									</TableCell>
								</TableRow>
							);
						})}
					</TableBody>
				</Table>
			)}
			{editing !== undefined ? (
				<AddEditServerSheet
					editing={editing}
					server={editing === null ? null : (servers[editing] ?? null)}
					taken={names}
					onClose={() => setEditing(undefined)}
					onSave={onSave}
					onRemove={onRemove}
				/>
			) : null}
			{importing ? (
				<ImportLocalSheet
					servers={servers}
					onClose={() => setImporting(false)}
					onImport={onImport}
				/>
			) : null}
		</div>
	);
}

function AddEditServerSheet({
	editing,
	server,
	taken,
	onClose,
	onSave,
	onRemove,
}: {
	editing: string | null;
	server: CloudMcpServer | null;
	taken: readonly string[];
	onClose: () => void;
	onSave: (name: string, server: CloudMcpServer) => Promise<boolean>;
	onRemove: (name: string) => Promise<boolean>;
}) {
	const [draft, setDraft] = useState<Draft>(() => draftFor(editing ?? "", server));
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);

	const update = (change: Partial<Draft>) => setDraft((current) => ({ ...current, ...change }));

	const save = async () => {
		const checked = draftProblem(draft, taken, editing, server);
		if ("message" in checked) {
			setError(checked.message);
			return;
		}
		setError(null);
		setSaving(true);
		const name = draft.name.trim();
		const saved = await onSave(name, checked.server);
		setSaving(false);
		if (!saved) {
			setError("Check your connection and try again.");
			return;
		}
		if (editing !== null && editing !== name) {
			const removed = await onRemove(editing);
			if (!removed) {
				setError("Check your connection and try again.");
				return;
			}
		}
		onClose();
	};

	return (
		<Sheet open onOpenChange={(open) => (open ? undefined : onClose())}>
			<SheetContent
				title={editing === null ? "Add MCP server" : "Edit MCP server"}
				footer={
					<>
						<Button variant="secondary" onClick={onClose}>
							Cancel
						</Button>
						<Button
							variant="default"
							data-primary-action
							loading={saving}
							onClick={() => void save()}
						>
							Save
						</Button>
					</>
				}
			>
				<div className="mt-6 flex flex-col gap-4">
					<Field label="Name" htmlFor="mcp-server-name">
						<Input
							id="mcp-server-name"
							value={draft.name}
							onChange={(event) => update({ name: event.target.value })}
							placeholder="my-server"
							autoFocus
							autoComplete="off"
							className="font-mono"
						/>
					</Field>
					<Field label="URL" htmlFor="mcp-server-url">
						<Input
							id="mcp-server-url"
							value={draft.url}
							onChange={(event) => update({ url: event.target.value })}
							placeholder="https://example.com/mcp"
							autoComplete="off"
							className="font-mono"
						/>
					</Field>
					<Field label="Authentication" htmlFor="mcp-server-auth">
						<Select
							id="mcp-server-auth"
							value={draft.authType}
							options={AUTH_OPTIONS}
							onValueChange={(value) =>
								update({
									authType: value,
									credentialSaved: false,
									...(value === "bearer" ? { headersText: "" } : {}),
								})
							}
						/>
					</Field>
					{draft.authType === "bearer" ? (
						<Field label="Token" htmlFor="mcp-server-token">
							<Input
								id="mcp-server-token"
								type="password"
								value={draft.bearerToken}
								onChange={(event) => update({ bearerToken: event.target.value })}
								placeholder={
									draft.credentialSaved
										? "Credential configured — enter a token to replace"
										: "Paste token"
								}
								autoComplete="off"
								className="font-mono"
							/>
						</Field>
					) : null}
					{draft.authType === "headers" ? (
						<Field label="Headers" htmlFor="mcp-server-headers">
							<Textarea
								id="mcp-server-headers"
								value={draft.headersText}
								onChange={(event) => update({ headersText: event.target.value })}
								placeholder="Header-Name: value"
								className="min-h-28 font-mono"
							/>
						</Field>
					) : null}
					<p className="text-sm text-fg-muted">
						The credential is kept in your Worker. A cloud workspace receives a placeholder and the
						Worker swaps the real value in when the server is called.
					</p>
					{error === null ? null : <p className="text-sm text-danger">{error}</p>}
				</div>
			</SheetContent>
		</Sheet>
	);
}

function Field({
	label,
	htmlFor,
	children,
}: {
	label: string;
	htmlFor: string;
	children: ReactNode;
}) {
	return (
		<div className="flex flex-col gap-1.5">
			<Label htmlFor={htmlFor}>{label}</Label>
			{children}
		</div>
	);
}

function ImportLocalSheet({
	servers,
	onClose,
	onImport,
}: {
	servers: Readonly<Record<string, CloudMcpServer>>;
	onClose: () => void;
	onImport: (servers: Readonly<Record<string, CloudMcpServer>>) => Promise<boolean>;
}) {
	const actions = useActions();
	const [scan, setScan] = useState<ImportedMcpServer[] | null>(null);
	const [unreadable, setUnreadable] = useState<string[]>([]);
	const [skipped, setSkipped] = useState(0);
	const [error, setError] = useState<string | null>(null);
	const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
	const [query, setQuery] = useState("");
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		let live = true;
		void actions.cloud.scanLocalMcpServers().then((result) => {
			if (!live) return;
			if (!result.ok) {
				setError(result.error.message);
				setScan([]);
				return;
			}
			setScan(result.value.candidates);
			setUnreadable(result.value.unreadableSources);
			setSkipped(result.value.skippedCount);
		});
		return () => {
			live = false;
		};
	}, [actions]);

	const installed = new Set(Object.keys(servers).map((name) => name.toLowerCase()));
	const installedUrls = new Set(Object.values(servers).map((server) => server.url));
	const fresh =
		scan === null
			? null
			: scan.filter(
					(candidate) =>
						!installed.has(candidate.name.toLowerCase()) && !installedUrls.has(candidate.url),
				);
	// The search matches what Conductor's does: the name, the URL or the sources, without case.
	const needle = query.trim().toLowerCase();
	const visible =
		fresh === null
			? null
			: needle === ""
				? fresh
				: fresh.filter((candidate) =>
						[candidate.name, candidate.url, candidate.sources.join(", ")].some((text) =>
							text.toLowerCase().includes(needle),
						),
					);
	const everyVisibleUnchosen =
		visible !== null && visible.length > 0 && visible.every((item) => !chosen.has(item.url));

	const toggleAll = () => {
		if (visible === null) return;
		setChosen((current) => {
			const next = new Set(current);
			for (const candidate of visible) {
				if (everyVisibleUnchosen) next.add(candidate.url);
				else next.delete(candidate.url);
			}
			return next;
		});
	};

	const toggle = (url: string) => {
		setChosen((current) => {
			const next = new Set(current);
			if (next.has(url)) next.delete(url);
			else next.add(url);
			return next;
		});
	};

	const runImport = async () => {
		if (fresh === null) return;
		const taken = Object.keys(servers);
		const toImport: Record<string, CloudMcpServer> = {};
		for (const candidate of fresh) {
			if (!chosen.has(candidate.url)) continue;
			const name = uniqueMcpServerName(candidate.name, taken);
			taken.push(name);
			toImport[name] = {
				url: candidate.url,
				authType: Object.keys(candidate.headers).length > 0 ? "headers" : "none",
				...(Object.keys(candidate.headers).length > 0 ? { headers: candidate.headers } : {}),
			};
		}
		setSaving(true);
		const imported = await onImport(toImport);
		setSaving(false);
		if (!imported) {
			setError("Check your connection and try again.");
			return;
		}
		const added = Object.keys(toImport).length;
		toast(added === 1 ? "Added 1 MCP server" : `Added ${added} MCP servers`);
		onClose();
	};

	const footer = (
		<>
			<Button variant="secondary" onClick={onClose}>
				Cancel
			</Button>
			<Button
				variant="default"
				data-primary-action
				disabled={chosen.size === 0}
				loading={saving}
				onClick={() => void runImport()}
			>
				Import
			</Button>
		</>
	);

	return (
		<Sheet open onOpenChange={(open) => (open ? undefined : onClose())}>
			<SheetContent title="Import from local" footer={footer}>
				<div className="mt-6 flex flex-col gap-3">
					{error === null ? null : <p className="text-sm text-danger">{error}</p>}
					{scan === null ? (
						<p role="status" className="text-sm text-fg-muted">
							Reading local MCP configs...
						</p>
					) : fresh !== null && fresh.length > 0 ? (
						<>
							<p className="text-sm text-fg-muted">
								Remote MCP servers found in this Mac's agent configs.
							</p>
							<div className="flex items-center gap-2">
								<Input
									value={query}
									onChange={(event) => setQuery(event.target.value)}
									placeholder="Search MCP servers..."
									aria-label="Search MCP servers"
									autoFocus
									autoComplete="off"
									className="flex-1"
								/>
								{visible !== null && visible.length > 0 ? (
									<Button variant="ghost" size="sm" onClick={toggleAll}>
										{everyVisibleUnchosen ? "Select all" : "Deselect all"}
									</Button>
								) : null}
							</div>
							{visible !== null && visible.length > 0 ? (
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>
												<span className="sr-only">Choose</span>
											</TableHead>
											<TableHead>Name</TableHead>
											<TableHead>Source</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{visible.map((candidate) => (
											<TableRow key={candidate.url}>
												<TableCell>
													<Checkbox
														aria-label={candidate.name}
														checked={chosen.has(candidate.url)}
														onCheckedChange={() => toggle(candidate.url)}
													/>
												</TableCell>
												<TableCell>
													<div className="flex flex-col">
														<span className="font-medium text-fg">{candidate.name}</span>
														<span className="max-w-72 truncate font-mono text-xs text-fg-muted">
															{candidate.url}
														</span>
													</div>
												</TableCell>
												<TableCell className="text-fg-muted">
													{candidate.sources.join(", ")}
												</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							) : (
								<p className="px-2 py-4 text-center text-sm text-fg-muted">
									No matching MCP servers.
								</p>
							)}
						</>
					) : unreadable.length > 0 ? (
						<EmptyState
							compact
							title="Couldn't read local MCP configs"
							body={unreadable.join(", ")}
						/>
					) : skipped > 0 ? (
						<EmptyState
							compact
							title="No servers to import — only remote (HTTPS) servers are supported"
						/>
					) : (
						<EmptyState compact title="All local MCP servers are already added" />
					)}
				</div>
			</SheetContent>
		</Sheet>
	);
}
