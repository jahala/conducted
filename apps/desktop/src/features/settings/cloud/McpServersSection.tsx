/**
 * @feature CLOUD-17 MCP servers in the cloud sandbox
 * Owns: the MCP page's body: the servers every cloud workspace's agents get, in Conductor's
 * Installed and Recommended tabs; the add and edit dialog; an OAuth server's status, its
 * Authenticate, Stop waiting and Disconnect; the Recommended catalogue and the setup dialogs a few
 * of its servers need; and "Import from local".
 * Behaviour: Conductor's MCP settings page in renderApp-DeUrsznk.js, read 2026-11-12 and
 * 2026-11-13 (offsets are characters): the page `$Pa` @10773184 (tabs, the installed search, the
 * empty lines, newest first, rows being added, the dialogs); a row and its actions menu (`KAt`
 * @8719663), an OAuth row's status, buttons, waiting and its Disconnect confirmation (`yGo`
 * @8677052, `CGo` @8684560, `EGo` @8685406, the toasts `xGo` @8684239 and after); the add and edit
 * dialog (`BDa` @10722882, its defaults `Anr` and the edit mapping `MDa` @10720649, the save
 * rules `$Da` @10721785, the callback URL `bGt` @10719908); the Recommended tab (`TPa` @10763650,
 * its cards `mci` @10760464, the catalogue `$nr` in core/cloud-mcp-catalogue.ts); the client
 * setup dialog (`zDa` @10729727, `UDa` @10734297) and Datadog's (`HDa` @10738336); and the
 * "Select MCP servers" import dialog (`MPa`, `LPa`). Conductor's page is an organisation page; ours
 * is the paired Worker's (D121), whose token store does the OAuth (apps/cloud mcp-oauth.ts).
 * Left out, as gaps: the "Used in your organization" section and its members (D004); Conductor's
 * first-party OAuth apps, so Asana, Slack and Snowflake always ask for the user's own client; and
 * favicons (McpServerIcon.tsx says why).
 * Data: the `mcpServers` of useCloudSettings, passed in; useCloudMcpOAuth for each OAuth server's
 * credential and the callback URL; Actions.cloud.connectMcpServer, mcpConnectStatus,
 * cancelMcpConnect, disconnectMcpServer, loadMcpOAuth, detectMcpAuth and scanLocalMcpServers;
 * Actions.app.openUrl and copyText. Saves, deletes and imports go through the page's callbacks,
 * which toast Conductor's failure titles.
 * Must handle: no servers and a search that matches none; a save the Worker refuses (the dialog
 * stays open); a sign-in that fails, is cancelled, finishes while the page waits, or runs past
 * 600 s (Conductor's toasts); a browser that will not open; a second answer arriving after a newer
 * attempt started (dropped); a recommended server already installed (marked, not offered); every
 * secret never shown once saved.
 * Test first: a new server starts on OAuth, and saving it opens the provider's sign-in.
 */
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import {
	CLOUD_MCP_CONNECT_FAILED,
	CLOUD_MCP_DISCONNECT_FAILED,
	type CloudMcpAuth,
	type CloudMcpCredential,
	type CloudMcpServer,
	headerLines,
	type ImportedMcpServer,
	mcpDisplayName,
	RESERVED_NAMES,
	SERVER_NAME,
	uniqueMcpServerName,
} from "../../../core/cloud-mcp.ts";
import {
	DATADOG_SITES,
	IMPORT_SEARCH_WORDS,
	RECOMMENDED_MCP_SERVERS,
	type RecommendedMcpServer,
	recommendedInstalled,
} from "../../../core/cloud-mcp-catalogue.ts";
import { useActions, useCloudMcpOAuth } from "../../../core/hooks.ts";
import { AlertDialog, AlertDialogContent } from "../../../ui/AlertDialog.tsx";
import { Button } from "../../../ui/Button.tsx";
import { Checkbox } from "../../../ui/Checkbox.tsx";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../../ui/Collapsible.tsx";
import { CopyButton } from "../../../ui/CopyButton.tsx";
import { cn } from "../../../ui/cn.ts";
import { Dialog, DialogContent, DialogFooter } from "../../../ui/Dialog.tsx";
import { Input, Label, Textarea } from "../../../ui/Input.tsx";
import {
	CheckIcon,
	ChevronRightIcon,
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
import { toast, toastError } from "../../../ui/Toast.tsx";
import { Tooltip } from "../../../ui/Tooltip.tsx";
import { McpServerIcon } from "./McpServerIcon.tsx";

/** Conductor's choices, in its order (`BDa`). */
const AUTH_OPTIONS: readonly { value: CloudMcpAuth; label: string }[] = [
	{ value: "oauth", label: "OAuth" },
	{ value: "bearer", label: "Bearer token" },
	{ value: "headers", label: "Custom headers" },
	{ value: "none", label: "None" },
];

const NAME_MESSAGE =
	'Names can be 1-64 letters, numbers, hyphens, or underscores — no spaces ("conducted" names are reserved)';

const BEARER = "Bearer ";

/** How long a sign-in is waited for, and how often it is checked (Conductor's `_Go`, `BWi`). */
const CONNECT_WAIT_MS = 600_000;
const CONNECT_POLL_MS = 2_000;

const AGAIN = "Try connecting the MCP server again.";

const EMPTY_LINE = "flex min-h-16 items-center justify-center text-sm text-fg-muted";
const FIELD_INPUT = {
	autoComplete: "off",
	autoCorrect: "off",
	autoCapitalize: "off",
	spellCheck: false,
} as const;
const CARD =
	"flex min-h-14 min-w-0 items-center gap-2.5 rounded-lg border border-border bg-canvas p-2.5 text-left";
const CARD_BUTTON = `${CARD} transition-[background-color,scale] duration-100 hover:bg-hover focus-visible:ring-2 focus-visible:ring-focus active:scale-[0.96] disabled:pointer-events-none disabled:opacity-50`;

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
	/** True when the saved server holds a bearer token or headers that an empty field keeps. */
	credentialConfigured: boolean;
	oauthClientId: string;
	oauthClientSecret: string;
	oauthClientSecretConfigured: boolean;
}

/**
 * The dialog's first state. A new server starts on OAuth (`Anr`). A saved one opens as Conductor
 * reopens it (`MDa`): a bearer token is a header to Conductor, so a bearer server opens as Custom
 * headers, with its credential kept until new headers replace it.
 */
function draftFor(name: string, server: CloudMcpServer | null): Draft {
	const authType: CloudMcpAuth =
		server === null
			? "oauth"
			: server.authType === "bearer" || server.authType === "headers"
				? "headers"
				: server.authType;
	return {
		name,
		url: server?.url ?? "",
		authType,
		bearerToken: "",
		headersText: "",
		credentialConfigured: server?.authType === "bearer" || server?.authType === "headers",
		oauthClientId: server?.oauthClientId ?? "",
		oauthClientSecret: "",
		oauthClientSecretConfigured: (server?.oauthClientSecret ?? "") !== "",
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
	if (draft.authType === "oauth") {
		const clientId = draft.oauthClientId.trim();
		const secret = draft.oauthClientSecret.trim();
		if (clientId === "" && secret !== "") return { message: "Enter a client ID" };
		const kept = previous?.authType === "oauth" ? (previous.oauthClientSecret ?? "") : "";
		if (
			previous?.authType === "oauth" &&
			kept !== "" &&
			clientId !== "" &&
			clientId !== (previous.oauthClientId ?? "") &&
			secret === ""
		) {
			return { message: "Enter the client secret for the new client ID" };
		}
		// An untouched secret field keeps the saved secret, which is never shown again.
		const clientSecret = secret !== "" ? secret : clientId !== "" ? kept : "";
		return {
			server: {
				url,
				authType: "oauth",
				...(clientId === "" ? {} : { oauthClientId: clientId }),
				...(clientSecret === "" ? {} : { oauthClientSecret: clientSecret }),
			},
		};
	}
	if (draft.authType === "bearer") {
		const token = draft.bearerToken.trim();
		if (token === "") return { message: "Enter a bearer token" };
		return { server: { url, authType: "bearer", bearerToken: token } };
	}
	const lines = headerLines(draft.headersText);
	if (!lines.ok) return { message: lines.message };
	if (Object.keys(lines.headers).length > 0) {
		return { server: { url, authType: "headers", headers: lines.headers } };
	}
	// Empty headers keep the saved credential, whichever form it was saved in.
	if (draft.credentialConfigured && previous?.authType === "bearer") {
		return { server: { url, authType: "bearer", bearerToken: previous.bearerToken } };
	}
	if (draft.credentialConfigured && previous?.authType === "headers") {
		return { server: { url, authType: "headers", headers: previous.headers } };
	}
	return { server: { url, authType: "none" } };
}

/** How a sign-in ended, for the toast or the dialog line that says so. */
type ConnectEnd = "connected" | "failed" | "absent" | "timeout" | "browser";

/**
 * One server's sign-in: asks the Worker for the provider's URL, opens it in the browser, and
 * checks every 2 s until the Worker has the tokens, the attempt failed, or 600 s passed. Only the
 * newest attempt's answers change anything.
 */
function useConnect(name: string, onEnd: (end: ConnectEnd) => void) {
	const actions = useActions();
	const [attempt, setAttempt] = useState<{ state: string; deadline: number } | null>(null);
	const [starting, setStarting] = useState(false);
	const ended = useRef(onEnd);
	ended.current = onEnd;

	const finish = useCallback((end: ConnectEnd) => {
		setAttempt(null);
		ended.current(end);
	}, []);

	/** The sign-in is no longer waited for: connected when the Worker now holds the tokens. */
	const settle = useCallback(
		async (otherwise: ConnectEnd) => {
			const loaded = await actions.cloud.loadMcpOAuth();
			const connected = loaded.ok && loaded.value.credentials[name]?.status === "active";
			finish(connected ? "connected" : otherwise);
		},
		[actions, name, finish],
	);

	useEffect(() => {
		if (attempt === null) return;
		let live = true;
		let checking = false;
		const check = async () => {
			if (checking) return;
			checking = true;
			try {
				if (Date.now() >= attempt.deadline) {
					const cancelled = await actions.cloud.cancelMcpConnect(name, attempt.state);
					if (!live) return;
					if (cancelled.ok && cancelled.value) finish("timeout");
					else await settle("timeout");
					return;
				}
				const status = await actions.cloud.mcpConnectStatus(name, attempt.state);
				if (!live || !status.ok) return;
				if (status.value === "failed") finish("failed");
				else if (status.value === "absent") await settle("absent");
			} finally {
				checking = false;
			}
		};
		void check();
		const timer = setInterval(() => void check(), CONNECT_POLL_MS);
		return () => {
			live = false;
			clearInterval(timer);
		};
	}, [attempt, actions, name, finish, settle]);

	const start = useCallback(async (): Promise<boolean> => {
		setStarting(true);
		const started = await actions.cloud.connectMcpServer(name);
		setStarting(false);
		if (!started.ok) {
			toastError(CLOUD_MCP_CONNECT_FAILED, started.error);
			return false;
		}
		const next = { state: started.value.state, deadline: Date.now() + CONNECT_WAIT_MS };
		setAttempt(next);
		const opened = await actions.app.openUrl(started.value.authorizationUrl);
		if (!opened.ok) {
			await actions.cloud.cancelMcpConnect(name, next.state);
			finish("browser");
			return false;
		}
		return true;
	}, [actions, name, finish]);

	const stop = useCallback(async () => {
		if (attempt === null) return;
		const cancelled = await actions.cloud.cancelMcpConnect(name, attempt.state);
		if (!cancelled.ok) {
			toast.error("Couldn't stop waiting", { description: "Check your connection and try again." });
			return;
		}
		if (cancelled.value) setAttempt(null);
		else await settle("absent");
	}, [actions, attempt, name, settle]);

	return { waiting: attempt !== null, starting, start, stop };
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
	const actions = useActions();
	const oauth = useCloudMcpOAuth();
	const credentials = oauth.state === "ready" ? oauth.data.credentials : {};
	const callbackUrl = oauth.state === "ready" ? oauth.data.callbackUrl : undefined;
	const [tab, setTab] = useState("installed");
	const [installedQuery, setInstalledQuery] = useState("");
	const [recommendedQuery, setRecommendedQuery] = useState("");
	const [editing, setEditing] = useState<string | null | undefined>(undefined);
	const [importing, setImporting] = useState(false);
	const [setup, setSetup] = useState<RecommendedMcpServer | null>(null);
	/** Servers saved here that start their sign-in as soon as their row appears (Conductor's `b`). */
	const [autoConnect, setAutoConnect] = useState<ReadonlySet<string>>(new Set());
	/** Recommended servers being added, shown as rows until the save answers (Conductor's `y`). */
	const [adding, setAdding] = useState<Readonly<Record<string, CloudMcpServer>>>({});
	const names = Object.keys(servers);
	const needle = installedQuery.trim().toLowerCase();
	const matches = (name: string, url: string) =>
		needle === "" || name.toLowerCase().includes(needle) || url.toLowerCase().includes(needle);
	// Newest first, as Conductor lists them.
	const shown = names
		.filter((name) => matches(name, (servers[name] as CloudMcpServer).url))
		.reverse();
	const pendingRows = Object.entries(adding).filter(
		([name, server]) => servers[name] === undefined && matches(name, server.url),
	);

	const connectSoon = (name: string) =>
		setAutoConnect((current) => (current.has(name) ? current : new Set(current).add(name)));
	const connectStarted = useCallback(
		(name: string) =>
			setAutoConnect((current) => {
				if (!current.has(name)) return current;
				const next = new Set(current);
				next.delete(name);
				return next;
			}),
		[],
	);

	/** A saved change can drop an OAuth server's tokens in the Worker, so the list is read again. */
	const reloadCredentials = () => void actions.cloud.loadMcpOAuth();

	const save = async (name: string, server: CloudMcpServer, isNew: boolean): Promise<boolean> => {
		const saved = await onSave(name, server);
		if (!saved) return false;
		reloadCredentials();
		if (isNew && server.authType === "oauth") connectSoon(name);
		return true;
	};

	const remove = async (name: string): Promise<boolean> => {
		const removed = await onRemove(name);
		if (removed) reloadCredentials();
		return removed;
	};

	const showInstalled = () => {
		setInstalledQuery("");
		setTab("installed");
	};

	/** A recommended server with nothing to set up is added at once (Conductor's `ae`). */
	const addRecommended = async (entry: RecommendedMcpServer) => {
		showInstalled();
		const server: CloudMcpServer = { url: entry.url, authType: entry.authType };
		setAdding((current) => ({ ...current, [entry.name]: server }));
		await save(entry.name, server, true);
		setAdding((current) => {
			const { [entry.name]: _done, ...rest } = current;
			return rest;
		});
	};

	const chooseRecommended = (entry: RecommendedMcpServer) => {
		if (entry.oauthSetup !== undefined) setSetup(entry);
		else void addRecommended(entry);
	};

	const runImport = async (chosen: readonly ImportedMcpServer[]) => {
		setImporting(false);
		const taken = [...names];
		const toImport: Record<string, CloudMcpServer> = {};
		for (const candidate of chosen) {
			const name = uniqueMcpServerName(candidate.name, taken);
			taken.push(name);
			if (Object.keys(candidate.headers).length > 0) {
				toImport[name] = { url: candidate.url, authType: "headers", headers: candidate.headers };
				continue;
			}
			// Conductor saves a server without headers as OAuth and lets its service detect the
			// truth (`detectAuth`); the Worker asks the server. One it cannot ask stays OAuth.
			const detected = await actions.cloud.detectMcpAuth(candidate.url);
			toImport[name] = {
				url: candidate.url,
				authType: detected.ok ? detected.value : "oauth",
			};
		}
		const added = Object.keys(toImport).length;
		const imported = await onImport(toImport);
		if (!imported) return;
		reloadCredentials();
		// Conductor's import ends on the Installed tab with the search cleared.
		showInstalled();
		toast.success(added === 1 ? "Added 1 MCP server" : `Added ${added} MCP servers`);
	};

	const recommended = recommendedQuery.trim().toLowerCase();
	const importMatches = recommended === "" || IMPORT_SEARCH_WORDS.includes(recommended);
	const catalogue = RECOMMENDED_MCP_SERVERS.filter(
		(entry) =>
			recommended === "" ||
			[mcpDisplayName(entry.name), entry.name].some((text) =>
				text.toLowerCase().includes(recommended),
			),
	);
	const installedOrAdding = { ...servers, ...adding };

	return (
		<>
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
					{shown.length === 0 && pendingRows.length === 0 ? (
						<div className={EMPTY_LINE}>
							{names.length === 0
								? "No MCP servers installed"
								: "No installed MCPs match your search"}
						</div>
					) : (
						<div className="divide-y divide-border overflow-hidden rounded-md border border-border">
							{pendingRows.map(([name, server]) => (
								<RowFrame
									key={`pending:${name}`}
									name={name}
									url={server.url}
									status={
										<StatusLine
											dot="bg-info"
											label={server.authType === "oauth" ? "Connecting…" : "Adding…"}
										/>
									}
								/>
							))}
							{shown.map((name) => {
								const server = servers[name] as CloudMcpServer;
								const onEdit = () => setEditing(name);
								const onDelete = () => void remove(name);
								return server.authType === "oauth" ? (
									<OAuthRow
										key={name}
										name={name}
										url={server.url}
										credential={credentials[name]}
										autoConnect={autoConnect.has(name)}
										onAutoConnectStarted={connectStarted}
										onEdit={onEdit}
										onDelete={onDelete}
									/>
								) : (
									<RowFrame
										key={name}
										name={name}
										url={server.url}
										onEdit={onEdit}
										onDelete={onDelete}
									/>
								);
							})}
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
							className="w-full pl-8"
						/>
					</div>
					{importMatches || catalogue.length > 0 ? (
						<div className="grid grid-cols-3 gap-3">
							{importMatches ? (
								<button type="button" onClick={() => setImporting(true)} className={CARD_BUTTON}>
									<span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-fg">
										<HardDriveDownloadIcon className="size-4" />
									</span>
									<span className="min-w-0 truncate text-sm font-medium text-fg">
										Import from local
									</span>
								</button>
							) : null}
							{catalogue.map((entry) => (
								<RecommendedCard
									key={entry.name}
									entry={entry}
									installed={recommendedInstalled(entry, installedOrAdding)}
									onChoose={() => chooseRecommended(entry)}
								/>
							))}
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
					callbackUrl={callbackUrl}
					onClose={() => setEditing(undefined)}
					onSave={(name, server) => save(name, server, editing === null)}
					onRemove={remove}
				/>
			) : null}
			{importing ? (
				<ImportDialog
					servers={servers}
					onClose={() => setImporting(false)}
					onChoose={(chosen) => void runImport(chosen)}
				/>
			) : null}
			{setup?.oauthSetup?.type === "redirect_allowlist" && callbackUrl !== undefined ? (
				<DatadogDialog
					entry={setup}
					callbackUrl={callbackUrl}
					onClose={() => setSetup(null)}
					onAdd={async (url) => {
						const saved = await save(setup.name, { url, authType: "oauth" }, true);
						if (saved) setSetup(null);
					}}
				/>
			) : null}
			{setup !== null &&
			setup.oauthSetup?.type !== "redirect_allowlist" &&
			callbackUrl !== undefined ? (
				<ClientSetupDialog
					entry={setup}
					callbackUrl={callbackUrl}
					saved={servers[setup.name] ?? null}
					onSave={(server) => save(setup.name, server, false)}
					onClose={() => setSetup(null)}
				/>
			) : null}
		</>
	);
}

/** A row's status: a dot and a word, with the Worker's detail as its tooltip (`CGo`). */
function StatusLine({ dot, label, detail }: { dot: string; label: string; detail?: string }) {
	const line = (
		<span
			tabIndex={detail === undefined ? undefined : 0}
			className="flex shrink-0 items-center gap-1.5"
		>
			<span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", dot)} />
			{label}
		</span>
	);
	return detail === undefined ? line : <Tooltip content={detail}>{line}</Tooltip>;
}

/** Conductor's row (`KAt`): the mark, the name, an optional status, buttons and the actions menu. */
function RowFrame({
	name,
	url,
	status,
	actions,
	menuDisabled = false,
	onEdit,
	onDelete,
}: {
	name: string;
	url: string;
	status?: ReactNode;
	actions?: ReactNode;
	menuDisabled?: boolean;
	onEdit?: () => void;
	onDelete?: () => void;
}) {
	const shown = mcpDisplayName(name);
	return (
		// biome-ignore lint/a11y/useSemanticElements: Conductor's row is a named group of a list, not a form's fieldset.
		<div
			role="group"
			aria-label={`${shown} MCP server`}
			className="flex min-h-16 items-center gap-3 px-3"
		>
			<span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
				<McpServerIcon name={name} url={url} />
			</span>
			<div className="min-w-0 flex-1">
				<div className="truncate text-sm font-medium text-fg">{shown}</div>
				{status === undefined ? null : (
					<div className="mt-0.5 flex min-w-0 items-center text-xs text-fg-muted">{status}</div>
				)}
			</div>
			{actions}
			{onEdit !== undefined && onDelete !== undefined ? (
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
						<MenuItem
							disabled={menuDisabled}
							icon={<PencilIcon className="size-4" />}
							onSelect={onEdit}
						>
							Edit
						</MenuItem>
						<MenuItem
							destructive
							disabled={menuDisabled}
							icon={<TrashIcon className="size-4" />}
							onSelect={onDelete}
						>
							Delete
						</MenuItem>
					</MenuContent>
				</Menu>
			) : null}
		</div>
	);
}

/** An OAuth server's row: its status, Authenticate or Stop waiting, and Disconnect (`yGo`, `EGo`). */
function OAuthRow({
	name,
	url,
	credential,
	autoConnect,
	onAutoConnectStarted,
	onEdit,
	onDelete,
}: {
	name: string;
	url: string;
	credential: CloudMcpCredential | undefined;
	autoConnect: boolean;
	onAutoConnectStarted: (name: string) => void;
	onEdit: () => void;
	onDelete: () => void;
}) {
	const actions = useActions();
	const [confirming, setConfirming] = useState(false);
	const [disconnecting, setDisconnecting] = useState(false);
	const connect = useConnect(name, (end) => {
		if (end === "failed") {
			toast.error(CLOUD_MCP_CONNECT_FAILED, {
				description: "Authorization failed. Try connecting the MCP server again.",
			});
		} else if (end === "absent") {
			toast.info(AGAIN);
		} else if (end === "timeout") {
			toast.error("Connection timed out", { description: AGAIN });
		} else if (end === "browser") {
			toast.error("Couldn't open your browser to connect", { description: AGAIN });
		}
	});
	const status = credential?.status;
	const active = status === "active";
	const connecting = (autoConnect && !active) || ((connect.waiting || connect.starting) && !active);

	const { start } = connect;
	useEffect(() => {
		if (!autoConnect) return;
		onAutoConnectStarted(name);
		if (!active) void start();
	}, [autoConnect, active, name, onAutoConnectStarted, start]);

	const disconnect = async () => {
		setConfirming(false);
		setDisconnecting(true);
		const done = await actions.cloud.disconnectMcpServer(name);
		setDisconnecting(false);
		if (!done.ok) toastError(CLOUD_MCP_DISCONNECT_FAILED, done.error);
	};

	const label = connecting
		? "Connecting…"
		: active
			? "Connected"
			: status === "needs_reauth"
				? "Needs re-auth"
				: "Disconnected";
	const dot = connecting
		? "bg-info"
		: active
			? "bg-success"
			: status === "needs_reauth"
				? "bg-warning"
				: "bg-fg-muted";

	const buttons = (
		<>
			{connecting && connect.waiting ? (
				<Button
					variant="ghost"
					size="sm"
					className="shrink-0 text-link hover:text-link"
					onClick={() => void connect.stop()}
				>
					Stop waiting
				</Button>
			) : !connecting && !active ? (
				<Button
					size="sm"
					className="shrink-0"
					disabled={connect.starting}
					onClick={() => void connect.start()}
				>
					{status === "needs_reauth" ? "Re-authenticate" : "Authenticate"}
				</Button>
			) : null}
			{!connecting && (active || status === "needs_reauth") ? (
				<Button variant="ghost" size="sm" className="shrink-0" onClick={() => setConfirming(true)}>
					Disconnect
				</Button>
			) : null}
		</>
	);

	return (
		<>
			<RowFrame
				name={name}
				url={url}
				status={<StatusLine dot={dot} label={label} detail={credential?.statusDetail} />}
				actions={buttons}
				menuDisabled={connecting || disconnecting}
				onEdit={onEdit}
				onDelete={onDelete}
			/>
			<AlertDialog open={confirming} onOpenChange={setConfirming}>
				<AlertDialogContent
					title={`Disconnect ${name}?`}
					confirmLabel="Disconnect"
					tone="destructive"
					onConfirm={() => void disconnect()}
				/>
			</AlertDialog>
		</>
	);
}

/** A Recommended card (`mci`): a button, or a marked group once installed. */
function RecommendedCard({
	entry,
	installed,
	onChoose,
}: {
	entry: RecommendedMcpServer;
	installed: boolean;
	onChoose: () => void;
}) {
	const shown = mcpDisplayName(entry.name);
	const body = (
		<>
			<span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
				<McpServerIcon name={entry.name} url={entry.url} />
			</span>
			<span className="min-w-0 flex-1">
				<span className="block truncate text-sm font-medium text-fg">{shown}</span>
			</span>
			{installed ? (
				<span aria-hidden="true" className="flex shrink-0 items-center gap-1 text-xs text-fg-muted">
					<CheckIcon className="size-3.5" />
					Installed
				</span>
			) : null}
		</>
	);
	if (installed) {
		return (
			// biome-ignore lint/a11y/useSemanticElements: Conductor's installed card is a named group, not a form's fieldset.
			<div role="group" aria-label={`${shown}, installed`} className={CARD}>
				{body}
			</div>
		);
	}
	return (
		<button type="button" aria-label={shown} className={CARD_BUTTON} onClick={onChoose}>
			{body}
		</button>
	);
}

/** The Worker's callback URL with a copy button (`bGt`). */
function CallbackUrl({ url }: { url: string }) {
	const actions = useActions();
	return (
		<div className="flex items-center gap-2 rounded-md bg-muted p-2 pl-3">
			<code className="min-w-0 flex-1 font-mono text-xs break-all">{url}</code>
			<CopyButton
				text={url}
				onCopy={(text) => actions.app.copyText(text)}
				iconOnly
				label="Copy OAuth callback URL"
				className="size-8 shrink-0 px-0 text-fg-muted"
			/>
		</div>
	);
}

function ServerDialog({
	editing,
	server,
	taken,
	callbackUrl,
	onClose,
	onSave,
	onRemove,
}: {
	editing: string | null;
	server: CloudMcpServer | null;
	taken: readonly string[];
	callbackUrl: string | undefined;
	onClose: () => void;
	onSave: (name: string, server: CloudMcpServer) => Promise<boolean>;
	onRemove: (name: string) => Promise<boolean>;
}) {
	const [draft, setDraft] = useState<Draft>(() => draftFor(editing ?? "", server));
	const [advanced, setAdvanced] = useState(
		() => draft.oauthClientId.trim() !== "" || draft.oauthClientSecretConfigured,
	);
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
					{draft.authType === "oauth" ? (
						<Collapsible open={advanced} onOpenChange={setAdvanced} className="flex flex-col gap-2">
							<CollapsibleTrigger className="flex min-h-8 w-fit items-center gap-1 px-0 text-left text-xs font-medium text-fg-muted transition-colors hover:bg-transparent hover:text-fg">
								<span>Advanced client identity</span>
								<ChevronRightIcon
									aria-hidden="true"
									className={cn("size-3.5 shrink-0 transition-transform", advanced && "rotate-90")}
								/>
							</CollapsibleTrigger>
							<CollapsibleContent className="grid grid-cols-2 gap-3">
								{callbackUrl !== undefined ? (
									<div className="col-span-2 flex flex-col gap-1.5">
										<Label>OAuth callback URL</Label>
										<CallbackUrl url={callbackUrl} />
									</div>
								) : null}
								<Field label="Client ID" htmlFor="mcp-server-oauth-client-id">
									<Input
										id="mcp-server-oauth-client-id"
										value={draft.oauthClientId}
										onChange={(event) => update({ oauthClientId: event.target.value })}
										className="font-mono"
										{...FIELD_INPUT}
									/>
								</Field>
								<Field label="Client secret" htmlFor="mcp-server-oauth-client-secret">
									<Input
										id="mcp-server-oauth-client-secret"
										type="password"
										value={draft.oauthClientSecret}
										onChange={(event) => update({ oauthClientSecret: event.target.value })}
										placeholder={
											draft.oauthClientSecretConfigured
												? "Configured — enter to replace"
												: undefined
										}
										className="font-mono"
										{...FIELD_INPUT}
									/>
								</Field>
							</CollapsibleContent>
						</Collapsible>
					) : null}
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

/**
 * The setup a server needs before it connects with the user's own client (`zDa`, `UDa`): the
 * server's URL when it has one per account (Snowflake), the callback URL to register, the client
 * ID and secret. Connect saves the server, opens the sign-in and waits for it.
 */
function ClientSetupDialog({
	entry,
	callbackUrl,
	saved,
	onSave,
	onClose,
}: {
	entry: RecommendedMcpServer;
	callbackUrl: string;
	saved: CloudMcpServer | null;
	onSave: (server: CloudMcpServer) => Promise<boolean>;
	onClose: () => void;
}) {
	const shown = mcpDisplayName(entry.name);
	const asksUrl = entry.oauthSetup?.type === "server_url_and_client_credentials";
	const docsUrl =
		entry.oauthSetup?.type === "redirect_allowlist" ? undefined : entry.oauthSetup?.docsUrl;
	const actions = useActions();
	const [serverUrl, setServerUrl] = useState(asksUrl ? "" : entry.url);
	const [clientId, setClientId] = useState("");
	const [clientSecret, setClientSecret] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const last = useRef<CloudMcpServer | null>(saved);
	const connect = useConnect(entry.name, (end) => {
		if (end === "connected") onClose();
		else if (end === "failed") setError("Authorization failed. Try connecting again.");
		else if (end === "browser") setError("Couldn't open your browser to connect. Try again.");
		else setError("Authorization timed out. Try connecting again.");
	});
	const waiting = connect.waiting;
	const busy = saving || connect.starting;

	const submit = async () => {
		if (busy || waiting) return;
		let url: string;
		try {
			const parsed = new URL(serverUrl.trim());
			if (parsed.protocol !== "https:") {
				setError("Enter an HTTPS server URL");
				return;
			}
			url = parsed.toString();
		} catch {
			setError("Enter a valid server URL");
			return;
		}
		if (clientId.trim() === "") {
			setError("Enter a client ID");
			return;
		}
		if (clientSecret.trim() === "") {
			setError("Enter a client secret");
			return;
		}
		setError(null);
		const server: CloudMcpServer = {
			url,
			authType: "oauth",
			oauthClientId: clientId.trim(),
			oauthClientSecret: clientSecret.trim(),
		};
		const previous = last.current;
		const changed =
			previous === null ||
			previous.url !== server.url ||
			previous.oauthClientId !== server.oauthClientId ||
			previous.oauthClientSecret !== server.oauthClientSecret;
		if (changed) {
			setSaving(true);
			const ok = await onSave(server);
			setSaving(false);
			if (!ok) return;
			last.current = server;
		}
		await connect.start();
	};

	return (
		<Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
			<DialogContent letShortcutsThrough title={`Connect ${shown}`} size="md">
				<div className="flex flex-col gap-3">
					<p className="text-sm text-fg-muted">
						{asksUrl
							? `Create a ${shown} MCP server and OAuth security integration. `
							: `${shown} requires credentials from your own ${shown} app. `}
						Follow the{" "}
						<button
							type="button"
							className="underline hover:text-fg"
							onClick={() => {
								if (docsUrl !== undefined) void actions.app.openUrl(docsUrl);
							}}
						>
							setup guide
						</button>{" "}
						to get its client ID and secret.
					</p>
					{asksUrl ? (
						<Field label="MCP server URL" htmlFor="mcp-setup-server-url">
							<Input
								id="mcp-setup-server-url"
								type="url"
								value={serverUrl}
								onChange={(event) => setServerUrl(event.target.value)}
								placeholder="https://…/mcp-servers/…"
								className="font-mono"
								autoFocus
								{...FIELD_INPUT}
							/>
						</Field>
					) : null}
					<div className="flex flex-col gap-1.5">
						<Label>OAuth callback URL</Label>
						<CallbackUrl url={callbackUrl} />
					</div>
					<Field label="Client ID" htmlFor="mcp-setup-client-id">
						<Input
							id="mcp-setup-client-id"
							value={clientId}
							onChange={(event) => setClientId(event.target.value)}
							className="font-mono"
							autoFocus={!asksUrl}
							{...FIELD_INPUT}
						/>
					</Field>
					<Field label="Client secret" htmlFor="mcp-setup-client-secret">
						<Input
							id="mcp-setup-client-secret"
							type="password"
							value={clientSecret}
							onChange={(event) => setClientSecret(event.target.value)}
							className="font-mono"
							{...FIELD_INPUT}
						/>
					</Field>
					{error === null ? null : <p className="text-sm text-danger">{error}</p>}
					{waiting ? (
						<p className="text-sm text-fg-muted">Finish connecting in your browser.</p>
					) : null}
					<DialogFooter>
						<Button variant="ghost" size="sm" onClick={onClose}>
							Cancel
						</Button>
						<Button
							size="sm"
							data-primary-action
							disabled={busy || waiting}
							onClick={() => void submit()}
						>
							{waiting ? "Waiting…" : busy ? "Connecting…" : "Connect"}
						</Button>
					</DialogFooter>
				</div>
			</DialogContent>
		</Dialog>
	);
}

/** Datadog's setup (`HDa`): its site, and the redirect URL to allow before connecting. */
function DatadogDialog({
	entry,
	callbackUrl,
	onClose,
	onAdd,
}: {
	entry: RecommendedMcpServer;
	callbackUrl: string;
	onClose: () => void;
	onAdd: (url: string) => Promise<void>;
}) {
	const [site, setSite] = useState(
		() => (DATADOG_SITES.find((option) => option.url === entry.url) ?? DATADOG_SITES[0])?.url ?? "",
	);
	const [adding, setAdding] = useState(false);
	return (
		<Dialog open onOpenChange={(open) => (open || adding ? undefined : onClose())}>
			<DialogContent
				letShortcutsThrough
				title="Connect Datadog"
				description="Before connecting, allow Conducted’s OAuth redirect URL in Datadog."
				size="md"
			>
				<div className="flex flex-col gap-4">
					<Field label="Datadog site" htmlFor="datadog-site">
						<Select
							id="datadog-site"
							value={site}
							options={DATADOG_SITES.map((option) => ({ value: option.url, label: option.label }))}
							onValueChange={setSite}
						/>
					</Field>
					<div className="flex flex-col gap-2 text-sm">
						<p>
							In Datadog, open{" "}
							<span className="font-medium">
								Organization Settings → Preferences → MCP OAuth Redirect URLs
							</span>
							.
						</p>
						<p>Add this URL:</p>
						<CallbackUrl url={callbackUrl} />
					</div>
					<DialogFooter>
						<Button variant="ghost" size="sm" disabled={adding} onClick={onClose}>
							Cancel
						</Button>
						<Button
							size="sm"
							data-primary-action
							disabled={adding}
							onClick={() => {
								setAdding(true);
								void onAdd(site).finally(() => setAdding(false));
							}}
						>
							{adding ? "Adding…" : "Add and connect"}
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
