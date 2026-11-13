/**
 * @feature CLOUD-17 MCP servers in the cloud sandbox
 * Owns: OAuth for the cloud MCP servers, done by the user's own Worker: finding a server's
 * authorization server, registering a client or using the one the user gave, the PKCE sign-in the
 * desktop opens in a browser, the callback that trades the code for tokens, the token store, its
 * refresh, and the status, cancel and disconnect answers the MCP page reads.
 * Behaviour: Conductor's MCP page (renderApp-DeUrsznk.js, read 2026-11-13): a connect answers an
 * `authorizationUrl` and a `state` (`connectMcpServer`, main-BE1h_1MP.js `g$e` @160364); a connect's status
 * is `pending`, `failed` or `absent` (`y$e`); a cancel answers `cancelled` (`v$e`); a server's
 * credential is `oauth_tokens` with status `active` or `needs_reauth` and an optional detail
 * (`f$e`); the page stops waiting after 600 s (`_Go` @8677032). Conductor's hosted service does
 * the protocol; its server code is not in the bundle, so the protocol is the MCP specification's
 * authorization flow (2025-06-18): protected resource metadata (RFC 9728), authorization server
 * metadata (RFC 8414, then OpenID discovery), dynamic client registration (RFC 7591), PKCE with
 * S256 (RFC 7636), the `resource` parameter (RFC 8707) and the issuer check (RFC 9207).
 * Must handle: a server with no metadata (the MCP 2025-03-26 rule: its origin is the issuer); a
 * server that offers no registration and no client ID (a message saying a client ID is needed); a
 * callback with an unknown or expired state (refused, nothing stored); an error the provider sends
 * back (the attempt is failed with its description); a token that expires (refreshed once, however
 * many requests ask at the same moment); a refresh the provider refuses (the server needs re-auth);
 * a server whose URL or client changed (its tokens are never sent to the new one); and a token that
 * never appears in a log line or an answer to the desktop.
 * Our design choice: every effect is a parameter (storage, fetch, clock, random bytes), so the
 * Durable Object that owns the store (mcp-oauth-store.ts) and the tests run the same code. Records
 * live in that Durable Object's storage: `token:<name>`, `client:<name>` and `pending:<name>`, one
 * of each per server. A connect replaces the server's pending record; a pending record lives
 * 600 s; a disconnect, a deleted server or a changed one removes them (`prune`).
 * Test first: connects through the provider's metadata, a registered client and PKCE.
 */
import { err, ok, type Result } from "@conducted/shared";
import type { CloudMcpServer } from "./settings.ts";

/** The callback the provider sends the browser back to. It carries no pairing token. */
export const MCP_OAUTH_CALLBACK_PATH = "/mcp-oauth/callback";

/** How long a connect waits for its callback: Conductor's page gives up after 600 s (`_Go`). */
export const CONNECT_TTL_MS = 600_000;

/** A token this close to its expiry is refreshed before it is sent. */
export const REFRESH_MARGIN_MS = 60_000;

/** How long one request to a provider may take. */
const PROVIDER_TIMEOUT_MS = 15_000;

/** The client name a registration gives the provider, which shows it on its consent screen. */
const CLIENT_NAME = "Conducted";

/** The storage the records live in: the Durable Object's own, which this matches. */
export interface OAuthStorage {
	get<T>(key: string): Promise<T | undefined>;
	put<T>(key: string, value: T): Promise<void>;
	delete(key: string): Promise<boolean>;
	list<T>(options: { prefix: string }): Promise<Map<string, T>>;
}

/** Everything the flow reaches outside itself. */
export interface OAuthDeps {
	storage: OAuthStorage;
	fetch: (request: Request) => Promise<Response>;
	now: () => number;
	randomBytes: (length: number) => Uint8Array;
	/** Refreshes in flight, by server name, so one expiry starts one refresh (single flight). */
	inflight: Map<string, Promise<string | null>>;
}

/** The status a connect has, in Conductor's words (`y$e`). */
export type ConnectStatus = "pending" | "failed" | "absent";

/** A connected server's credential, in Conductor's words (`f$e`). */
export interface McpCredential {
	status: "active" | "needs_reauth";
	statusDetail?: string;
	lastRefreshedAt?: string;
	accessTokenExpiresAt?: string;
}

type AuthMethod = "none" | "client_secret_basic" | "client_secret_post";

/** The parts of a provider's metadata the flow uses. */
interface AuthServer {
	issuer: string;
	authorizationEndpoint: string;
	tokenEndpoint: string;
	registrationEndpoint?: string;
	authMethods: readonly string[];
}

/** A client the Worker registered with a provider (RFC 7591). */
interface ClientRecord {
	issuer: string;
	redirectUri: string;
	serverOrigin: string;
	clientId: string;
	clientSecret?: string;
}

/** The client a token request names, and how it proves itself. */
interface TokenClient {
	tokenEndpoint: string;
	clientId: string;
	clientSecret?: string;
	authMethod: AuthMethod;
	/** True when the user gave the client ID, false when the Worker registered it. */
	configuredClient: boolean;
}

interface PendingRecord extends TokenClient {
	state: string;
	verifier: string;
	issuer: string;
	serverUrl: string;
	resource: string;
	redirectUri: string;
	createdAt: number;
	status: "pending" | "failed";
	detail?: string;
}

interface TokenRecord extends TokenClient {
	serverUrl: string;
	resource: string;
	accessToken: string;
	refreshToken?: string;
	/** Milliseconds since the epoch; absent when the provider gave no lifetime. */
	expiresAt?: number;
	status: "active" | "needs_reauth";
	statusDetail?: string;
	lastRefreshedAt: number;
}

/** The one effect a provider request needs. */
type Fetching = Pick<OAuthDeps, "fetch">;

const tokenKey = (name: string): string => `token:${name}`;
const clientKey = (name: string): string => `client:${name}`;
const pendingKey = (name: string): string => `pending:${name}`;

/** Base64url without padding (RFC 7636 appendix A). */
export function base64url(bytes: Uint8Array): string {
	let text = "";
	for (const byte of bytes) text += String.fromCharCode(byte);
	return btoa(text).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** The S256 code challenge for a verifier. */
export async function codeChallenge(verifier: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
	return base64url(new Uint8Array(digest));
}

/** Two strings compared without revealing where they first differ. */
function sameText(given: string, expected: string): boolean {
	const a = new TextEncoder().encode(given);
	const b = new TextEncoder().encode(expected);
	if (a.byteLength !== b.byteLength) return false;
	return crypto.subtle.timingSafeEqual(a, b);
}

/** The URL without a trailing slash on its path and without a fragment (RFC 8707 canonical form). */
export function canonicalResource(rawUrl: string): string {
	const url = new URL(rawUrl);
	url.hash = "";
	const path = url.pathname.replace(/\/+$/, "");
	return `${url.origin}${path}${url.search}`;
}

const withoutSlash = (value: string): string => value.replace(/\/+$/, "");

/** One request to a provider, refused rather than hung when it takes too long. */
async function send(deps: Fetching, request: Request): Promise<Response | null> {
	try {
		return await deps.fetch(
			new Request(request, { signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) }),
		);
	} catch {
		return null;
	}
}

async function getJson(deps: Fetching, url: string): Promise<Record<string, unknown> | null> {
	const answer = await send(deps, new Request(url, { headers: { accept: "application/json" } }));
	if (answer === null || !answer.ok) {
		await answer?.body?.cancel();
		return null;
	}
	try {
		const parsed: unknown = await answer.json();
		return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

/** A parameter of a `WWW-Authenticate: Bearer` challenge. */
function challengeParam(header: string | null, name: string): string | undefined {
	if (header === null) return undefined;
	const match = new RegExp(`${name}="([^"]*)"`, "i").exec(header);
	return match?.[1];
}

/** What an unauthenticated MCP `initialize` says: whether it needs a token, and its challenge. */
async function probe(
	deps: Fetching,
	serverUrl: string,
): Promise<{ unauthorized: boolean; challenge: string | null }> {
	const answer = await send(
		deps,
		new Request(serverUrl, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				accept: "application/json, text/event-stream",
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 0,
				method: "initialize",
				params: {
					protocolVersion: "2025-06-18",
					capabilities: {},
					clientInfo: { name: CLIENT_NAME, version: "1" },
				},
			}),
		}),
	);
	if (answer === null) return { unauthorized: false, challenge: null };
	await answer.body?.cancel();
	return {
		unauthorized: answer.status === 401,
		challenge: answer.headers.get("www-authenticate"),
	};
}

/** The protected resource metadata URLs to try, most specific first (RFC 9728 section 3.1). */
function resourceMetadataUrls(serverUrl: string): string[] {
	const url = new URL(serverUrl);
	const path = url.pathname.replace(/\/+$/, "");
	const urls = [];
	if (path !== "") urls.push(`${url.origin}/.well-known/oauth-protected-resource${path}`);
	urls.push(`${url.origin}/.well-known/oauth-protected-resource`);
	return urls;
}

/** The authorization server metadata URLs to try (RFC 8414 section 3.1, then OpenID discovery). */
function authServerMetadataUrls(issuer: string): string[] {
	const url = new URL(issuer);
	const path = url.pathname.replace(/\/+$/, "");
	if (path === "") {
		return [
			`${url.origin}/.well-known/oauth-authorization-server`,
			`${url.origin}/.well-known/openid-configuration`,
		];
	}
	return [
		`${url.origin}/.well-known/oauth-authorization-server${path}`,
		`${url.origin}/.well-known/openid-configuration${path}`,
		`${url.origin}${path}/.well-known/openid-configuration`,
	];
}

const isHttps = (value: unknown): value is string => {
	if (typeof value !== "string") return false;
	try {
		return new URL(value).protocol === "https:";
	} catch {
		return false;
	}
};

const stringList = (value: unknown): string[] =>
	Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

interface Discovery {
	server: AuthServer;
	resource: string;
	scope?: string;
}

/** Finds the server's authorization server, its endpoints, and the resource and scope to ask for. */
async function discover(deps: OAuthDeps, serverUrl: string): Promise<Result<Discovery, string>> {
	const probed = await probe(deps, serverUrl);
	const named = challengeParam(probed.challenge, "resource_metadata");
	let challengeScope = challengeParam(probed.challenge, "scope");
	let metadata: Record<string, unknown> | null = null;
	for (const url of named !== undefined && isHttps(named)
		? [named]
		: resourceMetadataUrls(serverUrl)) {
		metadata = await getJson(deps, url);
		if (metadata !== null) break;
	}
	const server = new URL(serverUrl);
	let issuer = server.origin;
	let resource = canonicalResource(serverUrl);
	if (metadata !== null) {
		const issuers = stringList(metadata.authorization_servers).filter(isHttps);
		if (issuers[0] === undefined) {
			return err("The server's metadata names no authorization server.");
		}
		issuer = issuers[0];
		if (typeof metadata.resource === "string") {
			// The resource the metadata names must be this server, or a path above it on its origin.
			let named: URL;
			try {
				named = new URL(metadata.resource);
			} catch {
				return err("The server's metadata names a resource that is not a URL.");
			}
			const namedPath = withoutSlash(named.pathname);
			const serverPath = withoutSlash(server.pathname);
			if (
				named.origin !== server.origin ||
				!(serverPath === namedPath || serverPath.startsWith(`${namedPath}/`) || namedPath === "")
			) {
				return err("The server's metadata names another resource.");
			}
			resource = canonicalResource(metadata.resource);
		}
		if (challengeScope === undefined) {
			const scopes = stringList(metadata.scopes_supported);
			if (scopes.length > 0) challengeScope = scopes.join(" ");
		}
	}
	let found: Record<string, unknown> | null = null;
	for (const url of authServerMetadataUrls(issuer)) {
		found = await getJson(deps, url);
		if (found !== null) break;
	}
	if (found === null) return err("The server's authorization server published no metadata.");
	if (typeof found.issuer === "string" && withoutSlash(found.issuer) !== withoutSlash(issuer)) {
		return err("The authorization server's metadata names another issuer.");
	}
	if (!isHttps(found.authorization_endpoint) || !isHttps(found.token_endpoint)) {
		return err("The authorization server has no HTTPS sign-in and token addresses.");
	}
	const methods = stringList(found.code_challenge_methods_supported);
	if (methods.length > 0 && !methods.includes("S256")) {
		return err("The authorization server does not support PKCE with S256.");
	}
	return ok({
		server: {
			issuer,
			authorizationEndpoint: found.authorization_endpoint,
			tokenEndpoint: found.token_endpoint,
			...(isHttps(found.registration_endpoint)
				? { registrationEndpoint: found.registration_endpoint }
				: {}),
			authMethods: stringList(found.token_endpoint_auth_methods_supported),
		},
		resource,
		...(challengeScope === undefined || challengeScope === "" ? {} : { scope: challengeScope }),
	});
}

/** How a client with a secret proves itself at the token endpoint (RFC 8414's default is basic). */
function secretMethod(supported: readonly string[]): AuthMethod {
	if (supported.length === 0 || supported.includes("client_secret_basic")) {
		return "client_secret_basic";
	}
	if (supported.includes("client_secret_post")) return "client_secret_post";
	return "client_secret_basic";
}

/** The client a connect uses: the user's, the one registered before, or a new registration. */
async function clientFor(
	deps: OAuthDeps,
	name: string,
	server: CloudMcpServer,
	found: AuthServer,
	redirectUri: string,
): Promise<Result<TokenClient, string>> {
	if (server.oauthClientId !== undefined && server.oauthClientId !== "") {
		const secret = server.oauthClientSecret;
		return ok({
			tokenEndpoint: found.tokenEndpoint,
			clientId: server.oauthClientId,
			...(secret === undefined || secret === "" ? {} : { clientSecret: secret }),
			authMethod: secret === undefined || secret === "" ? "none" : secretMethod(found.authMethods),
			configuredClient: true,
		});
	}
	const origin = new URL(server.url).origin;
	const saved = await deps.storage.get<ClientRecord>(clientKey(name));
	if (
		saved !== undefined &&
		saved.issuer === found.issuer &&
		saved.redirectUri === redirectUri &&
		saved.serverOrigin === origin
	) {
		return ok(registeredClient(found, saved));
	}
	if (found.registrationEndpoint === undefined) {
		return err(
			"This server does not register clients itself. Enter a client ID under Advanced client identity.",
		);
	}
	const answer = await send(
		deps,
		new Request(found.registrationEndpoint, {
			method: "POST",
			headers: { "content-type": "application/json", accept: "application/json" },
			body: JSON.stringify({
				client_name: CLIENT_NAME,
				redirect_uris: [redirectUri],
				grant_types: ["authorization_code", "refresh_token"],
				response_types: ["code"],
				token_endpoint_auth_method: "none",
			}),
		}),
	);
	if (answer === null) return err("The authorization server could not be reached.");
	let body: Record<string, unknown> = {};
	try {
		body = (await answer.json()) as Record<string, unknown>;
	} catch {
		body = {};
	}
	if (!answer.ok || typeof body.client_id !== "string" || body.client_id === "") {
		return err("The authorization server refused to register a client.");
	}
	const record: ClientRecord = {
		issuer: found.issuer,
		redirectUri,
		serverOrigin: origin,
		clientId: body.client_id,
		...(typeof body.client_secret === "string" && body.client_secret !== ""
			? { clientSecret: body.client_secret }
			: {}),
	};
	await deps.storage.put(clientKey(name), record);
	return ok(registeredClient(found, record));
}

function registeredClient(found: AuthServer, record: ClientRecord): TokenClient {
	return {
		tokenEndpoint: found.tokenEndpoint,
		clientId: record.clientId,
		...(record.clientSecret === undefined ? {} : { clientSecret: record.clientSecret }),
		authMethod: record.clientSecret === undefined ? "none" : secretMethod(found.authMethods),
		configuredClient: false,
	};
}

/**
 * Starts a sign-in for one OAuth server: the URL the desktop opens in the browser, and the state
 * the callback and the status check name it by. It replaces any earlier attempt for the server.
 */
export async function beginConnect(
	deps: OAuthDeps,
	name: string,
	server: CloudMcpServer,
	callbackUrl: string,
): Promise<Result<{ authorizationUrl: string; state: string }, string>> {
	if (server.authType !== "oauth") return err(`${name} does not use OAuth.`);
	const found = await discover(deps, server.url);
	if (!found.ok) return found;
	const client = await clientFor(deps, name, server, found.value.server, callbackUrl);
	if (!client.ok) return client;
	const state = base64url(deps.randomBytes(32));
	const verifier = base64url(deps.randomBytes(32));
	const url = new URL(found.value.server.authorizationEndpoint);
	url.searchParams.set("response_type", "code");
	url.searchParams.set("client_id", client.value.clientId);
	url.searchParams.set("redirect_uri", callbackUrl);
	url.searchParams.set("code_challenge", await codeChallenge(verifier));
	url.searchParams.set("code_challenge_method", "S256");
	url.searchParams.set("state", state);
	url.searchParams.set("resource", found.value.resource);
	if (found.value.scope !== undefined) url.searchParams.set("scope", found.value.scope);
	const pending: PendingRecord = {
		...client.value,
		state,
		verifier,
		issuer: found.value.server.issuer,
		serverUrl: server.url,
		resource: found.value.resource,
		redirectUri: callbackUrl,
		createdAt: deps.now(),
		status: "pending",
	};
	await deps.storage.put(pendingKey(name), pending);
	return ok({ authorizationUrl: url.toString(), state });
}

/** The pending attempt a state names, with its server's name. */
async function pendingFor(
	deps: OAuthDeps,
	state: string,
): Promise<{ name: string; pending: PendingRecord } | null> {
	const all = await deps.storage.list<PendingRecord>({ prefix: "pending:" });
	for (const [key, pending] of all) {
		if (sameText(state, pending.state)) return { name: key.slice("pending:".length), pending };
	}
	return null;
}

const expired = (deps: OAuthDeps, pending: PendingRecord): boolean =>
	deps.now() - pending.createdAt > CONNECT_TTL_MS;

/** The form body and headers a token request sends, with the client's proof. */
function tokenRequest(client: TokenClient, fields: Record<string, string>): Request {
	const body = new URLSearchParams(fields);
	const headers: Record<string, string> = {
		"content-type": "application/x-www-form-urlencoded",
		accept: "application/json",
	};
	if (client.clientSecret !== undefined && client.authMethod === "client_secret_basic") {
		const pair = `${encodeURIComponent(client.clientId)}:${encodeURIComponent(client.clientSecret)}`;
		headers.authorization = `Basic ${btoa(pair)}`;
	} else {
		body.set("client_id", client.clientId);
		if (client.clientSecret !== undefined && client.authMethod === "client_secret_post") {
			body.set("client_secret", client.clientSecret);
		}
	}
	return new Request(client.tokenEndpoint, { method: "POST", headers, body: body.toString() });
}

interface TokenAnswer {
	accessToken: string;
	refreshToken?: string;
	expiresIn?: number;
}

/** A token endpoint's answer, or the provider's reason (`error`, `error_description`). */
async function tokenAnswer(
	deps: OAuthDeps,
	request: Request,
): Promise<Result<TokenAnswer, { reason: string; refused: boolean }>> {
	const answer = await send(deps, request);
	if (answer === null) {
		return err({ reason: "The authorization server could not be reached.", refused: false });
	}
	let body: Record<string, unknown> = {};
	try {
		body = (await answer.json()) as Record<string, unknown>;
	} catch {
		body = {};
	}
	if (!answer.ok || typeof body.access_token !== "string" || body.access_token === "") {
		const described =
			typeof body.error_description === "string" && body.error_description !== ""
				? body.error_description
				: typeof body.error === "string"
					? body.error
					: `The token endpoint answered ${answer.status}.`;
		// A 4xx is the provider's refusal; a 5xx or a broken answer may pass.
		return err({ reason: described, refused: answer.status >= 400 && answer.status < 500 });
	}
	if (typeof body.token_type === "string" && body.token_type.toLowerCase() !== "bearer") {
		return err({
			reason: "The authorization server issued a token that is not a bearer token.",
			refused: true,
		});
	}
	return ok({
		accessToken: body.access_token,
		...(typeof body.refresh_token === "string" && body.refresh_token !== ""
			? { refreshToken: body.refresh_token }
			: {}),
		...(typeof body.expires_in === "number" && body.expires_in > 0
			? { expiresIn: body.expires_in }
			: {}),
	});
}

/** What the callback did, for the page the browser shows. */
export type CallbackOutcome =
	| { outcome: "connected"; name: string }
	| { outcome: "failed"; name: string; detail: string }
	| { outcome: "unknown" };

/** The query a provider sends the browser back with. */
export interface CallbackQuery {
	state: string | null;
	code: string | null;
	error: string | null;
	errorDescription: string | null;
	iss: string | null;
}

/**
 * Finishes a sign-in: trades the code for tokens and stores them. `servers` is the saved list, so
 * a server deleted or changed while the browser was open is not given tokens.
 */
export async function completeConnect(
	deps: OAuthDeps,
	query: CallbackQuery,
	servers: Readonly<Record<string, CloudMcpServer>>,
): Promise<CallbackOutcome> {
	if (query.state === null || query.state === "") return { outcome: "unknown" };
	const found = await pendingFor(deps, query.state);
	if (found === null || found.pending.status !== "pending" || expired(deps, found.pending)) {
		return { outcome: "unknown" };
	}
	const { name, pending } = found;
	const fail = async (detail: string): Promise<CallbackOutcome> => {
		await deps.storage.put(pendingKey(name), { ...pending, status: "failed", detail });
		return { outcome: "failed", name, detail };
	};
	if (query.error !== null) {
		return fail(query.errorDescription ?? query.error);
	}
	if (query.iss !== null && withoutSlash(query.iss) !== withoutSlash(pending.issuer)) {
		return fail("The sign-in came back from another issuer.");
	}
	const server = servers[name];
	if (server === undefined || server.authType !== "oauth" || server.url !== pending.serverUrl) {
		return fail("The server changed while you were signing in.");
	}
	if (query.code === null || query.code === "")
		return fail("The sign-in came back without a code.");
	const answer = await tokenAnswer(
		deps,
		tokenRequest(pending, {
			grant_type: "authorization_code",
			code: query.code,
			redirect_uri: pending.redirectUri,
			code_verifier: pending.verifier,
			resource: pending.resource,
		}),
	);
	if (!answer.ok) return fail(answer.error.reason);
	const now = deps.now();
	const record: TokenRecord = {
		tokenEndpoint: pending.tokenEndpoint,
		clientId: pending.clientId,
		...(pending.clientSecret === undefined ? {} : { clientSecret: pending.clientSecret }),
		authMethod: pending.authMethod,
		configuredClient: pending.configuredClient,
		serverUrl: pending.serverUrl,
		resource: pending.resource,
		accessToken: answer.value.accessToken,
		...(answer.value.refreshToken === undefined ? {} : { refreshToken: answer.value.refreshToken }),
		...(answer.value.expiresIn === undefined
			? {}
			: { expiresAt: now + answer.value.expiresIn * 1000 }),
		status: "active",
		lastRefreshedAt: now,
	};
	await deps.storage.put(tokenKey(name), record);
	await deps.storage.delete(pendingKey(name));
	return { outcome: "connected", name };
}

/** Where a connect stands: still waiting, failed, or gone (finished, cancelled or expired). */
export async function connectStatus(
	deps: OAuthDeps,
	name: string,
	state: string,
): Promise<ConnectStatus> {
	const pending = await deps.storage.get<PendingRecord>(pendingKey(name));
	if (pending === undefined || !sameText(state, pending.state)) return "absent";
	if (expired(deps, pending)) {
		await deps.storage.delete(pendingKey(name));
		return "absent";
	}
	return pending.status;
}

/** Stops waiting for a connect. False when it had already finished or gone. */
export async function cancelConnect(
	deps: OAuthDeps,
	name: string,
	state: string,
): Promise<boolean> {
	const pending = await deps.storage.get<PendingRecord>(pendingKey(name));
	if (pending === undefined || !sameText(state, pending.state)) return false;
	await deps.storage.delete(pendingKey(name));
	return pending.status === "pending" && !expired(deps, pending);
}

/** Forgets a server's tokens and any attempt in flight. Its registered client is kept. */
export async function disconnect(deps: OAuthDeps, name: string): Promise<void> {
	await deps.storage.delete(tokenKey(name));
	await deps.storage.delete(pendingKey(name));
	deps.inflight.delete(name);
}

function sameOrigin(left: string, right: string): boolean {
	try {
		return new URL(left).origin === new URL(right).origin;
	} catch {
		return false;
	}
}

/** True when a stored token belongs to the server as it is saved now. */
function belongsTo(record: TokenRecord, server: CloudMcpServer): boolean {
	// A new path on the same origin keeps the tokens, as Conductor keeps the credential (`FPa`).
	if (server.authType !== "oauth" || sameOrigin(record.serverUrl, server.url) === false)
		return false;
	const configured = server.oauthClientId !== undefined && server.oauthClientId !== "";
	if (configured !== record.configuredClient) return false;
	return !configured || server.oauthClientId === record.clientId;
}

/** Each OAuth server's credential, for the MCP page. A server with no tokens has none. */
export async function credentials(
	deps: OAuthDeps,
	servers: Readonly<Record<string, CloudMcpServer>>,
): Promise<Record<string, McpCredential>> {
	const answer: Record<string, McpCredential> = {};
	const records = await deps.storage.list<TokenRecord>({ prefix: "token:" });
	for (const [key, record] of records) {
		const name = key.slice("token:".length);
		const server = servers[name];
		if (server === undefined || !belongsTo(record, server)) continue;
		answer[name] = {
			status: record.status,
			...(record.statusDetail === undefined ? {} : { statusDetail: record.statusDetail }),
			lastRefreshedAt: new Date(record.lastRefreshedAt).toISOString(),
			...(record.expiresAt === undefined
				? {}
				: { accessTokenExpiresAt: new Date(record.expiresAt).toISOString() }),
		};
	}
	return answer;
}

async function refresh(deps: OAuthDeps, name: string, record: TokenRecord): Promise<string | null> {
	if (record.refreshToken === undefined) {
		await deps.storage.put(tokenKey(name), {
			...record,
			status: "needs_reauth",
			statusDetail: "The access token expired and the provider gave no refresh token.",
		});
		return null;
	}
	const answer = await tokenAnswer(
		deps,
		tokenRequest(record, {
			grant_type: "refresh_token",
			refresh_token: record.refreshToken,
			resource: record.resource,
		}),
	);
	if (!answer.ok) {
		// A refusal means the grant is gone; anything else may pass, so the token stays and the
		// next request tries again.
		if (answer.error.refused) {
			await deps.storage.put(tokenKey(name), {
				...record,
				status: "needs_reauth",
				statusDetail: answer.error.reason,
			});
		}
		return null;
	}
	const now = deps.now();
	const next: TokenRecord = {
		...record,
		accessToken: answer.value.accessToken,
		// A provider that rotates refresh tokens sends a new one; one that does not keeps the old.
		...(answer.value.refreshToken === undefined ? {} : { refreshToken: answer.value.refreshToken }),
		status: "active",
		lastRefreshedAt: now,
	};
	if (answer.value.expiresIn === undefined) delete next.expiresAt;
	else next.expiresAt = now + answer.value.expiresIn * 1000;
	delete next.statusDetail;
	await deps.storage.put(tokenKey(name), next);
	return next.accessToken;
}

/**
 * The access token the outbound handler puts on a request to `server`, refreshed first when it
 * is about to expire. Null when the server is not connected, needs re-auth, or the refresh failed.
 * Requests that arrive while a refresh runs wait for that one refresh.
 */
export async function accessToken(
	deps: OAuthDeps,
	name: string,
	server: CloudMcpServer,
): Promise<string | null> {
	const running = deps.inflight.get(name);
	if (running !== undefined) return running;
	const record = await deps.storage.get<TokenRecord>(tokenKey(name));
	if (record === undefined || !belongsTo(record, server) || record.status !== "active") return null;
	if (record.expiresAt === undefined || deps.now() < record.expiresAt - REFRESH_MARGIN_MS) {
		return record.accessToken;
	}
	// A second request may have started the refresh while this one read the record.
	const again = deps.inflight.get(name);
	if (again !== undefined) return again;
	const started = refresh(deps, name, record).finally(() => {
		if (deps.inflight.get(name) === started) deps.inflight.delete(name);
	});
	deps.inflight.set(name, started);
	return started;
}

/**
 * A server answered 401 to `token`. The next request refreshes it; with no refresh token the
 * server needs re-auth. A token that was already replaced is left alone.
 */
export async function tokenRejected(deps: OAuthDeps, name: string, token: string): Promise<void> {
	const record = await deps.storage.get<TokenRecord>(tokenKey(name));
	if (record === undefined || !sameText(token, record.accessToken)) return;
	if (record.refreshToken === undefined) {
		await deps.storage.put(tokenKey(name), {
			...record,
			status: "needs_reauth",
			statusDetail: "The server refused the access token.",
		});
		return;
	}
	await deps.storage.put(tokenKey(name), { ...record, expiresAt: 0 });
}

/**
 * Removes what a settings change made stale: everything for a server that is gone or no longer
 * uses OAuth, and the tokens of one whose URL's origin, client ID or client secret changed. The
 * same change in Conductor disconnects the server before it is saved (`pGo`, `gci`, `FPa`).
 */
export async function prune(
	deps: OAuthDeps,
	before: Readonly<Record<string, CloudMcpServer>>,
	after: Readonly<Record<string, CloudMcpServer>>,
): Promise<void> {
	const names = new Set([...Object.keys(before), ...Object.keys(after)]);
	for (const name of names) {
		const old = before[name];
		const now = after[name];
		if (now === undefined || now.authType !== "oauth") {
			await deps.storage.delete(tokenKey(name));
			await deps.storage.delete(pendingKey(name));
			await deps.storage.delete(clientKey(name));
			deps.inflight.delete(name);
			continue;
		}
		if (old === undefined) continue;
		const originChanged = !sameOrigin(old.url, now.url);
		const clientChanged =
			(old.oauthClientId ?? "") !== (now.oauthClientId ?? "") ||
			(old.oauthClientSecret ?? "") !== (now.oauthClientSecret ?? "");
		if (old.authType !== "oauth" || originChanged || clientChanged) {
			await deps.storage.delete(tokenKey(name));
			await deps.storage.delete(pendingKey(name));
			deps.inflight.delete(name);
		}
		if (originChanged) await deps.storage.delete(clientKey(name));
	}
}

/**
 * Whether a server needs OAuth: Conductor's import saves a server without headers as OAuth with
 * `detectAuth`, and its service decides. Ours asks the server: an unauthenticated `initialize`
 * that answers 401, or published protected resource metadata, means OAuth.
 */
export async function detectAuth(deps: Fetching, serverUrl: string): Promise<"oauth" | "none"> {
	const probed = await probe(deps, serverUrl);
	if (probed.unauthorized) return "oauth";
	for (const url of resourceMetadataUrls(serverUrl)) {
		const metadata = await getJson(deps, url);
		if (metadata !== null && stringList(metadata.authorization_servers).length > 0) return "oauth";
	}
	return "none";
}
