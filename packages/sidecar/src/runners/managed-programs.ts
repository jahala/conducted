/**
 * @feature PLAT-28 Agent program manager: the sidecar finds the managed copies
 * @feature PLAT-35 Install and update gh and watchexec (D024)
 * Owns: the sidecar's view of the programs the app downloads: finding the managed copy of a
 * program, and putting the app's bin folder first on the PATH agents start with.
 * Behaviour: native-and-sidecar-map.md A6 steps 6 and 11 (Rust passes the agent binaries folder;
 * the app's bin folder is on PATH so `claude`, `codex` and `gh` resolve) and A9 (the bin folder
 * holds links into `agent-binaries/<program>/<version>/`); D021 and D024 in docs/decisions.md.
 * Must handle: no link in the bin folder (no managed copy); a link that points outside the agent
 * binaries folder, such as a copy of a bundled file (not a managed copy); a link whose target is
 * gone or cannot run (no managed copy); a target whose path is not `<program>/<version>/<program>`
 * (not a managed copy); a captured environment with no PATH (the bin folder alone).
 * Our design choice: the Rust program manager points `bin/<program>` at a version only after that
 * version's checksum matched, so the link is the one record of which copy is ready. The sidecar
 * reads the link instead of repeating the manager's checks.
 * Our design choice: the bin folder comes first on the agents' PATH, so `gh` in an agent's
 * terminal is the managed copy, as D024 asks.
 * Test first: a `claude` link in the bin folder that points into the agent binaries folder is
 * found with the version of its folder.
 */
import { constants as fsConstants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { ok } from "@conducted/shared";
import type { CapturedShellEnv, ShellEnvProvider } from "../shell-env/capture.ts";

/** The managed copy of a program and the version the program manager installed. */
export interface ManagedProgram {
	path: string;
	version: string;
}

/** Finds the managed copy of the program named `name`. Null when there is none ready. */
export type FindManagedProgram = (name: string) => Promise<ManagedProgram | null>;

export interface ManagedProgramFiles {
	/** The real path of `target`, every link resolved. Null when it does not exist. */
	realPath(target: string): Promise<string | null>;
	/** True when `target` is a file the user may run. */
	isExecutable(target: string): Promise<boolean>;
}

/** The real file system, for the composition root. */
export const nodeManagedProgramFiles: ManagedProgramFiles = {
	realPath: async (target) => {
		try {
			return await realpath(target);
		} catch (cause) {
			if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
			throw cause;
		}
	},
	isExecutable: async (target) => {
		try {
			await access(target, fsConstants.X_OK);
		} catch (cause) {
			if ((cause as NodeJS.ErrnoException).code === "EACCES") return false;
			throw cause;
		}
		return (await stat(target)).isFile();
	},
};

export function createManagedProgramFinder(input: {
	/** The app's bin folder, where the program manager keeps one link per program. */
	binDir: string;
	/** The folder the program manager downloads into (`CONDUCTED_AGENT_BINARIES_DIR`). */
	agentBinariesDir: string;
	files: ManagedProgramFiles;
}): FindManagedProgram {
	return async (name) => {
		if (name === "" || name.includes("/")) return null;
		const target = await input.files.realPath(path.join(input.binDir, name));
		if (target === null) return null;
		const root = await input.files.realPath(input.agentBinariesDir);
		if (root === null) return null;
		const relative = path.relative(root, target);
		const parts = relative.split(path.sep);
		if (parts.length !== 3 || parts[0] !== name || parts[2] !== name) return null;
		const version = parts[1];
		if (version === undefined || version === "" || version === "..") return null;
		if (!(await input.files.isExecutable(target))) return null;
		return { path: target, version };
	};
}

/** `captured` with `binDir` first on its PATH. */
export function withBinDirFirst(captured: CapturedShellEnv, binDir: string): CapturedShellEnv {
	const first = (value: string | undefined): string =>
		value === undefined || value === "" ? binDir : `${binDir}:${value}`;
	return {
		...captured,
		path: first(captured.path),
		env: { ...captured.env, PATH: first(captured.env.PATH) },
	};
}

/** A provider whose every capture has `binDir` first on its PATH. */
export function shellEnvWithBinDirFirst(
	provider: ShellEnvProvider,
	binDir: string,
): ShellEnvProvider {
	return {
		get: async (folder) => {
			const captured = await provider.get(folder);
			return captured.ok ? ok(withBinDirFirst(captured.value, binDir)) : captured;
		},
		refresh: async (folder) => {
			const captured = await provider.refresh(folder);
			return captured.ok ? ok(withBinDirFirst(captured.value, binDir)) : captured;
		},
	};
}
