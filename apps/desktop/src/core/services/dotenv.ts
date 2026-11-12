/**
 * @feature SET-04 Environment variables, stored in the Keychain
 * Owns: resolving one of a settings layer's `environment_variable_files` paths the way Conductor
 * does. The parser that reads a dotenv file lives in core/dotenv.ts, which the settings service and
 * the environment forms share.
 * Behaviour: services-map.md 4.2.4 (path resolution: absolute, `~`, relative to the settings
 * directory, then to the repository root).
 * Must handle: a relative path that exists in neither folder (the caller reports the missing file);
 * a settings folder the file commands may not check is the Err, never "not there" (issue #601).
 * Values are secrets and are returned only to the caller.
 */
import { ok, type Result } from "@conducted/shared";

/** Collapses `.` and `..` by spelling, so a path names the same file on disk as the app writes it. */
export function normalizeFilePath(path: string): string {
	const absolute = path.startsWith("/");
	const parts: string[] = [];
	for (const part of path.split("/")) {
		if (part === "" || part === ".") continue;
		if (part === "..") {
			if (parts.length > 0 && parts[parts.length - 1] !== "..") parts.pop();
			else if (!absolute) parts.push(part);
			continue;
		}
		parts.push(part);
	}
	const joined = parts.join("/");
	if (absolute) return `/${joined}`;
	return joined === "" ? "." : joined;
}

export interface EnvFilePathInput {
	/** The path named in one settings layer's `environment_variable_files`. */
	path: string;
	/** The folder holding that layer's settings file. */
	settingsDir: string;
	/** The folder the layer covers: the home folder for the user layer, else the worktree. */
	sourceRoot: string;
	home: string;
	exists(path: string): Promise<Result<boolean>>;
}

/** Absolute and `~` paths stand as given; a relative path is taken from the settings folder when
 * it exists there, and otherwise from the layer's root (services-map.md 4.2.4). */
export async function resolveEnvFilePath(input: EnvFilePathInput): Promise<Result<string>> {
	const path = input.path.trim();
	if (path.startsWith("/")) return ok(normalizeFilePath(path));
	if (path === "~") return ok(normalizeFilePath(input.home));
	if (path.startsWith("~/")) return ok(normalizeFilePath(`${input.home}/${path.slice(2)}`));
	const inSettings = normalizeFilePath(`${input.settingsDir}/${path}`);
	const found = await input.exists(inSettings);
	if (!found.ok) return found;
	if (found.value) return ok(inSettings);
	return ok(normalizeFilePath(`${input.sourceRoot}/${path}`));
}
