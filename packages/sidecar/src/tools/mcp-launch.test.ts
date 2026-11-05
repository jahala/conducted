import { describe, expect, test } from "bun:test";
import type { SessionId } from "@conducted/shared";
import {
	appToolsMcpEntry,
	BRIDGE_TOKEN_ENV,
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
				appTools: { diffComments: true, progressUpdates: false, setTargetBranch: false },
			},
		});
	});

	test("SIDE-13 the Codex config names the server and keeps the token out of its arguments", () => {
		const config = codexMcpConfig(appToolsMcpEntry(entryInput));
		expect(config.args).toContain("--config");
		expect(config.args.join(" ")).toContain("mcp_servers.conducted.command=");
		expect(config.args.join(" ")).toContain("mcp_servers.conducted.args=");
		expect(config.args.join(" ")).not.toContain("secret-token");
		expect(config.env[BRIDGE_TOKEN_ENV]).toBe("secret-token");
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
