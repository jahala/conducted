/**
 * @feature CLOUD-04 Sandbox image with git, gh, the agent programs and our sidecar
 * Owns: the command line that builds the sidecar for one target, defaulting to the baseline Linux
 * program the sandbox image runs, and the default output path inside the image's folder.
 * Behaviour: cloud-and-remote.md Part 1 ("The sidecar runs inside the sandbox unchanged") and the
 * spike's note that the real change is a linux-x64 row in `SIDECAR_TARGETS`
 * (cloud-spike-2026-11-06.md "What was built").
 * Must handle: an unknown target (an error value that names it); a missing value after `--target`
 * or `--out` (an error value); an output folder that does not exist (created before the build).
 * Our design choice: the target is a parameter, so the Mac bundle and the image use the same
 * builder and the same sources; only the output file and the Bun target differ.
 * Test first: `parseCloudBuildArgs([])` is the Linux target and
 * `apps/cloud/sandbox/build/conducted-sidecar`.
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { appError, err, ok, type Result } from "@conducted/shared";
import { EXIT_USAGE } from "./exit-codes.ts";
import {
	buildSidecar,
	CLOUD_SIDECAR_TARGET,
	type SidecarTarget,
	targetForId,
} from "./packaging.ts";

/** Where the image build script expects the Linux program. */
export const CLOUD_BUILD_DEFAULT_OUT = join(
	import.meta.dir,
	"../../../apps/cloud/sandbox/build/conducted-sidecar",
);

export interface CloudBuildArgs {
	target: SidecarTarget;
	/** The exact file to write. */
	outFile: string;
}

/** Reads `--target <id>` and `--out <file>`; both are optional. */
export function parseCloudBuildArgs(argv: readonly string[]): Result<CloudBuildArgs> {
	let targetId: string = CLOUD_SIDECAR_TARGET.id;
	let outFile = CLOUD_BUILD_DEFAULT_OUT;
	for (let index = 0; index < argv.length; index++) {
		const argument = argv[index];
		if (argument === "--target") {
			const value = argv[++index];
			if (value === undefined || value === "") {
				return err(appError("cloud_build_value_missing", "--target needs a value."));
			}
			targetId = value;
			continue;
		}
		if (argument === "--out") {
			const value = argv[++index];
			if (value === undefined || value === "") {
				return err(appError("cloud_build_value_missing", "--out needs a value."));
			}
			outFile = value;
			continue;
		}
		return err(appError("cloud_build_argument_unknown", `Unknown argument ${argument ?? ""}.`));
	}
	const target = targetForId(targetId);
	if (!target.ok) return target;
	return ok({ target: target.value, outFile });
}

if (import.meta.main) {
	const parsed = parseCloudBuildArgs(process.argv.slice(2));
	if (!parsed.ok) {
		process.stderr.write(`${parsed.error.message}\n`);
		process.exit(EXIT_USAGE);
	}
	mkdirSync(dirname(parsed.value.outFile), { recursive: true });
	process.exit(
		buildSidecar(parsed.value.target, parsed.value.outFile, (argv) => {
			const child = Bun.spawnSync([...argv], {
				cwd: join(import.meta.dir, ".."),
				stdin: "inherit",
				stdout: "inherit",
				stderr: "inherit",
			});
			return child.exitCode ?? 1;
		}),
	);
}
