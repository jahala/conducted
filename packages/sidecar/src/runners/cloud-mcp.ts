/**
 * @feature CLOUD-17 MCP servers in the cloud sandbox
 * Owns: the MCP servers a cloud workspace's Worker gives its sandbox, in the shape every runner
 * as an HTTP server, and the rule that a cloud server wins over a local one of the same name.
 * Behaviour: ui-map.md 6 Organization (MCP servers for cloud workspaces: None, Bearer token or
 * custom headers) and other-runners.md 2.1/5 (Conductor injects its cloud MCP servers into each
 * agent: Codex as `--config mcp_servers.<name>.url`, Cursor and Claude in the SDK's `mcpServers`,
 * ACP in `session/new`). The *sandbox* gets placeholder credentials only; the Worker's outbound
 * handler swaps in the real ones (D121).
 * Must handle: no value at all (no cloud servers), a value the Worker would never write (a bad
 * URL, name or header is dropped, the rest stay), and a local server of the same name (the cloud
 * one replaces it).
 * Our design choice: the servers travel as one JSON environment variable the Worker sets at start,
 * `CONDUCTED_CLOUD_MCP_SERVERS_JSON`, which is Conductor's own shape for its cloud sidecar. The
 * servers are remote and HTTPS only; Conductor's cloud MCP page has no stdio form either.
 * Test first: a cloud server replaces the local server of the same name and keeps the others.
 */
import { z } from "zod";

/** The value a cloud MCP header carries in place of a real credential. */
export const CLOUD_MCP_PLACEHOLDER = "provided-by-worker";

/** One remote MCP server as the sandbox receives it. */
export interface CloudMcpServer {
	name: string;
	url: string;
	headers: Record<string, string>;
}

/** A header name the HTTP specification allows (an RFC 9110 token). */
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
/** A server name: 1 to 64 letters, numbers, hyphens or underscores (Conductor's rule). */
const SERVER_NAME = /^[A-Za-z0-9_-]{1,64}$/;

/** True when a header value holds a line break or a NUL, which cannot be sent. */
function hasLineBreakOrNul(value: string): boolean {
	for (const character of value) {
		const code = character.codePointAt(0);
		if (code === 0 || code === 10 || code === 13) return true;
	}
	return false;
}

const zServer = z.object({
	name: z.string().regex(SERVER_NAME),
	url: z.string().refine((value) => {
		try {
			return new URL(value).protocol === "https:";
		} catch {
			return false;
		}
	}),
	headers: z.record(z.string(), z.string()).default({}),
});

/**
 * The servers in a Worker-written value. A value that is not JSON, or an entry with a bad name,
 * URL or header, is dropped: the Worker validates before it writes, so this only guards a value
 * a hand-made or older Worker set.
 */
export function parseCloudMcpServers(text: string | undefined): CloudMcpServer[] {
	if (text === undefined || text === "") return [];
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return [];
	}
	if (!Array.isArray(parsed)) return [];
	const seen = new Set<string>();
	const servers: CloudMcpServer[] = [];
	for (const entry of parsed) {
		const result = zServer.safeParse(entry);
		if (!result.success) continue;
		if (seen.has(result.data.name)) continue;
		const headers: Record<string, string> = {};
		let badHeader = false;
		for (const [name, value] of Object.entries(result.data.headers)) {
			if (!HEADER_NAME.test(name) || hasLineBreakOrNul(value)) {
				badHeader = true;
				break;
			}
			headers[name] = value;
		}
		if (badHeader) continue;
		seen.add(result.data.name);
		servers.push({ name: result.data.name, url: result.data.url, headers });
	}
	return servers;
}

/**
 * Claude's `Options.mcpServers` entry: an HTTP server with its placeholder headers. `alwaysLoad`
 * makes the agent wait (up to the SDK's 5 s connect cap) for the server, so its tools are in the
 * first turn's prompt; otherwise Claude defers them behind tool search.
 */
export function cloudClaudeServers(
	servers: readonly CloudMcpServer[],
): Record<
	string,
	{ type: "http"; url: string; headers: Record<string, string>; alwaysLoad: true }
> {
	const out: Record<
		string,
		{ type: "http"; url: string; headers: Record<string, string>; alwaysLoad: true }
	> = {};
	for (const server of servers) {
		out[server.name] = {
			type: "http",
			url: server.url,
			headers: { ...server.headers },
			alwaysLoad: true,
		};
	}
	return out;
}

/**
 * A local server map (Cursor's `mcpServers`, or any agent's own) with the cloud servers laid over
 * it. A cloud server of the same name replaces the local one; the others stay.
 */
export function withCloudMcpServers(
	local: Readonly<Record<string, unknown>>,
	servers: readonly CloudMcpServer[],
): Record<string, unknown> {
	const merged: Record<string, unknown> = { ...local };
	for (const server of servers) {
		merged[server.name] = {
			type: "http",
			url: server.url,
			headers: { ...server.headers },
		};
	}
	return merged;
}

/**
 * Codex's `--config` arguments. A later `--config` wins over the user's `config.toml`, so a cloud
 * server of the same name replaces the local one.
 */
export function codexCloudMcpArgs(servers: readonly CloudMcpServer[]): string[] {
	const args: string[] = [];
	for (const server of servers) {
		args.push("--config", `mcp_servers.${server.name}.url=${JSON.stringify(server.url)}`);
		args.push(
			"--config",
			`mcp_servers.${server.name}.http_headers=${JSON.stringify(server.headers)}`,
		);
	}
	return args;
}

/** The ACP `session/new` entries: HTTP servers with their placeholder headers. */
export function acpCloudMcpServers(servers: readonly CloudMcpServer[]): unknown[] {
	return servers.map((server) => ({
		type: "http",
		name: server.name,
		url: server.url,
		headers: { ...server.headers },
	}));
}
