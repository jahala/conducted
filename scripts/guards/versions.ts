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
	// The sandbox image names the app's version in its logs (CLOUD-04), in two copies.
	"apps/cloud/sandbox/image.ts",
	"apps/cloud/sandbox/Dockerfile",
] as const;

/** Where each non-JSON version file holds the version, as a pattern with the version in group 2. */
const VERSION_PATTERNS: Record<string, RegExp> = {
	"apps/desktop/src-tauri/Cargo.toml": /^(version\s*=\s*")([^"]+)(")/m,
	"apps/desktop/src-tauri/Cargo.lock":
		/(\[\[package\]\]\nname = "conducted"\nversion = ")([^"]+)(")/,
	"apps/cloud/sandbox/image.ts": /(appVersion: ")([^"]+)(")/,
	"apps/cloud/sandbox/Dockerfile": /^(ENV CONDUCTED_APP_VERSION=)(\S+)()/m,
};

/** `text` of `file` with its version set to `version`; JSON files are written by their parser. */
export function setVersion(file: string, text: string, version: string): string {
	const pattern = VERSION_PATTERNS[file];
	if (pattern === undefined) throw new Error(`${file} has no version pattern`);
	return text.replace(pattern, (_match, before: string, _old: string, after: string) => {
		return `${before}${version}${after}`;
	});
}

export function readVersion(root: string, file: string): string | null {
	const path = join(root, file);
	if (!existsSync(path)) return null;
	const text = read(path);
	if (file.endsWith(".json")) return (JSON.parse(text) as { version?: string }).version ?? null;
	const pattern = VERSION_PATTERNS[file];
	return pattern === undefined ? null : (pattern.exec(text)?.[2] ?? null);
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
