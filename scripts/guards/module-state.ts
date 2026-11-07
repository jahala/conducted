/**
 * Guard: module-level mutable state only where docs/architecture.md allows it.
 * Product state lives in a service's store built by `core/container.ts`. A module-level zustand
 * store is allowed only for the one web view's own UI state, and a Rust `static` only for a
 * process-lifetime cache, a lock or a temp-name counter. This guard reads the allowed entries from
 * the architecture table, so the doc is the only home of the list, and fails on a new one.
 */
import { join } from "node:path";
import { type Problem, read, rel, walk } from "./lib.ts";

export const ARCHITECTURE = "docs/architecture.md";
const STATE_HEADING = "### Module-level state";

/** One allowed module-level singleton: its kind, the file, and the name it declares. */
export interface ModuleStateEntry {
	kind: "zustand" | "command-registry" | "rust-static";
	file: string;
	name: string;
}

const KIND_BY_CELL: Record<string, ModuleStateEntry["kind"]> = {
	"zustand store": "zustand",
	"command registry": "command-registry",
	"Rust static": "rust-static",
};

/** The entries of the Module-level state table, or null when the doc has no such table. */
export function moduleStateFromDoc(doc: string): ModuleStateEntry[] | null {
	const start = doc.indexOf(STATE_HEADING);
	if (start === -1) return null;
	const rest = doc.slice(start + STATE_HEADING.length);
	const end = rest.search(/\n#{2,3} /);
	const section = end === -1 ? rest : rest.slice(0, end);
	const entries: ModuleStateEntry[] = [];
	for (const line of section.split("\n")) {
		const match = /^\|\s*([^|]+?)\s*\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/.exec(line);
		const kind = KIND_BY_CELL[match?.[1]?.trim() ?? ""];
		if (!match?.[2] || !match[3] || kind === undefined) continue;
		entries.push({ kind, file: match[2], name: match[3] });
	}
	return entries.length === 0 ? null : entries;
}

const ZUSTAND_STORE = /^(?:export\s+)?const\s+\w+\s*=\s*create[<(]/;
const COMMAND_REGISTRY = /^(?:export\s+)?const\s+\w+\s*=\s*createCommandRegistry\(\)/;
const RUST_CACHE_OR_LOCK =
	/^static\s+(\w+)\s*:\s*(?:Mutex|RwLock|OnceLock|OnceCell|Lazy|LazyLock)</;

export function checkModuleState(root: string): Problem[] {
	const problems: Problem[] = [];
	const entries = moduleStateFromDoc(read(join(root, ARCHITECTURE)));
	if (entries === null) {
		return [
			{
				guard: "module-state",
				message: `${ARCHITECTURE} has no "Module-level state" table to read the allowed singletons from`,
			},
		];
	}
	const zustandFiles = new Set(entries.filter((e) => e.kind === "zustand").map((e) => e.file));
	const registryFiles = new Set(
		entries.filter((e) => e.kind === "command-registry").map((e) => e.file),
	);
	const rustStatics = new Set(
		entries.filter((e) => e.kind === "rust-static").map((e) => `${e.file}:${e.name}`),
	);
	for (const path of walk(root, join(root, "apps/desktop/src"), /\.(ts|tsx)$/)) {
		const file = rel(root, path);
		if (/\.test\.tsx?$/.test(file) || file.endsWith(".d.ts")) continue;
		for (const line of read(path).split("\n")) {
			if (ZUSTAND_STORE.test(line) && !zustandFiles.has(file)) {
				problems.push({
					guard: "module-state",
					message: `${file} creates a module-level zustand store; put product state in a service store or name this store in ${ARCHITECTURE}`,
				});
				break;
			}
			if (COMMAND_REGISTRY.test(line) && !registryFiles.has(file)) {
				problems.push({
					guard: "module-state",
					message: `${file} creates a module-level command registry; create it in the container`,
				});
				break;
			}
		}
	}
	for (const path of walk(root, join(root, "apps/desktop/src-tauri/src"), /\.rs$/)) {
		const file = rel(root, path);
		const text = read(path);
		const testAt = text.indexOf("#[cfg(test)]");
		const production = testAt === -1 ? text : text.slice(0, testAt);
		for (const line of production.split("\n")) {
			const match = RUST_CACHE_OR_LOCK.exec(line);
			if (match === null) continue;
			if (!rustStatics.has(`${file}:${match[1]}`)) {
				problems.push({
					guard: "module-state",
					message: `${file} has a module-level static ${match[1]}; put it in Tauri-managed state or name it in ${ARCHITECTURE}`,
				});
			}
		}
	}
	return problems;
}
