/**
 * @feature CLOUD-05 Secrets stay outside the sandbox: the outbound handler swaps in the model key and GitHub token
 * Tests the outbound handler inside Cloudflare's local runtime: the sandbox's placeholder
 * credentials become the Worker's secrets for the model APIs and GitHub, the package hosts
 * CLOUD-04 lists pass, and every other host is refused. The real entrypoint is exercised for the
 * two refusals that need no network, so the export index.ts wires is the one tested.
 */
import { createExecutionContext, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { turnEndUrl } from "./backup.ts";
import type { Env } from "./env.ts";
import { Outbound, type OutboundSecrets, outboundRequest } from "./outbound.ts";
import { CLOUD_MCP_PLACEHOLDER, CLOUD_SETTINGS_KEY, type CloudMcpServer } from "./settings.ts";

const SECRETS: OutboundSecrets = {
	ANTHROPIC_API_KEY: "sk-ant-real",
	OPENAI_API_KEY: "sk-openai-real",
	CURSOR_API_KEY: "cursor-real",
	GITHUB_TOKEN: "ghp-real",
};

const MCP: Record<string, CloudMcpServer> = {
	context: { url: "https://mcp.context7.com/mcp", authType: "none" },
	linear: { url: "https://mcp.linear.app/mcp", authType: "bearer", bearerToken: "lin-real" },
	internal: {
		url: "https://mcp.example.com/mcp",
		authType: "headers",
		headers: { "X-Api-Key": "key-real", "X-Tenant": "acme" },
	},
	unkeyed: { url: "https://mcp.unkeyed.example/mcp", authType: "bearer" },
};

const request = (url: string, headers: Record<string, string> = {}): Request =>
	new Request(url, { headers });

function prepared(
	url: string,
	headers: Record<string, string> = {},
	mcpServers: Readonly<Record<string, CloudMcpServer>> = {},
): Request {
	const result = outboundRequest(request(url, headers), SECRETS, mcpServers);
	if (result instanceof Response) {
		throw new Error(`Expected a request, got ${result.status}`);
	}
	return result;
}

function refusal(
	url: string,
	secrets: OutboundSecrets = SECRETS,
	mcpServers: Readonly<Record<string, CloudMcpServer>> = {},
): Response {
	const result = outboundRequest(request(url), secrets, mcpServers);
	if (!(result instanceof Response)) throw new Error("Expected a refusal");
	return result;
}

describe("CLOUD-05 the outbound handler's credentials and allow-list", () => {
	it("replaces the sandbox's placeholder Anthropic key with the Worker's real key", () => {
		const sent = prepared("https://api.anthropic.com/v1/messages", {
			"x-api-key": "provided-by-worker",
			authorization: "Bearer provided-by-worker",
		});
		expect(sent.url).toBe("https://api.anthropic.com/v1/messages");
		expect(sent.headers.get("x-api-key")).toBe("sk-ant-real");
		expect(sent.headers.get("authorization")).toBeNull();
		expect(sent.redirect).toBe("manual");
	});

	it("swaps the Anthropic key when the launch sent it as the OAuth bearer header", () => {
		const sent = prepared("https://api.anthropic.com/v1/messages", {
			authorization: "Bearer provided-by-worker",
		});
		expect(sent.headers.get("authorization")).toBeNull();
		expect(sent.headers.get("x-api-key")).toBe("sk-ant-real");
	});

	it("reads the Worker's current secret on the next request, so a changed credential takes effect", () => {
		const first = prepared("https://api.anthropic.com/v1/messages");
		expect(first.headers.get("x-api-key")).toBe("sk-ant-real");
		const changed = outboundRequest(request("https://api.anthropic.com/v1/messages"), {
			...SECRETS,
			ANTHROPIC_API_KEY: "sk-ant-changed",
		});
		if (changed instanceof Response) throw new Error("Expected a request");
		expect(changed.headers.get("x-api-key")).toBe("sk-ant-changed");
	});

	it("refuses a model request when the Worker holds no key for that provider", () => {
		const response = refusal("https://api.anthropic.com/v1/messages", {});
		expect(response.status).toBe(503);
		expect(response.headers.get("content-type")).toContain("text/plain");
	});

	it("replaces the placeholder for the Worker's OpenAI key on the Codex API", () => {
		const sent = prepared("https://api.openai.com/v1/responses", {
			authorization: "Bearer provided-by-worker",
			"x-api-key": "provided-by-worker",
		});
		expect(sent.headers.get("authorization")).toBe("Bearer sk-openai-real");
		expect(sent.headers.get("x-api-key")).toBeNull();
		expect(sent.redirect).toBe("manual");
	});

	it("replaces the placeholder for the Worker's Cursor key on Cursor's SDK backend", () => {
		const sent = prepared("https://api2.cursor.sh/agent.v1.AgentService/Run", {
			authorization: "Bearer provided-by-worker",
			"x-api-key": "provided-by-worker",
		});
		expect(sent.headers.get("authorization")).toBe("Bearer cursor-real");
		expect(sent.headers.get("x-api-key")).toBeNull();
		expect(sent.redirect).toBe("manual");
	});

	it("refuses Cursor's API over plain HTTP and refuses a look-alike host", () => {
		expect(refusal("http://api2.cursor.sh/agent.v1.AgentService/Run").status).toBe(403);
		expect(refusal("https://api2.cursor.sh.example.com/agent.v1.AgentService/Run").status).toBe(
			403,
		);
	});

	it("adds the Worker's GitHub token to api.github.com and replaces a placeholder", () => {
		const sent = prepared("https://api.github.com/user", {
			authorization: "token provided-by-worker",
		});
		expect(sent.headers.get("authorization")).toBe("Bearer ghp-real");
		expect(sent.redirect).toBe("manual");
	});

	it("adds the Worker's GitHub token to a git clone on github.com", () => {
		const sent = prepared(
			"https://github.com/jahala/conducted.git/info/refs?service=git-upload-pack",
		);
		const expected = `Basic ${btoa("x-access-token:ghp-real")}`;
		expect(sent.headers.get("authorization")).toBe(expected);
		expect(sent.redirect).toBe("manual");
	});

	it("replaces the placeholder GitHub token the sandbox's git environment sends", () => {
		const sent = prepared(
			"https://github.com/jahala/conducted.git/info/refs?service=git-upload-pack",
			{
				authorization: `Basic ${btoa("x-access-token:provided-by-worker")}`,
			},
		);
		expect(sent.headers.get("authorization")).toBe(`Basic ${btoa("x-access-token:ghp-real")}`);
	});

	it("forwards GitHub without a token when the Worker holds none", () => {
		const sent = outboundRequest(
			request("https://github.com/jahala/conducted.git/info/refs?service=git-upload-pack", {
				authorization: "Basic provided-by-worker",
			}),
			{},
		);
		if (sent instanceof Response) throw new Error("Expected a request");
		expect(sent.headers.get("authorization")).toBeNull();
	});

	it("passes the package registries CLOUD-04 lists and refuses a look-alike host", () => {
		const sent = prepared("https://registry.npmjs.org/left-pad");
		expect(sent.url).toBe("https://registry.npmjs.org/left-pad");
		expect(sent.redirect).toBe("manual");
		expect(refusal("https://registry.npmjs.org.example.com/left-pad").status).toBe(403);
	});

	it("refuses every host outside GitHub, the model APIs and the package registries", () => {
		const response = refusal("https://example.com/");
		expect(response.status).toBe(403);
		expect(refusal("https://api.anthropic.com.evil.example/v1/messages").status).toBe(403);
	});

	it("allows plain HTTP only to a package registry", () => {
		expect(prepared("http://deb.debian.org/debian/dists/trixie/Release").url).toBe(
			"http://deb.debian.org/debian/dists/trixie/Release",
		);
		expect(refusal("http://github.com/jahala/conducted").status).toBe(403);
		expect(refusal("http://api.anthropic.com/v1/messages").status).toBe(403);
	});

	it("the real outbound entrypoint refuses an unknown host and reports a missing model key", async () => {
		const outbound = new Outbound(createExecutionContext(), env as unknown as Env);
		const blocked = await outbound.fetch(request("https://example.com/"));
		expect(blocked.status).toBe(403);
		const unkeyed = await outbound.fetch(request("https://api.anthropic.com/v1/messages"));
		expect(unkeyed.status).toBe(503);
	});
});

describe("CLOUD-17 the outbound handler's cloud MCP servers", () => {
	it("allows a server with no auth without touching its headers", () => {
		const sent = prepared("https://mcp.context7.com/mcp", { accept: "application/json" }, MCP);
		expect(sent.url).toBe("https://mcp.context7.com/mcp");
		expect(sent.headers.get("accept")).toBe("application/json");
		expect(sent.headers.get("authorization")).toBeNull();
		expect(sent.redirect).toBe("manual");
	});

	it("replaces the sandbox's bearer placeholder with the Worker's token", () => {
		const sent = prepared(
			"https://mcp.linear.app/mcp",
			{ authorization: `Bearer ${CLOUD_MCP_PLACEHOLDER}` },
			MCP,
		);
		expect(sent.headers.get("authorization")).toBe("Bearer lin-real");
	});

	it("replaces every custom header's placeholder with the Worker's value", () => {
		const sent = prepared(
			"https://mcp.example.com/mcp",
			{ "x-api-key": CLOUD_MCP_PLACEHOLDER, "x-tenant": CLOUD_MCP_PLACEHOLDER },
			MCP,
		);
		expect(sent.headers.get("x-api-key")).toBe("key-real");
		expect(sent.headers.get("x-tenant")).toBe("acme");
	});

	it("allows only the configured URL prefix on that host, and refuses look-alikes", () => {
		expect(prepared("https://mcp.context7.com/mcp/sub", {}, MCP).url).toBe(
			"https://mcp.context7.com/mcp/sub",
		);
		expect(refusal("https://mcp.context7.com/elsewhere", SECRETS, MCP).status).toBe(403);
		expect(refusal("https://mcp.context7.com.example.com/mcp", SECRETS, MCP).status).toBe(403);
		expect(refusal("http://mcp.context7.com/mcp", SECRETS, MCP).status).toBe(403);
		expect(refusal("https://mcp.context7.com:8443/mcp", SECRETS, MCP).status).toBe(403);
	});

	it("refuses a server whose credential the Worker does not hold", () => {
		const response = refusal("https://mcp.unkeyed.example/mcp", SECRETS, MCP);
		expect(response.status).toBe(503);
		expect(response.headers.get("content-type")).toContain("text/plain");
	});

	it("the real entrypoint reads the configured servers from the Worker's settings", async () => {
		const outbound = new Outbound(createExecutionContext(), env as unknown as Env);
		const { unkeyed: _unkeyed, ...stored } = MCP;
		await env.BACKUPS.put(
			CLOUD_SETTINGS_KEY,
			JSON.stringify({ gitIdentity: null, envVars: {}, mcpServers: stored }),
		);
		const original = globalThis.fetch;
		let sent: Request | null = null;
		globalThis.fetch = async (input: RequestInfo | URL) => {
			sent = input instanceof Request ? input : new Request(input);
			return new Response("ok");
		};
		try {
			const answer = await outbound.fetch(
				request("https://mcp.linear.app/mcp", {
					authorization: `Bearer ${CLOUD_MCP_PLACEHOLDER}`,
				}),
			);
			expect(answer.status).toBe(200);
			expect((sent as Request | null)?.headers.get("authorization")).toBe("Bearer lin-real");
			const unknown = await outbound.fetch(request("https://mcp.nope.example/mcp"));
			expect(unknown.status).toBe(403);
		} finally {
			globalThis.fetch = original;
			await env.BACKUPS.delete(CLOUD_SETTINGS_KEY);
		}
	});
});

describe("CLOUD-06 the sandbox's turn-end call reaches the outbound handler", () => {
	it("answers the turn-end route itself, refusing a wrong method and a bad workspace name", async () => {
		const outbound = new Outbound(createExecutionContext(), env as unknown as Env);
		const wrongMethod = await outbound.fetch(new Request(turnEndUrl("oslo-1")));
		expect(wrongMethod.status).toBe(405);
		expect(wrongMethod.headers.get("allow")).toBe("POST");
		const badName = await outbound.fetch(new Request(turnEndUrl("Not_A_Name"), { method: "POST" }));
		expect(badName.status).toBe(400);
	});
});
