/**
 * @feature AGENT-12 ACP adapters for OpenCode and Pi: the adapter table
 * Owns: the table of known ACP adapters, keyed by the ids in packages/shared (ACP_AGENTS).
 * Behaviour: research/conductor/other-runners.md section 2.2 ("a registry of adapters").
 * Must handle: every id in ACP_AGENTS has an adapter (the type enforces it).
 * Test first: ACP_ADAPTERS has one entry per id in ACP_AGENTS.
 */
import type { AcpAgent } from "@conducted/shared";
import type { AcpAdapter } from "./adapter.ts";
import { opencodeAdapter } from "./opencode.ts";
import { piAdapter } from "./pi.ts";

export const ACP_ADAPTERS: Readonly<Record<AcpAgent, AcpAdapter>> = {
	opencode: opencodeAdapter,
	pi: piAdapter,
};
