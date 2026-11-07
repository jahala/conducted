/**
 * Guard: the sidecar's file, process, socket and environment edges are the ones
 * docs/architecture.md names. `packages/sidecar/src/adapters` holds the ports the composition root
 * wires; the modules that touch the outside world directly are the implementations of those ports
 * or the one edge for an external program, and each is listed there. This guard fails on a new
 * module that reaches the file system, a socket or a process without joining that list.
 */
import { join } from "node:path";
import { type Problem, read, rel, walk } from "./lib.ts";

/** Modules outside `adapters/` that are themselves an I/O edge, and why. */
export const ALLOWED_EDGE_MODULES = new Map<string, string>([
	["packages/sidecar/src/outbox/node-storage.ts", "the node:fs implementation of OutboxStorage"],
	[
		"packages/sidecar/src/models/completions-cache.ts",
		"createNodeCompletionsFiles, the cache's file edge",
	],
	["packages/sidecar/src/prompt/pull-request-stub.ts", "the pull-request stub writer port"],
	["packages/sidecar/src/rpc/server.ts", "the Unix socket listener itself"],
	["packages/sidecar/src/tools/socket-bridge.ts", "the app-tools bridge's private Unix socket"],
	[
		"packages/sidecar/src/tools/mcp-stdio-server.ts",
		"the helper process that connects to that socket",
	],
	[
		"packages/sidecar/src/process/spawn-child.ts",
		"the one spawn helper for long-lived agent children",
	],
	[
		"packages/sidecar/src/checkpoints/run-checkpointer.ts",
		"the checkpointer's detached process group",
	],
	["packages/sidecar/src/runners/managed-programs.ts", "reads the program manager's links"],
	["packages/sidecar/src/runners/claude/transcript.ts", "reads Claude's own transcript files"],
	["packages/sidecar/src/runners/claude/claude-session.ts", "checks the bundled skill plugin file"],
	[
		"packages/sidecar/src/runners/acp/acp-client.ts",
		"answers an ACP agent's file reads and writes",
	],
	["packages/sidecar/src/runners/cursor/cursor-runner.ts", "reads the Cursor SDK launch script"],
	["packages/sidecar/src/util/read-text.ts", "the read-a-text-file helper"],
	["packages/sidecar/src/main.ts", "the entry point reads the launcher environment once"],
	["packages/sidecar/src/packaging.ts", "build-time packaging, not the sidecar process"],
	[
		"packages/sidecar/src/cloud-build.ts",
		"build-time packaging for the cloud image, not the sidecar process",
	],
]);

const EDGE_IMPORT =
	/from\s+"node:(?:fs|fs\/promises|net|child_process|os|http|https|dns|tls|worker_threads)"/;
const EDGE_CALL =
	/\bBun\.(?:spawn|spawnSync|file|serve|write|connect|listen)\s*\(|\bprocess\.env\b/;

/** The source without comments, so a header that describes the rule is not read as breaking it. */
export function codeOnly(text: string): string {
	return text
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.split("\n")
		.filter((line) => !/^\s*\/\//.test(line))
		.join("\n");
}

export function checkSidecarEdges(root: string): Problem[] {
	const problems: Problem[] = [];
	const src = join(root, "packages/sidecar/src");
	for (const path of walk(root, src, /\.ts$/)) {
		const file = rel(root, path);
		if (/\.test\.ts$/.test(file) || file.startsWith("packages/sidecar/src/test-support/")) continue;
		if (file.startsWith("packages/sidecar/src/adapters/")) continue;
		if (ALLOWED_EDGE_MODULES.has(file)) continue;
		const code = codeOnly(read(path));
		if (EDGE_IMPORT.test(code) || EDGE_CALL.test(code)) {
			problems.push({
				guard: "sidecar-edges",
				message: `${file} touches the outside world; move it behind an adapter or name it in docs/architecture.md`,
			});
		}
	}
	return problems;
}
