import { describe, expect, test } from "bun:test";
import type { SessionId } from "@conducted/shared";
import { BRIDGE_TOKEN_ENV } from "../tools/mcp-launch.ts";
import type { McpStdioDeps } from "../tools/mcp-stdio-server.ts";
import { runAppToolsMcpMode } from "./app-tools-mcp-mode.ts";

describe("SIDE-13 app-tools-mcp mode", () => {
	test("SIDE-13 with no arguments the mode returns 64 and writes the reason to stderr", async () => {
		let error = "";
		let ran = false;
		const code = await runAppToolsMcpMode({}, [], {
			writeError: (text) => {
				error += text;
			},
			runServer: async () => {
				ran = true;
				return 0;
			},
		});
		expect(code).toBe(64);
		expect(error).toBe("Missing --session-id\n");
		expect(ran).toBe(false);
	});

	test("SIDE-13 a missing token returns 64 without starting the server", async () => {
		let error = "";
		let ran = false;
		const code = await runAppToolsMcpMode(
			{},
			["--session-id", "s1", "--socket", "/tmp/s", "--workspace-dir", "/tmp/w"],
			{
				writeError: (text) => {
					error += text;
				},
				runServer: async () => {
					ran = true;
					return 0;
				},
			},
		);
		expect(code).toBe(64);
		expect(error).toBe(`${BRIDGE_TOKEN_ENV} is missing.\n`);
		expect(ran).toBe(false);
	});

	test("SIDE-13 the mode passes the parsed arguments and token to the stdio server", async () => {
		let received: McpStdioDeps | undefined;
		const code = await runAppToolsMcpMode(
			{ [BRIDGE_TOKEN_ENV]: "secret" },
			[
				"--session-id",
				"s1",
				"--socket",
				"/tmp/s",
				"--workspace-dir",
				"/tmp/w",
				"--enable-diff-comments",
			],
			{
				writeError: () => {},
				runServer: async (deps) => {
					received = deps;
					return 0;
				},
			},
		);
		expect(code).toBe(0);
		expect(received?.args).toEqual({
			sessionId: "s1" as SessionId,
			socketPath: "/tmp/s",
			workspaceDir: "/tmp/w",
			appTools: { diffComments: true, progressUpdates: false, setTargetBranch: false },
		});
		expect(received?.token).toBe("secret");
	});
});
