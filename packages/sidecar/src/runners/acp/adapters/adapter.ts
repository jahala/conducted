/**
 * @feature AGENT-12 ACP adapters for OpenCode and Pi: the adapter descriptor
 * Owns: what differs between ACP agents. The ACP client and session code is shared; each agent
 * supplies a descriptor.
 * Behaviour: research/conductor/other-runners.md sections 2.2 and 6: Conductor's adapter table has
 * a command, a minimum version, tool name hints, a wait for the model catalog, a permission policy
 * passed through the environment, and other hooks. We keep the hooks we need for OpenCode and Pi
 * and add others when an agent needs one.
 * Must handle: an adapter without a minimum version (any version runs), tool name hints that
 * override the ACP tool kind (Pi's `find` is a glob), an adapter whose model list arrives late
 * (waitForModelCatalogMs), and agent-specific environment for the approval policy.
 * Test first: see adapters.test.ts.
 */

import type { CanonicalTool } from "@conducted/protocol";
import type { AcpAgent } from "@conducted/shared";

export interface AcpAdapter {
	id: AcpAgent;
	displayName: string;
	/** The program to start, looked up on the login-shell PATH, and its arguments. */
	command: { executable: string; args: readonly string[] };
	/** Arguments that make the program print its version. */
	versionArgs: readonly string[];
	/** The lowest version we run against. Older versions are reported as "update needed". */
	minimumVersion?: string;
	/** Native tool names that need a canonical tool the ACP tool kind does not give. */
	toolNameHints: Readonly<Record<string, CanonicalTool>>;
	/** How long to wait after session/new for the model option to appear, in ms. 0: do not wait. */
	waitForModelCatalogMs: number;
	/** Extra environment that makes the agent ask or not ask for permission. */
	permissionEnv(requireToolApproval: boolean): Record<string, string>;
}
