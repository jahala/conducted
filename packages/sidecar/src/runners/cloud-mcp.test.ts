/**
 * @feature CLOUD-17 MCP servers in the cloud sandbox
 * Tests the cloud MCP servers the Worker hands the sandbox: the JSON it receives, the map each
 * runner is given, and the cloud server winning over a local one of the same name.
 * Test first: a cloud server replaces the local server of the same name and keeps the others.
 */
import { describe, expect, test } from "bun:test";
import {
	acpCloudMcpServers,
	CLOUD_MCP_PLACEHOLDER,
	cloudClaudeServers,
	codexCloudMcpArgs,
	parseCloudMcpServers,
	withCloudMcpServers,
} from "./cloud-mcp.ts";

const SERVER = {
	name: "linear",
	url: "https://mcp.linear.app/mcp",
	headers: { authorization: `Bearer ${CLOUD_MCP_PLACEHOLDER}` },
};

describe("CLOUD-17 cloud MCP servers", () => {
	test("reads the servers the Worker writes, and ignores a value it would never write", () => {
		expect(parseCloudMcpServers(JSON.stringify([SERVER]))).toEqual([SERVER]);
		expect(parseCloudMcpServers(undefined)).toEqual([]);
		expect(parseCloudMcpServers("")).toEqual([]);
		expect(parseCloudMcpServers("{not json")).toEqual([]);
		expect(
			parseCloudMcpServers(
				JSON.stringify([
					SERVER,
					{ name: "plain-http", url: "http://example.com/mcp", headers: {} },
					{ name: "bad name", url: "https://example.com/mcp", headers: {} },
					{ name: "linear", url: "https://other.example.com/mcp", headers: {} },
					{ name: "bad-header", url: "https://example.com/mcp", headers: { "Bad Header": "x" } },
				]),
			),
		).toEqual([SERVER]);
	});

	test("a cloud server replaces a local one of the same name and keeps the rest", () => {
		const merged = withCloudMcpServers(
			{
				linear: { type: "http", url: "https://local.linear.example/mcp" },
				localOnly: { command: "local-server" },
			},
			[server()],
		);
		expect(merged).toEqual({
			linear: {
				type: "http",
				url: "https://mcp.linear.app/mcp",
				headers: { authorization: `Bearer ${CLOUD_MCP_PLACEHOLDER}` },
			},
			localOnly: { command: "local-server" },
		});
	});

	test("builds Claude's HTTP server map", () => {
		expect(cloudClaudeServers([server()])).toEqual({
			linear: {
				type: "http",
				url: "https://mcp.linear.app/mcp",
				headers: { authorization: `Bearer ${CLOUD_MCP_PLACEHOLDER}` },
				alwaysLoad: true,
			},
		});
	});

	test("builds Codex's --config arguments with the URL and headers", () => {
		expect(codexCloudMcpArgs([server()])).toEqual([
			"--config",
			`mcp_servers.linear.url=${JSON.stringify("https://mcp.linear.app/mcp")}`,
			"--config",
			`mcp_servers.linear.http_headers=${JSON.stringify({
				authorization: `Bearer ${CLOUD_MCP_PLACEHOLDER}`,
			})}`,
		]);
	});

	test("builds ACP's http servers", () => {
		expect(acpCloudMcpServers([server()])).toEqual([
			{
				type: "http",
				name: "linear",
				url: "https://mcp.linear.app/mcp",
				headers: { authorization: `Bearer ${CLOUD_MCP_PLACEHOLDER}` },
			},
		]);
	});
});

function server() {
	return { ...SERVER, headers: { ...SERVER.headers } };
}
