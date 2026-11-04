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
import { notImplemented, type Result } from "@conducted/shared";

/** The flag that prints the version. Checked in `main.ts` before the mode is read. */
export const VERSION_FLAG = "--version";
/** The name of the compiled program, also the stem of the file Tauri bundles. */
export const SIDECAR_PROGRAM_NAME = "conducted-sidecar";

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

/** The text printed for `--version`, without the line break. */
export function versionLine(_version: string): Result<string> {
	return notImplemented("SIDE-23");
}

/** The file name Tauri expects for the sidecar of one CPU. */
export function externalBinName(_target: SidecarTarget): string {
	return notImplemented("SIDE-23");
}

/** The `bun build --compile` command line for one CPU, with the output folder given. */
export function compileArguments(_target: SidecarTarget, _outDir: string): readonly string[] {
	return notImplemented("SIDE-23");
}

/** Prints the version on stdout and returns the exit code. The caller exits with it. */
export function printVersion(_writeOut: (text: string) => void): number {
	return notImplemented("SIDE-23");
}
