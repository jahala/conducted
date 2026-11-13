/**
 * @feature CLOUD-17 MCP servers in the cloud sandbox
 * Owns: the Cloud page's MCP section: the servers every cloud workspace's agents get, in
 * Conductor's Installed and Recommended tabs, the add and edit dialog, and "Import from local".
 * Behaviour: Conductor's MCP settings page in renderApp-DeUrsznk.js, read 2026-11-12 (offsets are
 * characters): the "MCP" heading (`NHe` @8717783) and the entry's description (@11304259); the
 * tabs, the installed search, the empty lines and the newest-first list (`$Pa` @10778950 to
 * @10779710); a row's name and its actions menu with Edit and Delete (`KAt` @8719151); the add and
 * edit dialog's fields, choices, placeholders and messages (`BDa` and `$Da` @10721094 to @10728036);
 * the Recommended tab's search and "Import from local" card (`TPa` @10763650, `OPa` @10766909);
 * and the "Select MCP servers" dialog, which chooses every server at first (`MPa` @10769053, `LPa`
 * for its empty lines). Conductor's page is an organisation page, which D004 and D018 keep out;
 * ours is the personal Cloud page on the Mac's own Worker (D121).
 * Left out, as gaps: OAuth (Conductor completes it through its hosted callback and token store,
 * D121), the Recommended catalogue (22 of its 24 entries are OAuth servers), the brand logos and
 * favicons a row's icon shows (Conductor's own assets and Google's favicon service; the row keeps
 * Conductor's fallback initial), and the brand display names (`GXo`); a name is shown with its
 * first letter raised, Conductor's rule for every other name.
 * Data: the `mcpServers` of useCloudSettings; Actions.cloud.scanLocalMcpServers. Saves, deletes and
 * imports go through the page's callbacks, which toast Conductor's failure titles.
 * Must handle: no servers and a search that matches none (Conductor's lines); a save the Worker
 * refuses (the dialog stays open, the page toasts why); a scan that finds nothing or cannot read
 * (the right one of Conductor's lines); a server already saved (not offered again); a name the
 * Worker reserves (Conductor's name message); every secret never shown once saved.
 * Test first: adding a bearer-token server saves it and the list shows it without its token.
 */
import { type ReactNode, useEffect, useState } from "react";
import {
	type CloudMcpAuth,
	type CloudMcpServer,
	headerLines,
	type ImportedMcpServer,
	RESERVED_NAMES,
	SERVER_NAME,
	uniqueMcpServerName,
} from "../../../core/cloud-mcp.ts";
import { useActions } from "../../../core/hooks.ts";
import { Button } from "../../../ui/Button.tsx";
import { Checkbox } from "../../../ui/Checkbox.tsx";
import { Dialog, DialogContent, DialogFooter } from "../../../ui/Dialog.tsx";
import { Input, Label, Textarea } from "../../../ui/Input.tsx";
import {
	HardDriveDownloadIcon,
	MoreVerticalIcon,
	PencilIcon,
	PlusIcon,
	SearchIcon,
	TrashIcon,
} from "../../../ui/icons.tsx";
import { Kbd } from "../../../ui/Kbd.tsx";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "../../../ui/Menu.tsx";
import { Select } from "../../../ui/Select.tsx";
import { Spinner } from "../../../ui/Spinner.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../ui/Tabs.tsx";
import { toast } from "../../../ui/Toast.tsx";

/** Conductor's choices, in its order, without OAuth (D121). */
const AUTH_OPTIONS: readonly { value: CloudMcpAuth; label: string }[] = [
	{ value: "bearer", label: "Bearer token" },
	{ value: "headers", label: "Custom headers" },
	{ value: "none", label: "None" },
];

const NAME_MESSAGE =
	'Names can be 1-64 letters, numbers, hyphens, or underscores — no spaces ("conducted" names are reserved)';

const BEARER = "Bearer ";

/** The words the Recommended search finds "Import from local" by (Conductor's `vPa`). */
const IMPORT_KEYWORDS = [
	"import from local",
	"Claude Code",
	"Claude Desktop",
	"Claude",
	"Codex",
	"Cursor",
	"OpenCode",
]
	.join(" ")
	.toLowerCase();

const EMPTY_LINE = "flex min-h-16 items-center justify-center text-sm text-fg-muted";
const FIELD_INPUT = {
	autoComplete: "off",
	autoCorrect: "off",
	autoCapitalize: "off",
	spellCheck: false,
} as const;

/** The name a row shows: the first letter raised, as Conductor shows a name it has no brand for. */
function displayName(name: string): string {
	return name.charAt(0).toUpperCase() + name.slice(1);
}

/** A URL without its trailing slashes, so two spellings of one server compare equal. */
function normalizedUrl(url: string): string | null {
	try {
		const parsed = new URL(url);
		parsed.pathname = parsed.pathname.replace(/\/+$/, "");
		return parsed.href;
	} catch {
		return null;
	}
}

/** One local server's identity: its URL and its sorted headers. */
function candidateKey(candidate: ImportedMcpServer): string {
	const headers = JSON.stringify(
		Object.entries(candidate.headers).sort(([left], [right]) => left.localeCompare(right)),
	);
	return `${normalizedUrl(candidate.url) ?? candidate.url}\u0000${headers}`;
}

/** Whether a local server is already saved: the same name, or the same URL when it has no headers. */
function alreadySaved(
	candidate: ImportedMcpServer,
	servers: Readonly<Record<string, CloudMcpServer>>,
): boolean {
	const url = Object.keys(candidate.headers).length === 0 ? normalizedUrl(candidate.url) : null;
	return Object.entries(servers).some(
		([name, server]) =>
			name === candidate.name || (url !== null && normalizedUrl(server.url) === url),
	);
}

/** The header text with the token as its Authorization header, as a switch to Custom headers keeps it. */
function withBearerHeader(headersText: string, token: string): string {
	let replaced = false;
	const lines = headersText.split("\n").map((line) => {
		const trimmed = line.trim();
		const colon = trimmed.indexOf(":");
		if (
			replaced ||
			colon <= 0 ||
			trimmed.slice(0, colon).trim().toLowerCase() !== "authorization"
		) {
			return line;
		}
		replaced = true;
		return `${trimmed.slice(0, colon).trim()}: ${BEARER}${token}`;
	});
	if (replaced) return lines.join("\n");
	return [`Authorization: ${BEARER}${token}`, ...lines.filter((line) => line.trim() !== "")].join(
		"\n",
	);
}

/** The bearer token in the header text's Authorization header, as a switch to Bearer token keeps it. */
function bearerFromHeaders(headersText: string): string | undefined {
	const parsed = headerLines(headersText);
	if (!parsed.ok) return undefined;
	const value = Object.entries(parsed.headers).find(
		([header]) => header.toLowerCase() === "authorization",
	)?.[1];
	return value?.startsWith(BEARER) ? value.slice(BEARER.length) : undefined;
}

function urlProblem(url: string): string | null {
	if (url === "") return "Enter a server URL";
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

interface Draft {
	name: string;
	url: string;
	authType: CloudMcpAuth;
	bearerToken: string;
	headersText: string;
	/** True when the saved server holds a credential an empty field keeps. */
	credentialConfigured: boolean;
}

function draftFor(name: string, server: CloudMcpServer | null): Draft {
	return {
		name,
		url: server?.url ?? "",
		authType: server?.authType ?? "none",
		bearerToken: "",
		headersText: "",
		credentialConfigured: server !== null && server.authType !== "none",
	};
}

/** The server a draft saves, or the message that stops it, in Conductor's order of checks. */
function checkedDraft(
	draft: Draft,
	taken: readonly string[],
	editing: string | null,
	previous: CloudMcpServer | null,
): { message: string } | { server: CloudMcpServer } {
	const name = draft.name.trim();
	if (!SERVER_NAME.test(name) || RESERVED_NAMES.has(name.toLowerCase())) {
		return { message: NAME_MESSAGE };
	}
	if (name !== editing && taken.includes(name)) {
		return { message: `An MCP server named "${name}" already exists` };
	}
	const url = draft.url.trim();
	const urlIssue = urlProblem(url);
	if (urlIssue !== null) return { message: urlIssue };
	if (draft.authType === "none") return { server: { url, authType: "none" } };
	if (draft.authType === "bearer") {
		const token = draft.bearerToken.trim();
		if (token !== "") return { server: { url, authType: "bearer", bearerToken: token } };
		// The token is never shown again; an untouched field keeps the saved one.
		if (draft.credentialConfigured && previous?.authType === "bearer") {
			return { server: { url, authType: "bearer", bearerToken: previous.bearerToken } };
		}
		return { message: "Enter a bearer token" };
	}
	const lines = headerLines(draft.headersText);
	if (!lines.ok) return { message: lines.message };
	if (Object.keys(lines.headers).length > 0) {
		return { server: { url, authType: "headers", headers: lines.headers } };
	}
	if (draft.credentialConfigured && previous?.authType === "headers") {
		return { server: { url, authType: "headers", headers: previous.headers } };
	}
	return { server: { url, authType: "none" } };
}

export interface CloudMcpServersSectionProps {
	servers: Readonly<Record<string, CloudMcpServer>>;
	/** Saves one server; false keeps the dialog open. */
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
	const [tab, setTab] = useState("installed");
	const [installedQuery, setInstalledQuery] = useState("");
	const [recommendedQuery, setRecommendedQuery] = useState("");
	const [editing, setEditing] = useState<string | null | undefined>(undefined);
	const [importing, setImporting] = useState(false);
	const names = Object.keys(servers);
	const needle = installedQuery.trim().toLowerCase();
	// Newest first, as Conductor lists them.
	const shown = names
		.filter(
			(name) =>
				needle === "" ||
				name.toLowerCase().includes(needle) ||
				(servers[name] as CloudMcpServer).url.toLowerCase().includes(needle),
		)
		.reverse();
	const recommended = recommendedQuery.trim().toLowerCase();
	const importMatches = recommended === "" || IMPORT_KEYWORDS.includes(recommended);

	const runImport = (chosen: readonly ImportedMcpServer[]) => {
		setImporting(false);
		const taken = [...names];
		const toImport: Record<string, CloudMcpServer> = {};
		for (const candidate of chosen) {
			const name = uniqueMcpServerName(candidate.name, taken);
			taken.push(name);
			toImport[name] =
				Object.keys(candidate.headers).length > 0
					? { url: candidate.url, authType: "headers", headers: candidate.headers }
					: { url: candidate.url, authType: "none" };
		}
		const added = Object.keys(toImport).length;
		void onImport(toImport).then((imported) => {
			if (!imported) return;
			// Conductor's import ends on the Installed tab with the search cleared.
			setInstalledQuery("");
			setTab("installed");
			toast.success(added === 1 ? "Added 1 MCP server" : `Added ${added} MCP servers`);
		});
	};

	return (
		<div className="flex flex-col gap-3 border-t border-border py-4">
			<div className="flex flex-col gap-1">
				<h3 className="text-sm font-medium text-fg">MCP</h3>
				<p className="max-w-prose text-sm text-fg-muted">
					Configure MCP servers for cloud workspaces.
				</p>
			</div>
			<Tabs value={tab} onValueChange={setTab} className="w-full">
				<TabsList className="justify-start gap-6 px-0">
					<TabsTrigger value="installed" className="px-0">
						Installed
					</TabsTrigger>
					<TabsTrigger value="recommended" className="px-0">
						Recommended
					</TabsTrigger>
				</TabsList>
				<TabsContent value="installed" className="mt-6 flex flex-col gap-3">
					<div className="flex gap-2">
						<div className="relative min-w-0 flex-1">
							<SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-fg-muted" />
							<Input
								type="text"
								placeholder="Search installed MCPs"
								value={installedQuery}
								onChange={(event) => setInstalledQuery(event.target.value)}
								className="pl-8"
							/>
						</div>
						<Button size="sm" onClick={() => setEditing(null)}>
							<PlusIcon className="size-3.5" />
							Add MCP server
						</Button>
					</div>
					{shown.length === 0 ? (
						<div className={EMPTY_LINE}>
							{names.length === 0
								? "No MCP servers installed"
								: "No installed MCPs match your search"}
						</div>
					) : (
						<div className="divide-y divide-border overflow-hidden rounded-md border border-border">
							{shown.map((name) => (
								<ServerRow
									key={name}
									name={name}
									onEdit={() => setEditing(name)}
									onDelete={() => void onRemove(name)}
								/>
							))}
						</div>
					)}
				</TabsContent>
				<TabsContent value="recommended" className="mt-6 flex flex-col gap-6">
					<div className="relative">
						<SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-fg-muted" />
						<Input
							type="text"
							placeholder="Search recommended MCPs"
							value={recommendedQuery}
							onChange={(event) => setRecommendedQuery(event.target.value)}
							className="pl-8"
						/>
					</div>
					{importMatches ? (
						<div className="grid grid-cols-3 gap-3">
							<button
								type="button"
								onClick={() => setImporting(true)}
								className="flex min-h-14 min-w-0 items-center gap-2.5 rounded-lg border border-border bg-canvas p-2.5 text-left transition-[background-color,scale] duration-100 hover:bg-hover active:scale-[0.96] disabled:pointer-events-none disabled:opacity-50"
							>
								<span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-fg">
									<HardDriveDownloadIcon className="size-4" />
								</span>
								<span className="min-w-0 truncate text-sm font-medium text-fg">
									Import from local
								</span>
							</button>
						</div>
					) : (
						<div className={EMPTY_LINE}>No recommended MCPs match your search</div>
					)}
				</TabsContent>
			</Tabs>
			{editing !== undefined ? (
				<ServerDialog
					editing={editing}
					server={editing === null ? null : (servers[editing] ?? null)}
					taken={names}
					onClose={() => setEditing(undefined)}
					onSave={onSave}
					onRemove={onRemove}
				/>
			) : null}
			{importing ? (
				<ImportDialog servers={servers} onClose={() => setImporting(false)} onChoose={runImport} />
			) : null}
		</div>
	);
}

function ServerRow({
	name,
	onEdit,
	onDelete,
}: {
	name: string;
	onEdit: () => void;
	onDelete: () => void;
}) {
	const shown = displayName(name);
	return (
		// biome-ignore lint/a11y/useSemanticElements: Conductor's row is a named group of a list, not a form's fieldset.
		<div
			role="group"
			aria-label={`${shown} MCP server`}
			className="flex min-h-16 items-center gap-3 px-3"
		>
			<span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
				<span
					aria-hidden="true"
					className="flex size-4 shrink-0 items-center justify-center text-xs leading-none font-medium text-fg-muted"
				>
					{shown.trim().charAt(0).toUpperCase()}
				</span>
			</span>
			<div className="min-w-0 flex-1">
				<div className="truncate text-sm font-medium text-fg">{shown}</div>
			</div>
			<Menu>
				<MenuTrigger asChild>
					<Button
						variant="ghost"
						size="xs"
						aria-label={`${shown} actions`}
						className="w-6 shrink-0 px-0 text-fg-muted"
					>
						<MoreVerticalIcon className="size-3.5" />
					</Button>
				</MenuTrigger>
				<MenuContent align="end">
					<MenuItem icon={<PencilIcon className="size-4" />} onSelect={onEdit}>
						Edit
					</MenuItem>
					<MenuItem destructive icon={<TrashIcon className="size-4" />} onSelect={onDelete}>
						Delete
					</MenuItem>
				</MenuContent>
			</Menu>
		</div>
	);
}

function ServerDialog({
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
	const [pending, setPending] = useState(false);
	const adding = editing === null;

	const update = (change: Partial<Draft>) => setDraft((current) => ({ ...current, ...change }));

	const changeAuth = (next: CloudMcpAuth) => {
		const change: Partial<Draft> = { authType: next };
		const token = draft.bearerToken.trim();
		if (next === "headers" && draft.authType === "bearer" && token !== "") {
			change.headersText = withBearerHeader(draft.headersText, token);
		}
		if (next === "bearer" && draft.authType === "headers") {
			const carried = bearerFromHeaders(draft.headersText);
			if (carried !== undefined) change.bearerToken = carried;
		}
		update(change);
	};

	const save = async () => {
		if (pending) return;
		const checked = checkedDraft(draft, taken, editing, server);
		if ("message" in checked) {
			setError(checked.message);
			return;
		}
		setError(null);
		setPending(true);
		const name = draft.name.trim();
		let saved = await onSave(name, checked.server);
		if (saved && editing !== null && editing !== name) saved = await onRemove(editing);
		setPending(false);
		// A refused save keeps the dialog open; the page has toasted why.
		if (saved) onClose();
	};

	return (
		<Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
			<DialogContent
				letShortcutsThrough
				title={adding ? "Add MCP server" : "Edit MCP server"}
				size="xl"
				onConfirm={() => void save()}
			>
				<div className="flex flex-col gap-3">
					<Field label="Name" htmlFor="mcp-server-name">
						<Input
							id="mcp-server-name"
							value={draft.name}
							onChange={(event) => update({ name: event.target.value })}
							placeholder="my-server"
							className="font-mono"
							autoFocus={adding}
							{...FIELD_INPUT}
						/>
					</Field>
					<Field label="URL" htmlFor="mcp-server-url">
						<Input
							id="mcp-server-url"
							value={draft.url}
							onChange={(event) => update({ url: event.target.value })}
							placeholder="https://example.com/mcp"
							className="font-mono"
							{...FIELD_INPUT}
						/>
					</Field>
					<Field label="Authentication" htmlFor="mcp-server-auth">
						<Select
							id="mcp-server-auth"
							value={draft.authType}
							options={AUTH_OPTIONS}
							onValueChange={changeAuth}
						/>
					</Field>
					{draft.authType === "bearer" ? (
						<Field label="Token" htmlFor="mcp-server-token">
							<Input
								id="mcp-server-token"
								value={draft.bearerToken}
								onChange={(event) => update({ bearerToken: event.target.value })}
								placeholder={
									draft.credentialConfigured
										? "Credential configured — enter a token to replace"
										: "Paste token"
								}
								className="font-mono"
								{...FIELD_INPUT}
							/>
						</Field>
					) : null}
					{draft.authType === "headers" ? (
						<Field label="Headers" htmlFor="mcp-server-headers">
							<Textarea
								id="mcp-server-headers"
								value={draft.headersText}
								onChange={(event) => update({ headersText: event.target.value })}
								placeholder={
									draft.credentialConfigured
										? "Credential configured — enter headers to replace"
										: "X-Api-Key: value\nOne header per line"
								}
								className="min-h-16 font-mono text-sm"
							/>
						</Field>
					) : null}
					{error === null ? null : <p className="text-sm text-danger">{error}</p>}
					<DialogFooter>
						<Button variant="ghost" size="sm" onClick={onClose}>
							Cancel
						</Button>
						<Button size="sm" data-primary-action disabled={pending} onClick={() => void save()}>
							{pending ? (
								"Saving…"
							) : (
								<>
									Save
									<span aria-hidden="true" className="ml-2 inline-flex items-center opacity-60">
										⌘<Kbd>↵</Kbd>
									</span>
								</>
							)}
						</Button>
					</DialogFooter>
				</div>
			</DialogContent>
		</Dialog>
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

interface LocalScan {
	candidates: ImportedMcpServer[];
	unreadableSources: string[];
	skippedCount: number;
}

/** What the dialog says when it offers nothing, in Conductor's order (`LPa`). */
function nothingToOffer(scan: LocalScan): string {
	if (scan.candidates.length > 0) return "All local MCP servers are already added";
	if (scan.unreadableSources.length > 0) return "Couldn't read local MCP configs";
	if (scan.skippedCount > 0) {
		return "No servers to import — only remote (HTTPS) servers are supported";
	}
	return "No local MCP servers found";
}

function ImportDialog({
	servers,
	onClose,
	onChoose,
}: {
	servers: Readonly<Record<string, CloudMcpServer>>;
	onClose: () => void;
	onChoose: (chosen: readonly ImportedMcpServer[]) => void;
}) {
	const actions = useActions();
	const [scan, setScan] = useState<LocalScan | null>(null);
	const [failed, setFailed] = useState(false);
	// Conductor chooses every server at first and records the ones the user clears.
	const [cleared, setCleared] = useState<ReadonlySet<string>>(new Set());
	const [query, setQuery] = useState("");

	useEffect(() => {
		let live = true;
		void actions.cloud.scanLocalMcpServers().then((result) => {
			if (!live) return;
			if (result.ok) setScan(result.value);
			else setFailed(true);
		});
		return () => {
			live = false;
		};
	}, [actions]);

	const offered =
		scan === null ? [] : scan.candidates.filter((candidate) => !alreadySaved(candidate, servers));
	const chosen = offered.filter((candidate) => !cleared.has(candidateKey(candidate)));
	const needle = query.trim().toLowerCase();
	const visible =
		needle === ""
			? offered
			: offered.filter((candidate) =>
					[candidate.name, candidate.url, candidate.sources.join(", ")].some((text) =>
						text.toLowerCase().includes(needle),
					),
				);
	const everyVisibleChosen =
		visible.length > 0 && visible.every((candidate) => !cleared.has(candidateKey(candidate)));

	const toggle = (candidate: ImportedMcpServer) => {
		setCleared((current) => {
			const key = candidateKey(candidate);
			const next = new Set(current);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
	};

	const toggleVisible = () => {
		setCleared((current) => {
			const next = new Set(current);
			for (const candidate of visible) {
				const key = candidateKey(candidate);
				if (everyVisibleChosen) next.add(key);
				else next.delete(key);
			}
			return next;
		});
	};

	const centred = "flex flex-1 items-center justify-center text-sm text-fg-muted";
	let body: ReactNode;
	if (scan === null && !failed) {
		body = (
			<div
				role="status"
				aria-label="Scanning local MCP servers"
				className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-fg-muted"
			>
				{/* The box around it carries the status, as Conductor's does. */}
				<span aria-hidden="true">
					<Spinner label="Scanning" kind="typing" className="size-5 text-fg-muted" />
				</span>
				<span>Scanning local MCP servers…</span>
			</div>
		);
	} else if (scan === null) {
		body = <p className={centred}>Couldn't read local MCP configs</p>;
	} else if (offered.length === 0) {
		body = <p className={centred}>{nothingToOffer(scan)}</p>;
	} else {
		body = (
			<div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border">
				<div className="flex shrink-0 items-center gap-1 border-b border-border p-1.5">
					<Input
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder="Search MCP servers..."
						className="h-8 flex-1 border-0 shadow-none focus-visible:ring-0"
						autoFocus
						{...FIELD_INPUT}
					/>
					{visible.length > 0 ? (
						<Button
							variant="ghost"
							size="sm"
							className="shrink-0 text-fg-muted"
							onClick={toggleVisible}
						>
							{everyVisibleChosen ? "Deselect all" : "Select all"}
						</Button>
					) : null}
				</div>
				<div className="max-h-72 min-h-0 flex-1 overflow-y-auto p-1">
					{visible.length > 0 ? (
						visible.map((candidate, index) => (
							<label
								key={candidateKey(candidate)}
								htmlFor={`mcp-import-${index}`}
								className="flex cursor-pointer items-center gap-2.5 rounded-sm px-2 py-1.5 hover:bg-hover"
							>
								<Checkbox
									id={`mcp-import-${index}`}
									aria-label={candidate.name}
									checked={!cleared.has(candidateKey(candidate))}
									onCheckedChange={() => toggle(candidate)}
								/>
								<span className="flex min-w-0 flex-col">
									<span className="truncate text-sm text-fg">{candidate.name}</span>
									<span className="truncate text-xs text-fg-muted">
										{`${candidate.sources.join(", ")} · ${candidate.url}`}
									</span>
								</span>
							</label>
						))
					) : (
						<p className="px-2 py-4 text-center text-sm text-fg-muted">No matching MCP servers.</p>
					)}
				</div>
			</div>
		);
	}

	return (
		<Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
			<DialogContent
				title="Select MCP servers"
				size="xl"
				className="h-[30rem] overflow-hidden"
				letShortcutsThrough
			>
				<div className="flex min-h-0 flex-1">{body}</div>
				<DialogFooter>
					<Button variant="ghost" size="sm" onClick={onClose}>
						Cancel
					</Button>
					<Button
						size="sm"
						data-primary-action
						disabled={chosen.length === 0}
						onClick={() => onChoose(chosen)}
					>
						{chosen.length === 0
							? "Add MCP servers"
							: chosen.length === 1
								? "Add 1 MCP server"
								: `Add ${chosen.length} MCP servers`}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
