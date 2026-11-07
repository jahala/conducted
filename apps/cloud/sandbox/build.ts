/**
 * @feature CLOUD-04 Sandbox image with git, gh, the agent programs and our sidecar
 * Owns: filling `apps/cloud/sandbox/build/` with the two programs the Dockerfile copies: the
 * baseline Linux sidecar and the container's entry point, and the three shell scripts the sidecar
 * calls. The Dockerfile's context is this folder, so it never sees the rest of the repository.
 * Behaviour: cloud-and-remote.md Part 1 and the CLOUD-02 spike's `scripts/build.sh`, which staged
 * the same pieces beside its Dockerfile. The sidecar build itself lives in the sidecar package
 * (`packages/sidecar/src/cloud-build.ts`); this file only chooses the target and the output.
 * Must handle: a failed sidecar build (stop with its code, never write a half image); a missing
 * script (the copy fails, and the Dockerfile would fail later).
 * Our design choice: the entry is compiled with the same baseline target as the sidecar. Both are
 * Bun programs; nothing in the image runs a JavaScript file from a path that could drift.
 * Test first: `entryCompileArguments` targets `bun-linux-x64-baseline` and writes `build/entry`.
 */
import { cpSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { CLOUD_BUILD_DEFAULT_OUT } from "../../../packages/sidecar/src/cloud-build.ts";
import {
	buildSidecar,
	CLOUD_SIDECAR_TARGET,
	COMPILE_FLAGS,
} from "../../../packages/sidecar/src/packaging.ts";

/** The scripts the sidecar calls by an absolute path in its bin folder. */
export const IMAGE_SCRIPTS = ["checkpointer.sh", "git-busy-check.sh", "spotlighter.sh"] as const;

/** Where each input and output sits, relative to the repository root. */
export interface ImageInputPaths {
	buildDir: string;
	sidecar: string;
	entry: string;
	binSource: string;
	binOut: string;
	scripts: readonly string[];
}

export function imageInputPaths(repoRoot: string): ImageInputPaths {
	const buildDir = join(repoRoot, "apps/cloud/sandbox/build");
	return {
		buildDir,
		sidecar: CLOUD_BUILD_DEFAULT_OUT,
		entry: join(buildDir, "entry"),
		binSource: join(repoRoot, "bin"),
		binOut: join(buildDir, "bin"),
		scripts: IMAGE_SCRIPTS,
	};
}

/** The `bun build --compile` command line for the container's entry point. */
export function entryCompileArguments(entryPath: string, outFile: string): readonly string[] {
	return [
		"bun",
		"build",
		entryPath,
		...COMPILE_FLAGS,
		"--target",
		CLOUD_SIDECAR_TARGET.bunTarget,
		"--outfile",
		outFile,
	];
}

if (import.meta.main) {
	const repoRoot = join(import.meta.dir, "../../..");
	const paths = imageInputPaths(repoRoot);
	mkdirSync(paths.binOut, { recursive: true });
	const sidecarCode = buildSidecar(CLOUD_SIDECAR_TARGET, paths.sidecar, (argv) => {
		const child = Bun.spawnSync([...argv], {
			cwd: join(repoRoot, "packages/sidecar"),
			stdin: "inherit",
			stdout: "inherit",
			stderr: "inherit",
		});
		return child.exitCode ?? 1;
	});
	if (sidecarCode !== 0) process.exit(sidecarCode);

	const entryCode =
		Bun.spawnSync([...entryCompileArguments(join(import.meta.dir, "entry.ts"), paths.entry)], {
			stdin: "inherit",
			stdout: "inherit",
			stderr: "inherit",
		}).exitCode ?? 1;
	if (entryCode !== 0) process.exit(entryCode);

	for (const script of paths.scripts) {
		cpSync(join(paths.binSource, script), join(paths.binOut, script));
	}
	console.log(`Sandbox image inputs are in ${paths.buildDir}`);
}
