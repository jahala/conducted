/**
 * @feature AGENT-12 ACP adapters for OpenCode and Pi: Pi
 * Owns: the Pi descriptor.
 * Behaviour: research/conductor/other-runners.md sections 2.2 and 3: the command is `pi-acp`,
 * a separate adapter program that speaks ACP for Pi; Pi's `find` tool is a file-name search and
 * maps to the glob tool.
 * Must handle: `pi-acp` missing from PATH (the detector reports not installed; Conductor
 * downloads it, we do not, see decision 7 in docs/plans/scaffold.md), and no minimum version known
 * from the research (any version runs until a real one is found).
 * Test first: id and command are as stated and toolNameHints maps find to glob.
 */
import { ok } from "@conducted/shared";
import type { AcpAdapter } from "./adapter.ts";

export const piAdapter: AcpAdapter = {
	id: "pi",
	displayName: "Pi",
	command: { executable: "pi-acp", args: [] },
	versionArgs: ["--version"],
	toolNameHints: { find: "glob" },
	waitForModelCatalogMs: 0,
	permissionEnv(_requireToolApproval: boolean) {
		return ok({});
	},
};
