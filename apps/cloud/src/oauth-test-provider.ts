/**
 * @feature CLOUD-17 MCP servers in the cloud sandbox
 * Owns: the OAuth provider and MCP server the Worker's OAuth tests sign in to. It runs inside the
 * test, behind the `fetch` the flow is given, and keeps the rules a real provider holds: protected
 * resource metadata, authorization server metadata, client registration, PKCE with S256, one use
 * per code, the `resource` parameter, and refresh tokens that are spent once when it rotates them.
 * Behaviour: the same endpoints the live run's provider serves (cloud_c17_live.rs), and the MCP
 * specification's authorization flow (mcp-oauth.ts names the RFCs).
 * Our design choice: it is a stand-in for a third-party service the tests cannot reach; the live
 * run checks the flow against a provider over the network.
 */

export const RESOURCE = "https://mcp.provider.test/mcp";
export const ISSUER = "https://auth.provider.test";

export interface ProviderOptions {
	/** Seconds an access token lives. */
	expiresIn?: number;
	/** Whether a refresh spends the old refresh token and hands out a new one. */
	rotate?: boolean;
	/** Whether the provider registers clients (RFC 7591). */
	registration?: boolean;
	/** Whether the MCP server publishes protected resource metadata. */
	resourceMetadata?: boolean;
	/** A client the provider knows without registration, with its secret. */
	knownClient?: { id: string; secret: string };
}

interface Code {
	clientId: string;
	redirectUri: string;
	challenge: string;
	resource: string;
}

const json = (value: unknown, status = 200): Response =>
	Response.json(value, { status, headers: { "cache-control": "no-store" } });

function randomHex(): string {
	return [...crypto.getRandomValues(new Uint8Array(24))]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

async function s256(verifier: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
	let text = "";
	for (const byte of new Uint8Array(digest)) text += String.fromCharCode(byte);
	return btoa(text).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export class TestProvider {
	readonly options: Required<Omit<ProviderOptions, "knownClient">> &
		Pick<ProviderOptions, "knownClient">;
	readonly clients = new Map<string, { redirectUris: string[]; secret?: string }>();
	readonly codes = new Map<string, Code>();
	readonly refreshTokens = new Map<string, { clientId: string; resource: string }>();
	readonly accessTokens = new Set<string>();
	/** What the token endpoint was asked, in order: `authorization_code` or `refresh_token`. */
	readonly grants: string[] = [];
	/** How each token request proved its client: `basic`, `post` or `none`. */
	readonly clientProofs: string[] = [];
	registrations = 0;

	constructor(options: ProviderOptions = {}) {
		this.options = {
			expiresIn: options.expiresIn ?? 3600,
			rotate: options.rotate ?? true,
			registration: options.registration ?? true,
			resourceMetadata: options.resourceMetadata ?? true,
			knownClient: options.knownClient,
		};
		if (options.knownClient !== undefined) {
			this.clients.set(options.knownClient.id, {
				redirectUris: [],
				secret: options.knownClient.secret,
			});
		}
	}

	/** The `fetch` the Worker's flow is given. */
	readonly fetch = async (request: Request): Promise<Response> => {
		const url = new URL(request.url);
		if (url.origin === new URL(RESOURCE).origin) return this.#resource(request, url);
		if (url.origin === ISSUER) return this.#authServer(request, url);
		return new Response("unknown host", { status: 502 });
	};

	/** What a browser does with the authorization URL: the provider approves and redirects. */
	async approve(authorizationUrl: string): Promise<URL> {
		const answer = await this.fetch(new Request(authorizationUrl, { redirect: "manual" }));
		const location = answer.headers.get("location");
		if (answer.status !== 302 || location === null) {
			throw new Error(`authorize answered ${answer.status}: ${await answer.text()}`);
		}
		return new URL(location);
	}

	#resource(request: Request, url: URL): Response {
		if (url.pathname === "/.well-known/oauth-protected-resource/mcp") {
			if (!this.options.resourceMetadata) return new Response("not found", { status: 404 });
			return json({
				resource: RESOURCE,
				authorization_servers: [ISSUER],
				scopes_supported: ["mcp"],
			});
		}
		if (url.pathname !== "/mcp") return new Response("not found", { status: 404 });
		const header = request.headers.get("authorization") ?? "";
		const token = header.startsWith("Bearer ") ? header.slice(7) : "";
		if (!this.accessTokens.has(token)) {
			const challenge = this.options.resourceMetadata
				? `Bearer resource_metadata="${new URL(RESOURCE).origin}/.well-known/oauth-protected-resource/mcp"`
				: "Bearer";
			return new Response("unauthorized", {
				status: 401,
				headers: { "www-authenticate": challenge },
			});
		}
		return json({ jsonrpc: "2.0", id: 1, result: { ok: true } });
	}

	async #authServer(request: Request, url: URL): Promise<Response> {
		switch (url.pathname) {
			case "/.well-known/oauth-authorization-server":
				return json({
					issuer: ISSUER,
					authorization_endpoint: `${ISSUER}/authorize`,
					token_endpoint: `${ISSUER}/token`,
					...(this.options.registration ? { registration_endpoint: `${ISSUER}/register` } : {}),
					code_challenge_methods_supported: ["S256"],
					token_endpoint_auth_methods_supported: ["none", "client_secret_basic"],
				});
			case "/register": {
				const body = (await request.json()) as { redirect_uris?: string[] };
				const id = `client-${randomHex().slice(0, 8)}`;
				this.clients.set(id, { redirectUris: body.redirect_uris ?? [] });
				this.registrations += 1;
				return json({ client_id: id, redirect_uris: body.redirect_uris }, 201);
			}
			case "/authorize":
				return this.#authorize(url);
			case "/token":
				return this.#token(request);
			default:
				return new Response("not found", { status: 404 });
		}
	}

	#authorize(url: URL): Response {
		const params = url.searchParams;
		const clientId = params.get("client_id") ?? "";
		const redirectUri = params.get("redirect_uri") ?? "";
		const client = this.clients.get(clientId);
		if (client === undefined) return new Response("unknown client", { status: 400 });
		if (client.redirectUris.length > 0 && !client.redirectUris.includes(redirectUri)) {
			return new Response("redirect_uri not registered", { status: 400 });
		}
		if (params.get("response_type") !== "code" || params.get("code_challenge_method") !== "S256") {
			return new Response("bad request", { status: 400 });
		}
		const code = randomHex();
		this.codes.set(code, {
			clientId,
			redirectUri,
			challenge: params.get("code_challenge") ?? "",
			resource: params.get("resource") ?? "",
		});
		const back = new URL(redirectUri);
		back.searchParams.set("code", code);
		back.searchParams.set("state", params.get("state") ?? "");
		back.searchParams.set("iss", ISSUER);
		return new Response(null, { status: 302, headers: { location: back.toString() } });
	}

	/** Checks the client's proof and answers its id, or null when the proof is wrong. */
	#client(request: Request, form: URLSearchParams): string | null {
		const header = request.headers.get("authorization");
		if (header?.startsWith("Basic ")) {
			const [id, secret] = atob(header.slice(6)).split(":").map(decodeURIComponent);
			const client = this.clients.get(id ?? "");
			this.clientProofs.push("basic");
			return client?.secret !== undefined && client.secret === secret ? (id ?? null) : null;
		}
		const id = form.get("client_id") ?? "";
		const client = this.clients.get(id);
		if (client === undefined) return null;
		if (client.secret !== undefined) {
			this.clientProofs.push("post");
			return form.get("client_secret") === client.secret ? id : null;
		}
		this.clientProofs.push("none");
		return id;
	}

	#issue(clientId: string, resource: string, keepRefresh?: string): Response {
		const access = randomHex();
		this.accessTokens.add(access);
		const refresh = keepRefresh ?? randomHex();
		this.refreshTokens.set(refresh, { clientId, resource });
		return json({
			access_token: access,
			token_type: "Bearer",
			expires_in: this.options.expiresIn,
			...(keepRefresh === undefined ? { refresh_token: refresh } : {}),
		});
	}

	async #token(request: Request): Promise<Response> {
		const form = new URLSearchParams();
		for (const [key, value] of await request.formData()) {
			if (typeof value === "string") form.set(key, value);
		}
		const grant = form.get("grant_type") ?? "";
		this.grants.push(grant);
		const clientId = this.#client(request, form);
		if (clientId === null) return json({ error: "invalid_client" }, 401);
		if (grant === "authorization_code") {
			const code = this.codes.get(form.get("code") ?? "");
			this.codes.delete(form.get("code") ?? "");
			if (
				code === undefined ||
				code.clientId !== clientId ||
				code.redirectUri !== form.get("redirect_uri") ||
				code.resource !== form.get("resource") ||
				(await s256(form.get("code_verifier") ?? "")) !== code.challenge
			) {
				return json({ error: "invalid_grant", error_description: "The code is not valid." }, 400);
			}
			return this.#issue(clientId, code.resource);
		}
		if (grant === "refresh_token") {
			const token = form.get("refresh_token") ?? "";
			const held = this.refreshTokens.get(token);
			if (held === undefined || held.clientId !== clientId) {
				return json(
					{ error: "invalid_grant", error_description: "The refresh token is not valid." },
					400,
				);
			}
			if (this.options.rotate) {
				this.refreshTokens.delete(token);
				return this.#issue(clientId, held.resource);
			}
			return this.#issue(clientId, held.resource, token);
		}
		return json({ error: "unsupported_grant_type" }, 400);
	}
}
