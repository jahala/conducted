import { describe, expect, test } from "bun:test";
import type { SessionId } from "@conducted/shared";
import {
	appToolsMcpEntry,
	BRIDGE_TOKEN_ENV,
	codexConfigDefinesServer,
	codexMcpConfig,
	parseAppToolsMcpArgs,
} from "./mcp-launch.ts";

const entryInput = {
	sidecarExecutable: "/Applications/Conducted.app/bin/sidecar bin",
	sessionId: "s1" as SessionId,
	socketPath: "/tmp/x/s",
	workspaceDir: "/Users/me/Workspace",
	token: "secret-token",
	appTools: { diffComments: true, progressUpdates: false, setTargetBranch: false },
};

describe("SIDE-13 app tools MCP launch", () => {
	test("SIDE-13 the token goes in the environment and never in the arguments", () => {
		const entry = appToolsMcpEntry(entryInput);
		expect(entry.args.join(" ")).not.toContain("secret-token");
		expect(entry.env[BRIDGE_TOKEN_ENV]).toBe("secret-token");
		expect(entry.command).toBe("/Applications/Conducted.app/bin/sidecar bin");
		expect(entry.name).toBe("conducted");
	});

	test("SIDE-13 the arguments written for the helper parse back to the same values", () => {
		const entry = appToolsMcpEntry(entryInput);
		const parsed = parseAppToolsMcpArgs(entry.args.slice(1));
		expect(parsed).toEqual({
			ok: true,
			value: {
				sessionId: "s1" as SessionId,
				socketPath: "/tmp/x/s",
				workspaceDir: "/Users/me/Workspace",
				appTools: {
					diffComments: true,
					progressUpdates: false,
					setTargetBranch: false,
					localExecution: false,
				},
			},
		});
	});

	test("CLOUD-14 the local-execution switch is passed as a flag", () => {
		const entry = appToolsMcpEntry({
			...entryInput,
			appTools: {
				diffComments: false,
				progressUpdates: false,
				setTargetBranch: false,
				localExecution: true,
			},
		});
		expect(entry.args).toContain("--enable-local-execution");
		const parsed = parseAppToolsMcpArgs(entry.args.slice(1));
		expect(parsed.ok && parsed.value.appTools.localExecution).toBe(true);
	});

	test("SIDE-13 the Codex config names the server and keeps the token out of its arguments", () => {
		const config = codexMcpConfig(appToolsMcpEntry(entryInput));
		expect(config.args).toContain("--config");
		expect(config.args.join(" ")).toContain("mcp_servers.conducted.command=");
		expect(config.args.join(" ")).toContain("mcp_servers.conducted.args=");
		expect(config.args.join(" ")).not.toContain("secret-token");
		expect(config.env[BRIDGE_TOKEN_ENV]).toBe("secret-token");
	});

	test("SIDE-13 Codex is told to pass the token variable on to the helper, by name only", () => {
		const config = codexMcpConfig(appToolsMcpEntry(entryInput));

		expect(config.args).toEqual([
			"--config",
			'mcp_servers.conducted.command="/Applications/Conducted.app/bin/sidecar bin"',
			"--config",
			`mcp_servers.conducted.args=${JSON.stringify(appToolsMcpEntry(entryInput).args)}`,
			"--config",
			'mcp_servers.conducted.env_vars=["CONDUCTED_APP_TOOLS_TOKEN"]',
		]);
		expect(config.env).toEqual({ CONDUCTED_APP_TOOLS_TOKEN: "secret-token" });
	});

	test("SIDE-13 missing and unknown arguments are reported", () => {
		expect(parseAppToolsMcpArgs(["--socket", "/s"])).toEqual({
			ok: false,
			message: "Missing --session-id",
		});
		expect(parseAppToolsMcpArgs(["--session-id", "s", "--socket", "/s", "--unknown"]).ok).toBe(
			false,
		);
	});
});

describe("SIDE-13 a Codex config that already defines the reserved server name", () => {
	test.each([
		["a table", '[mcp_servers.conducted]\nurl = "http://localhost:9/mcp"'],
		["a quoted table", '[mcp_servers."conducted"]\ncommand = "x"'],
		["a sub-table", '[mcp_servers.conducted.env]\nA = "1"'],
		["a dotted key", 'mcp_servers.conducted.command = "x"'],
		["an inline table in [mcp_servers]", '[mcp_servers]\nconducted = { command = "x" }'],
		["a table with a comment after it", "[mcp_servers.conducted] # mine"],
	])("%s is found", (_kind, text) => {
		expect(codexConfigDefinesServer(text, "conducted")).toBe(true);
	});

	test.each([
		["a longer name", '[mcp_servers.conductedx]\nurl = "x"'],
		["the name inside another server", '[mcp_servers.other]\nconducted = "x"'],
		["a commented-out table", '# [mcp_servers.conducted]\nmodel = "o3"'],
		[
			"a nested array line and another table",
			'args = [\n["conducted"],\n]\n[profiles.conducted]\nx = 1',
		],
	])("%s is not", (_kind, text) => {
		expect(codexConfigDefinesServer(text, "conducted")).toBe(false);
	});
});
