/**
 * @feature CLOUD-17 MCP servers in the cloud sandbox
 * Owns: Conductor's Recommended MCP servers, in its order, with their URLs, how each signs in,
 * the setup a few of them need first, and Datadog's sites; and the rules that say whether a
 * recommended server is already installed.
 * Behaviour: renderApp-DeUrsznk.js, read 2026-11-13: the catalogue `$nr` @10757166 (24 servers:
 * 22 OAuth, Context7 and Exa none); Datadog's sites `JFe` beside `HDa` @10738336; installed means
 * the same name or a URL on the same host (`DRt`, `hci`). Conductor's first-party OAuth apps
 * (`firstPartyOauthServerUrls`) are its own hosted clients; we have none, so Asana, Slack and
 * Snowflake always ask for the user's own client, as Conductor does without one (`wPa`).
 * Our design choice: Slack's setup guide is Slack's own MCP page (docs.slack.dev), because
 * Conductor's link is its own guide to registering Conductor's callback.
 * Test first: lists Conductor's recommended servers in its order, after Import from local.
 */
import type { CloudMcpAuth, CloudMcpServer } from "./cloud-mcp.ts";

/** What a recommended server needs before it connects (Conductor's `oauthSetup`). */
export type McpOAuthSetup =
	| { type: "client_credentials"; docsUrl: string }
	| { type: "server_url_and_client_credentials"; docsUrl: string }
	| { type: "redirect_allowlist" };

export interface RecommendedMcpServer {
	name: string;
	url: string;
	authType: Extract<CloudMcpAuth, "oauth" | "none">;
	/** Other URLs the same service answers on, so an installed one is recognised. */
	alternativeUrls?: readonly string[];
	oauthSetup?: McpOAuthSetup;
}

/** Datadog's sites, in Conductor's order; US1 is the default (`_Gt`, `JFe`). */
export const DATADOG_SITES: readonly { label: string; url: string }[] = [
	{ label: "US1", url: "https://mcp.datadoghq.com/v1/mcp" },
	{ label: "US3", url: "https://mcp.us3.datadoghq.com/v1/mcp" },
	{ label: "US5", url: "https://mcp.us5.datadoghq.com/v1/mcp" },
	{ label: "EU1", url: "https://mcp.datadoghq.eu/v1/mcp" },
	{ label: "AP1", url: "https://mcp.ap1.datadoghq.com/v1/mcp" },
	{ label: "AP2", url: "https://mcp.ap2.datadoghq.com/v1/mcp" },
	{ label: "UK1", url: "https://mcp.uk1.datadoghq.com/v1/mcp" },
];

/** Conductor's Recommended tab, in its order. */
export const RECOMMENDED_MCP_SERVERS: readonly RecommendedMcpServer[] = [
	{ name: "granola", url: "https://mcp.granola.ai/mcp", authType: "oauth" },
	{ name: "notion", url: "https://mcp.notion.com/mcp", authType: "oauth" },
	{ name: "airtable", url: "https://mcp.airtable.com/mcp", authType: "oauth" },
	{ name: "linear", url: "https://mcp.linear.app/mcp", authType: "oauth" },
	{
		name: "asana",
		url: "https://mcp.asana.com/v2/mcp",
		authType: "oauth",
		oauthSetup: {
			type: "client_credentials",
			docsUrl: "https://developers.asana.com/docs/integrating-with-asanas-mcp-server",
		},
	},
	{ name: "posthog", url: "https://mcp.posthog.com/mcp", authType: "oauth" },
	{
		name: "amplitude",
		url: "https://mcp.amplitude.com/mcp",
		authType: "oauth",
		alternativeUrls: ["https://mcp.eu.amplitude.com/mcp"],
	},
	{
		name: "hex",
		url: "https://app.hex.tech/mcp",
		authType: "oauth",
		alternativeUrls: ["https://eu.hex.tech/mcp", "https://hc.hex.tech/mcp"],
	},
	{ name: "sentry", url: "https://mcp.sentry.dev/mcp", authType: "oauth" },
	{
		name: "datadog",
		url: "https://mcp.datadoghq.com/v1/mcp",
		authType: "oauth",
		alternativeUrls: DATADOG_SITES.slice(1).map((site) => site.url),
		oauthSetup: { type: "redirect_allowlist" },
	},
	{
		name: "slack",
		url: "https://mcp.slack.com/mcp",
		authType: "oauth",
		oauthSetup: {
			type: "client_credentials",
			docsUrl: "https://docs.slack.dev/ai/slack-mcp-server",
		},
	},
	{ name: "composio", url: "https://connect.composio.dev/mcp", authType: "oauth" },
	{ name: "stripe", url: "https://mcp.stripe.com", authType: "oauth" },
	{ name: "supabase", url: "https://mcp.supabase.com/mcp", authType: "oauth" },
	{ name: "vercel", url: "https://mcp.vercel.com", authType: "oauth" },
	{ name: "cloudflare", url: "https://mcp.cloudflare.com/mcp", authType: "oauth" },
	{ name: "neon", url: "https://mcp.neon.tech/mcp", authType: "oauth" },
	{ name: "planetscale", url: "https://mcp.pscale.dev/mcp/planetscale", authType: "oauth" },
	{
		name: "snowflake",
		url: "https://snowflake.com",
		authType: "oauth",
		oauthSetup: {
			type: "server_url_and_client_credentials",
			docsUrl: "https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-mcp",
		},
	},
	{ name: "atlassian", url: "https://mcp.atlassian.com/v1/mcp/authv2", authType: "oauth" },
	{
		name: "honeycomb",
		url: "https://mcp.honeycomb.io/mcp",
		authType: "oauth",
		alternativeUrls: ["https://mcp.eu1.honeycomb.io/mcp"],
	},
	{ name: "context7", url: "https://mcp.context7.com/mcp", authType: "none" },
	{
		name: "firecrawl",
		url: "https://mcp.firecrawl.dev/v2/mcp-oauth",
		authType: "oauth",
		alternativeUrls: ["https://mcp.firecrawl.dev/v2/mcp"],
	},
	{ name: "exa", url: "https://mcp.exa.ai/mcp", authType: "none" },
];

/** The words Conductor's search finds "Import from local" by (`vPa`). */
export const IMPORT_SEARCH_WORDS = [
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

function hostOf(url: string): string | undefined {
	try {
		return new URL(url).hostname.toLowerCase();
	} catch {
		return undefined;
	}
}

/** Every URL a recommended server answers on (`KVe`). */
export function recommendedUrls(server: RecommendedMcpServer): string[] {
	return [server.url, ...(server.alternativeUrls ?? [])];
}

/**
 * Whether a recommended server is installed: a saved server with its name, or one on any of its
 * hosts (`DRt`). `servers` holds the saved ones and the ones being added.
 */
export function recommendedInstalled(
	server: RecommendedMcpServer,
	servers: Readonly<Record<string, Pick<CloudMcpServer, "url">>>,
): boolean {
	const hosts = new Set(recommendedUrls(server).flatMap((url) => hostOf(url) ?? []));
	const name = server.name.toLowerCase();
	return Object.entries(servers).some(
		([saved, entry]) => saved.toLowerCase() === name || hosts.has(hostOf(entry.url) ?? ""),
	);
}
