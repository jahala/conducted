/**
 * Guard: the sidecar's file, process, socket and environment edges are the ones
 * docs/architecture.md names. `packages/sidecar/src/adapters` holds the ports the composition root
 * wires; the modules that touch the outside world directly are the implementations of those ports
 * or the one edge for an external program, and each is listed in the architecture table. This guard
 * reads that table, so the doc is the only home of the list, and fails on a new module that reaches
 * the file system, a socket or a process without joining it.
 */
import { join } from "node:path";
import { type Problem, read, rel, walk } from "./lib.ts";

export const ARCHITECTURE = "docs/architecture.md";
const EDGES_HEADING = "### Sidecar I/O edges";

/**
 * The modules the Sidecar I/O edges table allows, or null when the doc has no such table. The
 * table's first column is the module, in backticks; the rest explains why it is the edge.
 */
export function edgeModulesFromDoc(doc: string): Set<string> | null {
	const start = doc.indexOf(EDGES_HEADING);
	if (start === -1) return null;
	const rest = doc.slice(start + EDGES_HEADING.length);
	const end = rest.search(/\n#{2,3} /);
	const section = end === -1 ? rest : rest.slice(0, end);
	const modules = new Set<string>();
	for (const line of section.split("\n")) {
		const match = /^\|\s*`([^`]+)`\s*\|/.exec(line);
		if (match?.[1]) modules.add(match[1]);
	}
	return modules.size === 0 ? null : modules;
}

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
	const allowed = edgeModulesFromDoc(read(join(root, ARCHITECTURE)));
	if (allowed === null) {
		return [
			{
				guard: "sidecar-edges",
				message: `${ARCHITECTURE} has no "Sidecar I/O edges" table to read the allowed modules from`,
			},
		];
	}
	const src = join(root, "packages/sidecar/src");
	for (const path of walk(root, src, /\.ts$/)) {
		const file = rel(root, path);
		if (/\.test\.ts$/.test(file) || file.startsWith("packages/sidecar/src/test-support/")) continue;
		if (file.startsWith("packages/sidecar/src/adapters/")) continue;
		if (allowed.has(file)) continue;
		const code = codeOnly(read(path));
		if (EDGE_IMPORT.test(code) || EDGE_CALL.test(code)) {
			problems.push({
				guard: "sidecar-edges",
				message: `${file} touches the outside world; move it behind an adapter or name it in ${ARCHITECTURE}`,
			});
		}
	}
	return problems;
}
