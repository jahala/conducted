/**
 * Guard: every version file says the same version. A release bumps them all together.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { type Problem, read } from "./lib.ts";

export const VERSION_FILES = [
	"package.json",
	"apps/desktop/package.json",
	"apps/desktop/src-tauri/tauri.conf.json",
	"apps/desktop/src-tauri/Cargo.toml",
	"apps/desktop/src-tauri/Cargo.lock",
] as const;

export function readVersion(root: string, file: string): string | null {
	const path = join(root, file);
	if (!existsSync(path)) return null;
	const text = read(path);
	if (file.endsWith(".json")) return (JSON.parse(text) as { version?: string }).version ?? null;
	if (file.endsWith("Cargo.toml")) return /^version\s*=\s*"([^"]+)"/m.exec(text)?.[1] ?? null;
	// Cargo.lock: the entry for our own crate.
	return /\[\[package\]\]\nname = "conducted"\nversion = "([^"]+)"/.exec(text)?.[1] ?? null;
}

export function checkVersions(root: string): Problem[] {
	const versions = VERSION_FILES.map((file) => [file, readVersion(root, file)] as const);
	const expected = versions[0]?.[1];
	return versions
		.filter(([, version]) => version === null || version !== expected)
		.map(([file, version]) => ({
			guard: "versions",
			message: `${file} has version ${version ?? "(none)"}, expected ${expected ?? "(none)"}`,
		}));
}
