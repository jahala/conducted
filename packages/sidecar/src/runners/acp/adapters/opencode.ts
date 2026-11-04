/**
 * @feature AGENT-12 ACP adapters for OpenCode and Pi: OpenCode
 * Owns: the OpenCode descriptor.
 * Behaviour: research/conductor/other-runners.md section 2.2: the command is `opencode acp`; the
 * minimum version is 1.16.2; the model list can take up to 15 s to arrive after session/new;
 * the approval policy goes in through the environment variable OPENCODE_CONFIG_CONTENT with a
 * permission wildcard set to "ask" or "allow". Checked on this Mac: `opencode acp` exists in
 * opencode 1.18.18 and lists --cwd, --port and --log-level.
 * Must handle: permissionEnv must produce valid JSON for OPENCODE_CONFIG_CONTENT, must merge with
 * (not replace) a value the user already has in their environment, and must never log the value.
 * Test first: id, command and minimum version are as stated; permissionEnv returns JSON that
 * parses.
 */
import { notImplemented } from "@conducted/shared";
import type { AcpAdapter } from "./adapter.ts";

export const opencodeAdapter: AcpAdapter = {
	id: "opencode",
	displayName: "OpenCode",
	command: { executable: "opencode", args: ["acp"] },
	versionArgs: ["--version"],
	minimumVersion: "1.16.2",
	toolNameHints: {},
	waitForModelCatalogMs: 15_000,
	permissionEnv(_requireToolApproval: boolean): Record<string, string> {
		return notImplemented("AGENT-12");
	},
};
