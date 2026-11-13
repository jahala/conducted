/**
 * @feature CLOUD-17 MCP servers in the cloud sandbox
 * Owns: the pure parts the Cloud page's MCP screens share with the cloud settings service: one cloud
 * server's shape, a remote server a local scan found, the header text a user types, the unique name
 * an import gives a server, and Conductor's words for a save that fails.
 * Behaviour: ui-map.md 6 Organization (MCP auth types None, OAuth, Bearer token, Custom headers;
 * "Import from local", "Select MCP servers") and renderApp (the add form's header text rule and its
 * failure messages). D126 keeps these out of `core/cloud/settings.ts` and `core/cloud/mcp-import.ts`
 * so a screen reaches the pure parts without importing a service.
 * Test first: header text is one "Header-Name: value" per line, and a taken name gets a suffix.
 */

/** How a cloud MCP server authenticates (ui-map.md 6 Organization). */
export type CloudMcpAuth = "none" | "oauth" | "bearer" | "headers";

/** One MCP server a cloud workspace's agents see. It is remote and HTTPS, as Conductor's are. */
export interface CloudMcpServer {
	url: string;
	authType: CloudMcpAuth;
	/** The bearer token. It stays in the Worker; the sandbox only ever gets a placeholder. */
	bearerToken?: string;
	/** The custom header values. They stay in the Worker; the sandbox gets placeholders. */
	headers?: Record<string, string>;
	/** OAuth: the client ID the user gave ("Advanced client identity"); absent, the Worker registers one. */
	oauthClientId?: string;
	/** OAuth: that client's secret. It stays in the Worker. */
	oauthClientSecret?: string;
}

/**
 * An OAuth server's credential, as the Worker's token store answers it: Conductor's
 * `oauth_tokens` statuses (main-BE1h_1MP.js `f$e` @160222). A server with none is disconnected.
 */
export interface CloudMcpCredential {
	status: "active" | "needs_reauth";
	statusDetail?: string;
}

/** Where a connect stands (main-BE1h_1MP.js `y$e` @160557). */
export type CloudMcpConnectStatus = "pending" | "failed" | "absent";

/** The OAuth side of the cloud MCP servers: the callback URL and each server's credential. */
export interface CloudMcpOAuthView {
	callbackUrl: string;
	credentials: Record<string, CloudMcpCredential>;
}

/** One remote MCP server a local scan found. */
export interface ImportedMcpServer {
	name: string;
	url: string;
	headers: Record<string, string>;
	/** The config files' agents that held it, by their labels. */
	sources: string[];
}

/** Conductor's own words for a cloud MCP server that could not be added, changed or deleted. */
export const CLOUD_MCP_ADD_FAILED = "Couldn't add this MCP server";
export const CLOUD_MCP_UPDATE_FAILED = "Couldn't update this MCP server";
export const CLOUD_MCP_DELETE_FAILED = "Couldn't delete this MCP server";
/** Conductor's words for a connect or a disconnect that failed (renderApp `$Wi`, `hGo` @8675864). */
export const CLOUD_MCP_CONNECT_FAILED = "Couldn't connect this MCP server";
export const CLOUD_MCP_DISCONNECT_FAILED = "Couldn't disconnect this MCP server";

/**
 * The names Conductor shows for the servers it knows (renderApp `GXo` @8876605). Any other name
 * is shown with its first letter raised (`_M`).
 */
const DISPLAY_NAMES: ReadonlyMap<string, string> = new Map([
	["airtable", "Airtable"],
	["amplitude", "Amplitude"],
	["asana", "Asana"],
	["atlassian", "Atlassian"],
	["cloudflare", "Cloudflare"],
	["context7", "Context7"],
	["datadog", "Datadog"],
	["exa", "Exa"],
	["firecrawl", "Firecrawl"],
	["github", "GitHub"],
	["granola", "Granola"],
	["hex", "Hex"],
	["honeycomb", "Honeycomb"],
	["linear", "Linear"],
	["microsoft-learn", "Microsoft Learn"],
	["neon", "Neon"],
	["notion", "Notion"],
	["planetscale", "PlanetScale"],
	["posthog", "PostHog"],
	["sentry", "Sentry"],
	["slack", "Slack"],
	["snowflake", "Snowflake"],
	["stripe", "Stripe"],
	["supabase", "Supabase"],
	["vercel", "Vercel"],
	["workos", "WorkOS"],
]);

/** The name a server is shown by, as Conductor shows it. */
export function mcpDisplayName(name: string): string {
	return DISPLAY_NAMES.get(name.toLowerCase()) ?? name.charAt(0).toUpperCase() + name.slice(1);
}

/** A header name the HTTP specification allows (an RFC 9110 token). */
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
/** A server name: 1 to 64 letters, numbers, hyphens or underscores (Conductor's rule). */
export const SERVER_NAME = /^[A-Za-z0-9_-]{1,64}$/;
export const RESERVED_NAMES = new Set(["conductor", "conducted"]);

/** Conductor's own words for header text it cannot read (renderApp `Inr`). */
const HEADER_LINES_MESSAGE = 'Enter headers as one "Header-Name: value" per line';

/**
 * The headers a user typed for one server: one `Name: value` per line. A blank line is ignored;
 * a line without a name and a value, or with a name that is not a header, refuses the whole text.
 */
export function headerLines(
	text: string,
): { ok: true; headers: Record<string, string> } | { ok: false; message: string } {
	const headers: Record<string, string> = {};
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim();
		if (line === "") continue;
		const colon = line.indexOf(":");
		if (colon < 1) return { ok: false, message: HEADER_LINES_MESSAGE };
		const name = line.slice(0, colon).trim();
		const value = line.slice(colon + 1).trim();
		if (!HEADER_NAME.test(name) || value === "") {
			return { ok: false, message: HEADER_LINES_MESSAGE };
		}
		headers[name] = value;
	}
	return { ok: true, headers };
}

/** A server name the Worker accepts, made from `base`, and unique among `taken`. */
export function uniqueMcpServerName(base: string, taken: readonly string[]): string {
	let name = base
		.replace(/[^A-Za-z0-9_-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 64);
	if (name === "") name = "imported-mcp";
	if (!SERVER_NAME.test(name) || RESERVED_NAMES.has(name.toLowerCase())) {
		name = `mcp-${name}`.slice(0, 64);
	}
	if (!SERVER_NAME.test(name)) name = "imported-mcp";
	let unique = name;
	let attempt = 2;
	while (taken.includes(unique) || RESERVED_NAMES.has(unique.toLowerCase())) {
		unique = `${name.slice(0, 60)}-${attempt}`;
		attempt += 1;
	}
	return unique;
}
