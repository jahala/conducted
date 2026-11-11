/**
 * @feature CLOUD-17 MCP servers in the cloud sandbox
 * Tests the "Import from local" scan: the local config files it reads, the remote HTTPS servers
 * it offers, the duplicates it folds together, and the ones it leaves out with a count.
 * Test first: offers the remote HTTPS servers of every local agent, and folds duplicates together.
 */
import { ok, type Result } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import type { FileStat } from "../../platform/platform.ts";
import { headerLines, uniqueMcpServerName } from "../cloud-mcp.ts";
import type { TomlCodec } from "../services/settings.ts";
import { tomlCodec } from "../services/toml-codec.ts";
import { createCloudMcpImport, type LocalFileSystem } from "./mcp-import.ts";

const HOME = "/Users/conducted";

const codec: Pick<TomlCodec, "parse"> = tomlCodec;

/** A file system seeded with the exact texts a test names, and directory listings from them. */
function fakeFiles(files: Readonly<Record<string, string | null>>) {
	const reads: string[] = [];
	const registered: string[] = [];
	const fs: Pick<LocalFileSystem, "readText" | "exists" | "readDir" | "registerRoot"> = {
		readText: async (path: string): Promise<Result<string>> => {
			reads.push(path);
			const text = files[path];
			if (text === undefined || text === null) {
				return { ok: false, error: { code: "fs_not_found", message: "missing", cause: null } };
			}
			return ok(text);
		},
		exists: async (path: string) => files[path] !== undefined && files[path] !== null,
		readDir: async (path: string): Promise<Result<FileStat[]>> => {
			const prefix = path === "/" ? "/" : `${path}/`;
			const entries = new Map<string, FileStat>();
			for (const file of Object.keys(files)) {
				if (!file.startsWith(prefix)) continue;
				const rest = file.slice(prefix.length);
				if (rest === "") continue;
				const name = rest.split("/")[0] as string;
				const full = `${prefix}${name}`;
				entries.set(name, {
					path: full,
					isDirectory: rest.includes("/"),
					isSymlink: false,
					size: 0,
					modifiedAt: 0,
				});
			}
			if (entries.size === 0) {
				return { ok: false, error: { code: "fs_not_found", message: "missing", cause: null } };
			}
			return ok([...entries.values()]);
		},
		registerRoot: async (path: string) => {
			registered.push(path);
			return ok(undefined);
		},
	};
	return { fs, reads, registered };
}

function scan(files: Readonly<Record<string, string | null>>, repoRoots: string[] = []) {
	const fake = fakeFiles(files);
	const service = createCloudMcpImport({
		files: fake.fs,
		toml: codec,
		home: HOME,
		repoRoots: () => repoRoots,
	});
	return { service, ...fake };
}

const remote = (url: string, headers?: Record<string, string>) =>
	JSON.stringify({
		mcpServers: { server: { url, ...(headers === undefined ? {} : { headers }) } },
	});

describe("CLOUD-17 Import from local", () => {
	it("offers the remote HTTPS servers of every local agent, and folds duplicates together", async () => {
		const { service } = scan({
			[`${HOME}/.claude.json`]: JSON.stringify({
				mcpServers: {
					context: { type: "http", url: "https://mcp.context7.com/mcp" },
					stdio: { command: "npx", args: ["-y", "some-server"] },
				},
				projects: {
					"/code/app": {
						mcpServers: { linear: { url: "https://mcp.linear.app/mcp" } },
					},
				},
			}),
			[`${HOME}/Library/Application Support/Claude/claude_desktop_config.json`]: remote(
				"https://mcp.context7.com/mcp",
			),
			[`${HOME}/.cursor/mcp.json`]: JSON.stringify({
				mcpServers: { context: { url: "https://mcp.context7.com/mcp" } },
			}),
			[`${HOME}/.config/opencode/opencode.json`]: JSON.stringify({
				mcp: { exa: { type: "remote", url: "https://mcp.exa.ai/mcp" } },
			}),
			[`${HOME}/.codex/config.toml`]: [
				"[mcp_servers.sentry]",
				'url = "https://mcp.sentry.dev/mcp"',
				'http_headers = { "X-Api-Key" = "k" }',
				"",
				"[mcp_servers.local]",
				'command = "local-server"',
			].join("\n"),
		});
		const result = await service.scan();
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.candidates).toEqual([
			{
				name: "context",
				url: "https://mcp.context7.com/mcp",
				headers: {},
				sources: ["Claude Code", "Claude Desktop", "Cursor"],
			},
			{ name: "exa", url: "https://mcp.exa.ai/mcp", headers: {}, sources: ["OpenCode"] },
			{
				name: "linear",
				url: "https://mcp.linear.app/mcp",
				headers: {},
				sources: ["Claude Code"],
			},
			{
				name: "sentry",
				url: "https://mcp.sentry.dev/mcp",
				headers: { "X-Api-Key": "k" },
				sources: ["Codex"],
			},
		]);
		// The stdio server in Claude's file and Codex's [mcp_servers.local] are not remote.
		expect(result.value.skippedCount).toBe(2);
		expect(result.value.unreadableSources).toEqual([]);
	});

	it("reads Claude Code plugins and a project's own config files", async () => {
		const { service } = scan(
			{
				[`${HOME}/.claude/plugins/cache/thing/.mcp.json`]: remote("https://mcp.plugin.example/mcp"),
				"/code/app/.cursor/mcp.json": JSON.stringify({
					mcpServers: { cursorProject: { url: "https://mcp.cursor.example/mcp" } },
				}),
				"/code/app/opencode.json": JSON.stringify({
					mcp: { opencodeProject: { type: "remote", url: "https://mcp.opencode.example/mcp" } },
				}),
			},
			["/code/app"],
		);
		const result = await service.scan();
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.candidates.map((candidate) => candidate.name).sort()).toEqual([
			"cursorProject",
			"opencodeProject",
			"server",
		]);
	});

	it("leaves out a plain-HTTP server, a broken entry and one whose URL holds a variable", async () => {
		const { service } = scan({
			[`${HOME}/.claude.json`]: JSON.stringify({
				mcpServers: {
					plain: { url: "http://example.com/mcp" },
					env: { url: "https://$" + "{TENANT}.example.com/mcp" },
					broken: { headers: { X: "y" } },
					good: { url: "https://good.example/mcp" },
				},
			}),
		});
		const result = await service.scan();
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.candidates.map((candidate) => candidate.name)).toEqual(["good"]);
		expect(result.value.skippedCount).toBe(3);
	});

	it("names a config it cannot read and still reads the others", async () => {
		const { service } = scan({
			[`${HOME}/.claude.json`]: "{ not json",
			[`${HOME}/.cursor/mcp.json`]: remote("https://mcp.context7.com/mcp"),
		});
		const result = await service.scan();
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.unreadableSources).toEqual(["Claude Code"]);
		expect(result.value.candidates.map((candidate) => candidate.name)).toEqual(["server"]);
	});

	it("skips a Codex entry that reads its credential from the environment", async () => {
		const { service } = scan({
			[`${HOME}/.codex/config.toml`]: [
				"[mcp_servers.env]",
				'url = "https://env.example/mcp"',
				'bearer_token_env_var = "TOKEN"',
			].join("\n"),
		});
		const result = await service.scan();
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.candidates).toEqual([]);
		expect(result.value.skippedCount).toBe(1);
	});

	it("makes a name an MCP server can use, unique among the names already taken", () => {
		expect(uniqueMcpServerName("My Server", [])).toBe("My-Server");
		expect(uniqueMcpServerName("My Server", ["My-Server"])).toBe("My-Server-2");
		expect(uniqueMcpServerName("", [])).toBe("imported-mcp");
		expect(uniqueMcpServerName("conductor", [])).toBe("mcp-conductor");
	});
});

describe("CLOUD-17 the custom headers field", () => {
	it("reads one header per line, in the form Name: value", () => {
		expect(headerLines("X-Api-Key: secret\nX-Tenant: acme\n")).toEqual({
			ok: true,
			headers: { "X-Api-Key": "secret", "X-Tenant": "acme" },
		});
	});

	it("refuses a line without a name or a value, and a name that is not a header", () => {
		expect(headerLines("nope").ok).toBe(false);
		expect(headerLines("Bad Header: x").ok).toBe(false);
		expect(headerLines(": x").ok).toBe(false);
	});
});
