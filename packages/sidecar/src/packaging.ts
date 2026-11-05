/**
 * @feature SIDE-23 Sidecar packaging: version flag, one program per CPU
 * Owns: the version line the sidecar prints for `--version`, and the table of CPUs the sidecar is
 * compiled for, with the names Bun and Tauri use for each.
 * Behaviour: research/conductor/native-and-sidecar-map.md B1 (`--version` prints the program name
 * and version) and C (one compiled Bun executable runs every mode), overview.md 3. The Rust
 * launcher (PLAT-09) calls `--version` to check that the bundled sidecar matches the app.
 * Must handle: `--version` anywhere else than the first argument (not a flag, so the usage message
 * applies); a version that is empty (an error value, no guess); an unknown CPU (an error value that
 * names the CPU); the Tauri file name, which is the program name plus the Rust target triple.
 * Our design choice: one compiled program per CPU, named for Tauri's `externalBin` rule
 * (`conducted-sidecar-<triple>`). The release build (PLAT-25) builds both and the bundle step
 * (`tauri.conf.json` `bundle.externalBin`) is added once these files exist, because Tauri refuses
 * to build when a listed file is missing.
 * Test first: `versionLine("0.1.0")` is `conducted-sidecar 0.1.0`, and `externalBinName` for the
 * arm64 target is `conducted-sidecar-aarch64-apple-darwin`.
 */
import { join } from "node:path";
import { appError, err, ok, type Result } from "@conducted/shared";
import packageJson from "../../../package.json" with { type: "json" };

/** The flag that prints the version. Checked in `main.ts` before the mode is read. */
export const VERSION_FLAG = "--version";
/** The name of the compiled program, also the stem of the file Tauri bundles. */
export const SIDECAR_PROGRAM_NAME = "conducted-sidecar";
/** The version compiled into this program. It is the app version: every version file agrees. */
export const SIDECAR_VERSION: string = packageJson.version;

export interface SidecarTarget {
	arch: "arm64" | "x86_64";
	/** The value for `bun build --compile --target`. */
	bunTarget: "bun-darwin-arm64" | "bun-darwin-x64";
	/** The Rust target triple Tauri puts after the program name. */
	rustTriple: "aarch64-apple-darwin" | "x86_64-apple-darwin";
}

export const SIDECAR_TARGETS: readonly SidecarTarget[] = [
	{ arch: "arm64", bunTarget: "bun-darwin-arm64", rustTriple: "aarch64-apple-darwin" },
	{ arch: "x86_64", bunTarget: "bun-darwin-x64", rustTriple: "x86_64-apple-darwin" },
];

/** The target for one CPU name, or an error value that names the CPU. */
export function targetForArch(arch: string): Result<SidecarTarget> {
	const target = SIDECAR_TARGETS.find((candidate) => candidate.arch === arch);
	if (target === undefined) {
		return err(appError("sidecar_unknown_cpu", `No sidecar build for CPU ${arch}.`));
	}
	return ok(target);
}

/** The text printed for `--version`, without the line break. */
export function versionLine(version: string): Result<string> {
	const trimmed = version.trim();
	if (trimmed === "") {
		return err(appError("sidecar_version_empty", "The sidecar version is empty."));
	}
	return ok(`${SIDECAR_PROGRAM_NAME} ${trimmed}`);
}

/** The file name Tauri expects for the sidecar of one CPU. */
export function externalBinName(target: SidecarTarget): string {
	return `${SIDECAR_PROGRAM_NAME}-${target.rustTriple}`;
}

/** The `bun build --compile` command line for one CPU, with the output folder given. */
export function compileArguments(target: SidecarTarget, outDir: string): readonly string[] {
	return [
		"bun",
		"build",
		"src/main.ts",
		"--compile",
		"--target",
		target.bunTarget,
		"--outfile",
		join(outDir, externalBinName(target)),
	];
}

/** Prints the version on stdout and returns the exit code. The caller exits with it. */
export function printVersion(writeOut: (text: string) => void): number {
	const line = versionLine(SIDECAR_VERSION);
	if (!line.ok) return 1;
	writeOut(`${line.value}\n`);
	return 0;
}
