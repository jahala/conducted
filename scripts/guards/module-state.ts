/**
 * Guard: module-level mutable state only where docs/architecture.md allows it.
 * Product state lives in a service's store built by `core/container.ts`. A module-level zustand
 * store is allowed only for the one web view's own UI state, and a Rust `static` only for a
 * process-lifetime cache, a lock or a temp-name counter. This guard fails on a new one, so the
 * list in the doc and the code cannot drift apart.
 */
import { join } from "node:path";
import { type Problem, read, rel, walk } from "./lib.ts";

/** The zustand stores a module may create. Each holds only the web view's own UI state. */
export const ALLOWED_ZUSTAND_STORES = new Set([
	"apps/desktop/src/ui/Toast.tsx",
	"apps/desktop/src/app/overlay-store.ts",
	"apps/desktop/src/features/composer/snippet-dialogs-store.ts",
]);

/** The one module that may keep a command registry fallback until APP-16 moves it. */
export const ALLOWED_REGISTRIES = new Set(["apps/desktop/src/app/command-dispatcher.ts"]);

/** The Rust statics that are a cache or a lock, named with their file. */
export const ALLOWED_RUST_STATICS = new Set([
	"apps/desktop/src-tauri/src/terminal_history.rs:CACHED_KEY",
	"apps/desktop/src-tauri/src/terminal_history.rs:KEY_LOCK",
	"apps/desktop/src-tauri/src/binaries.rs:PATH_OVERRIDES_SYNC",
]);

const ZUSTAND_STORE = /^(?:export\s+)?const\s+\w+\s*=\s*create[<(]/;
const COMMAND_REGISTRY = /^(?:export\s+)?const\s+\w+\s*=\s*createCommandRegistry\(\)/;
const RUST_CACHE_OR_LOCK =
	/^static\s+(\w+)\s*:\s*(?:Mutex|RwLock|OnceLock|OnceCell|Lazy|LazyLock)</;

export function checkModuleState(root: string): Problem[] {
	const problems: Problem[] = [];
	for (const path of walk(root, join(root, "apps/desktop/src"), /\.(ts|tsx)$/)) {
		const file = rel(root, path);
		if (/\.test\.tsx?$/.test(file) || file.endsWith(".d.ts")) continue;
		for (const line of read(path).split("\n")) {
			if (ZUSTAND_STORE.test(line) && !ALLOWED_ZUSTAND_STORES.has(file)) {
				problems.push({
					guard: "module-state",
					message: `${file} creates a module-level zustand store; put product state in a service store or name this store in docs/architecture.md`,
				});
				break;
			}
			if (COMMAND_REGISTRY.test(line) && !ALLOWED_REGISTRIES.has(file)) {
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
			if (!ALLOWED_RUST_STATICS.has(`${file}:${match[1]}`)) {
				problems.push({
					guard: "module-state",
					message: `${file} has a module-level static ${match[1]}; put it in Tauri-managed state or name it in docs/architecture.md`,
				});
			}
		}
	}
	return problems;
}
