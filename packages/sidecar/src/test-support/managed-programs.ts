/**
 * @feature PLAT-28 Agent program manager: the sidecar finds the managed copies
 * Owns: the one stand-in for the programs the app's program manager installs. `layOutManagedPrograms`
 * writes a ready copy of each program the way the Rust manager leaves it (`agent-binaries/<name>/
 * <version>/<name>`, with a `bin/<name>` link), and `managedProgramFinder` answers a runner's
 * `findManagedProgram` from a map of names to paths. A test that would once have put a fake
 * `claude` or `codex` on PATH gives its runner one of these instead, because the app never runs a
 * PATH copy of a managed agent (D088).
 * Behaviour: runners/managed-programs.ts (createManagedProgramFinder reads the link and checks the
 * version folder).
 * Contract test: managed-programs.test.ts lays out the folders and reads them with the real finder.
 * Must handle: only the named programs are laid out, so a missing one stays missing; the finder
 * answers null for a name it does not hold.
 * Test first: a laid-out copy is found by the real finder with its version.
 */
import { chmod, mkdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FindManagedProgram } from "../runners/managed-programs.ts";

/** The version a laid-out copy reports. */
export const MANAGED_TEST_VERSION = "1.0.0";

/** The app's bin folder and the folder the program manager downloads into. */
export interface ManagedProgramFolders {
	binDir: string;
	agentBinariesDir: string;
}

/**
 * Lays out a ready managed copy of each program under `folder`, as the program manager does after a
 * successful download (PLAT-28). Returns the two folders the composition root takes.
 */
export async function layOutManagedPrograms(
	folder: string,
	names: readonly string[] = ["claude", "codex"],
	options: { version?: string; contents?: string } = {},
): Promise<ManagedProgramFolders> {
	const binDir = path.join(folder, "app-bin");
	const agentBinariesDir = path.join(folder, "agent-binaries");
	const version = options.version ?? MANAGED_TEST_VERSION;
	await mkdir(binDir, { recursive: true });
	for (const name of names) {
		const versionFolder = path.join(agentBinariesDir, name, version);
		await mkdir(versionFolder, { recursive: true });
		const program = path.join(versionFolder, name);
		await writeFile(program, options.contents ?? "#!/bin/sh\nexit 0\n");
		await chmod(program, 0o755);
		await symlink(program, path.join(binDir, name));
	}
	return { binDir, agentBinariesDir };
}

/**
 * A `findManagedProgram` that answers the copy at `paths[name]`, for a test that builds a runner's
 * deps directly instead of the composition root.
 */
export function managedProgramFinder(
	paths: Readonly<Record<string, string>>,
	version = MANAGED_TEST_VERSION,
): FindManagedProgram {
	return async (name) => {
		const program = paths[name];
		return program === undefined ? null : { path: program, version };
	};
}
