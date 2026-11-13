/**
 * @feature CLOUD-17 Cloud settings page
 * Tests the personal cloud settings: the shape a save accepts, the names a user may not set, and
 * the environment an identity and the variables become in a sandbox start.
 * Test first: a reserved name is refused, and an identity becomes git's four names.
 */
import { describe, expect, it } from "vitest";
import {
	CLOUD_MCP_PLACEHOLDER,
	CLOUD_PROVIDER_KEY_NAMES,
	cloudEnvVarNameProblem,
	cloudMcpServerForUrl,
	cloudMcpServerNameProblem,
	cloudMcpServersEnv,
	cloudSettingsEnv,
	emptyCloudSettings,
	MAX_CLOUD_ENV_VARS,
	parseCloudSettings,
	RESERVED_CLOUD_ENV_NAMES,
} from "./settings.ts";

describe("CLOUD-17 cloud settings", () => {
	it("takes a git identity and personal variables", () => {
		const parsed = parseCloudSettings({
			gitIdentity: { name: "Sam Rivera", email: "sam@example.com" },
			envVars: { NODE_ENV: "development", API_URL: "https://api.example.com" },
		});
		expect(parsed).toEqual({
			gitIdentity: { name: "Sam Rivera", email: "sam@example.com" },
			envVars: { NODE_ENV: "development", API_URL: "https://api.example.com" },
			mcpServers: {},
		});
	});

	it("takes no identity at all", () => {
		expect(parseCloudSettings({ gitIdentity: null, envVars: {} })).toEqual(emptyCloudSettings());
	});

	it("refuses a name the sandbox sets itself", () => {
		expect(RESERVED_CLOUD_ENV_NAMES.has("PATH")).toBe(true);
		expect(parseCloudSettings({ gitIdentity: null, envVars: { PATH: "/tmp" } })).toBeNull();
		expect(parseCloudSettings({ gitIdentity: null, envVars: { GIT_AUTHOR_NAME: "x" } })).toBeNull();
		expect(parseCloudSettings({ gitIdentity: null, envVars: { CONDUCTED_LOG_DIR: "/tmp" } })).toBe(
			null,
		);
	});

	it("refuses a provider key, because the Worker holds it and never gives it to the sandbox", () => {
		expect(CLOUD_PROVIDER_KEY_NAMES.has("ANTHROPIC_API_KEY")).toBe(true);
		expect(parseCloudSettings({ gitIdentity: null, envVars: { ANTHROPIC_API_KEY: "sk-x" } })).toBe(
			null,
		);
	});

	it("refuses a name that is not a shell name, and too many variables", () => {
		expect(cloudEnvVarNameProblem("not a name")).toBe(
			"Variable names may only contain letters, numbers, and underscores.",
		);
		const many = Object.fromEntries(
			Array.from({ length: MAX_CLOUD_ENV_VARS + 1 }, (_, index) => [`VAR_${index}`, "x"]),
		);
		expect(parseCloudSettings({ gitIdentity: null, envVars: many })).toBeNull();
	});

	it("turns an identity into git's author and committer environment", () => {
		expect(
			cloudSettingsEnv({
				gitIdentity: { name: "Sam Rivera", email: "sam@example.com" },
				envVars: { NODE_ENV: "test" },
				mcpServers: {},
			}),
		).toEqual({
			NODE_ENV: "test",
			GIT_AUTHOR_NAME: "Sam Rivera",
			GIT_AUTHOR_EMAIL: "sam@example.com",
			GIT_COMMITTER_NAME: "Sam Rivera",
			GIT_COMMITTER_EMAIL: "sam@example.com",
		});
	});

	it("never hands over a name it would refuse on save", () => {
		expect(
			cloudSettingsEnv({
				gitIdentity: null,
				envVars: { PATH: "/tmp", NODE_ENV: "test" },
				mcpServers: {},
			}),
		).toEqual({ NODE_ENV: "test" });
	});

	it("takes a server with no auth, a bearer token or custom headers", () => {
		expect(
			parseCloudSettings({
				gitIdentity: null,
				envVars: {},
				mcpServers: {
					context: { url: "https://mcp.context7.com/mcp", authType: "none" },
					linear: {
						url: "https://mcp.linear.app/mcp",
						authType: "bearer",
						bearerToken: "lin_api_x",
					},
					internal: {
						url: "https://mcp.example.com/mcp",
						authType: "headers",
						headers: { "X-Api-Key": "secret", "X-Tenant": "acme" },
					},
				},
			}),
		).toEqual({
			gitIdentity: null,
			envVars: {},
			mcpServers: {
				context: { url: "https://mcp.context7.com/mcp", authType: "none" },
				linear: { url: "https://mcp.linear.app/mcp", authType: "bearer", bearerToken: "lin_api_x" },
				internal: {
					url: "https://mcp.example.com/mcp",
					authType: "headers",
					headers: { "X-Api-Key": "secret", "X-Tenant": "acme" },
				},
			},
		});
	});

	it("reads a stored object from before MCP servers as having none", () => {
		expect(parseCloudSettings({ gitIdentity: null, envVars: {} })).toEqual(emptyCloudSettings());
		expect(emptyCloudSettings().mcpServers).toEqual({});
	});

	it("refuses a server name Conductor or our app tools reserve, and a malformed name", () => {
		expect(cloudMcpServerNameProblem("linear")).toBeNull();
		expect(cloudMcpServerNameProblem("conductor")).toContain("reserved");
		expect(cloudMcpServerNameProblem("conducted")).toContain("reserved");
		expect(cloudMcpServerNameProblem("my server")).toContain("letters, numbers, hyphens");
		expect(cloudMcpServerNameProblem("x".repeat(65))).toContain("1-64");
	});

	it("refuses a URL that is not HTTPS and a token or header it could not send", () => {
		const base = { gitIdentity: null, envVars: {} };
		expect(
			parseCloudSettings({
				...base,
				mcpServers: { a: { url: "http://example.com/mcp", authType: "none" } },
			}),
		).toBeNull();
		expect(
			parseCloudSettings({
				...base,
				mcpServers: { a: { url: "https://user:pass@example.com/mcp", authType: "none" } },
			}),
		).toBeNull();
		expect(
			parseCloudSettings({
				...base,
				mcpServers: { a: { url: "https://example.com/mcp", authType: "bearer" } },
			}),
		).toBeNull();
		expect(
			parseCloudSettings({
				...base,
				mcpServers: { a: { url: "https://example.com/mcp", authType: "bearer", bearerToken: "" } },
			}),
		).toBeNull();
		expect(
			parseCloudSettings({
				...base,
				mcpServers: {
					a: {
						url: "https://example.com/mcp",
						authType: "headers",
						headers: { "Bad Header": "x" },
					},
				},
			}),
		).toBeNull();
		expect(
			parseCloudSettings({
				...base,
				mcpServers: {
					a: {
						url: "https://example.com/mcp",
						authType: "headers",
						headers: { "X-Api-Key": "line\nbreak" },
					},
				},
			}),
		).toBeNull();
		expect(
			parseCloudSettings({
				...base,
				mcpServers: { a: { url: "https://example.com/mcp", authType: "headers" } },
			}),
		).toBeNull();
	});

	it("gives the sandbox placeholders, never the token or header values", () => {
		const env = cloudMcpServersEnv({
			gitIdentity: null,
			envVars: {},
			mcpServers: {
				context: { url: "https://mcp.context7.com/mcp", authType: "none" },
				linear: {
					url: "https://mcp.linear.app/mcp",
					authType: "bearer",
					bearerToken: "lin_api_secret",
				},
				internal: {
					url: "https://mcp.example.com/mcp",
					authType: "headers",
					headers: { "X-Api-Key": "hidden", "X-Tenant": "acme" },
				},
			},
		});
		expect(env).toEqual({
			CONDUCTED_CLOUD_MCP_SERVERS_JSON: JSON.stringify([
				{ name: "context", url: "https://mcp.context7.com/mcp", headers: {} },
				{
					name: "internal",
					url: "https://mcp.example.com/mcp",
					headers: { "X-Api-Key": CLOUD_MCP_PLACEHOLDER, "X-Tenant": CLOUD_MCP_PLACEHOLDER },
				},
				{
					name: "linear",
					url: "https://mcp.linear.app/mcp",
					headers: { authorization: `Bearer ${CLOUD_MCP_PLACEHOLDER}` },
				},
			]),
		});
		expect(env.CONDUCTED_CLOUD_MCP_SERVERS_JSON).not.toContain("lin_api_secret");
		expect(env.CONDUCTED_CLOUD_MCP_SERVERS_JSON).not.toContain("hidden");
	});

	it("keeps an OAuth server with its client, and gives the sandbox only the placeholder", () => {
		const settings = parseCloudSettings({
			gitIdentity: null,
			envVars: {},
			mcpServers: {
				linear: {
					url: "https://mcp.linear.app/mcp",
					authType: "oauth",
					oauthClientId: "my-app",
					oauthClientSecret: "client-secret",
				},
			},
		});
		expect(settings?.mcpServers.linear?.oauthClientId).toBe("my-app");
		const env = cloudMcpServersEnv(settings ?? emptyCloudSettings());
		expect(JSON.parse(env.CONDUCTED_CLOUD_MCP_SERVERS_JSON ?? "[]")).toEqual([
			{
				name: "linear",
				url: "https://mcp.linear.app/mcp",
				headers: { authorization: `Bearer ${CLOUD_MCP_PLACEHOLDER}` },
			},
		]);
		expect(env.CONDUCTED_CLOUD_MCP_SERVERS_JSON).not.toContain("client-secret");
	});

	it("refuses a client secret without the client ID it belongs to, as Conductor's form does", () => {
		expect(
			parseCloudSettings({
				gitIdentity: null,
				envVars: {},
				mcpServers: {
					linear: { url: "https://mcp.linear.app/mcp", authType: "oauth", oauthClientSecret: "s" },
				},
			}),
		).toBeNull();
	});

	it("sets no variable at all when there are no MCP servers", () => {
		expect(cloudMcpServersEnv(emptyCloudSettings())).toEqual({});
	});

	it("matches a request to the server whose URL prefix it starts with", () => {
		const settings = parseCloudSettings({
			gitIdentity: null,
			envVars: {},
			mcpServers: {
				context: { url: "https://mcp.context7.com/mcp", authType: "none" },
				other: { url: "https://mcp.context7.com/other", authType: "bearer", bearerToken: "t" },
			},
		});
		expect(settings).not.toBeNull();
		const servers = settings?.mcpServers ?? {};
		expect(cloudMcpServerForUrl("https://mcp.context7.com/mcp/sub", servers)?.server.url).toBe(
			"https://mcp.context7.com/mcp",
		);
		expect(cloudMcpServerForUrl("https://mcp.context7.com/other", servers)?.server.url).toBe(
			"https://mcp.context7.com/other",
		);
		// A sibling path is not the server's, and a look-alike host is never one.
		expect(cloudMcpServerForUrl("https://mcp.context7.com/elsewhere", servers)).toBeNull();
		expect(cloudMcpServerForUrl("https://mcp.context7.com.evil.test/mcp", servers)).toBeNull();
	});
});
