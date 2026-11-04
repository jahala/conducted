/**
 * @feature PLAT-25 Release bundle: privacy strings, entitlements, signing, notarisation
 * Owns: what a release build must contain, and the steps after `tauri build` that sign and
 * notarise it and prove the result: privacy strings in `Info.plist`, the entitlements file, the
 * hardened runtime, the sidecar signed on its own, and Apple's notarisation.
 * Behaviour: research/conductor/native-and-sidecar-map.md A1 (entitlements `allow-jit`,
 * `allow-unsigned-executable-memory` and `audio-input`; privacy strings for the microphone and for
 * the Desktop, Documents and Downloads folders; one arm64 binary with no Frameworks folder; signed
 * with a team identity, hardened runtime, notarised). `pnpm release` (scripts/release.ts) calls
 * these steps after the checks, in a later change.
 * Must handle: a missing signing identity or notarisation credential (an error value that names
 * the missing variable, never a build that ships unsigned); the sidecar signed before the app,
 * with the JIT entitlements, because Bun needs them and the app signature covers it; a bundle with
 * a missing privacy string or entitlement (the report lists each); credentials never printed or
 * written to a log; a notarisation that Apple rejects (the log text is kept and returned);
 * stapling the ticket so the app opens offline; and a dry run that says each step and changes
 * nothing.
 * Our design choice: every tool call goes through `RunTool`, so tests give it a scripted runner
 * and never sign anything. The privacy strings and entitlements live in files next to
 * `tauri.conf.json` (`Info.plist`, `Entitlements.plist`), added when this is built, and
 * `bundle.macOS` in `tauri.conf.json` points at them.
 * Test first: `verifyBundle` on a bundle whose `Info.plist` lacks the microphone string returns a
 * report that names `NSMicrophoneUsageDescription`.
 */
import { notImplemented, type Result } from "@conducted/shared";

/** Entitlement keys the signed app and the sidecar must hold. */
export const REQUIRED_ENTITLEMENTS = [
	"com.apple.security.cs.allow-jit",
	"com.apple.security.cs.allow-unsigned-executable-memory",
	"com.apple.security.device.audio-input",
] as const;

/** `Info.plist` keys that carry the privacy strings. */
export const REQUIRED_PRIVACY_KEYS = [
	"NSMicrophoneUsageDescription",
	"NSDesktopFolderUsageDescription",
	"NSDocumentsFolderUsageDescription",
	"NSDownloadsFolderUsageDescription",
] as const;

/** Runs a command line tool such as `codesign` or `xcrun`. Never a shell string. */
export type RunTool = (
	program: string,
	args: readonly string[],
) => Promise<Result<{ stdout: string; stderr: string; exitCode: number }>>;

export interface BundleReport {
	missingEntitlements: string[];
	missingPrivacyKeys: string[];
	signed: boolean;
	hardenedRuntime: boolean;
	notarised: boolean;
}

/** Signs the sidecar program, then the app, with the hardened runtime. */
export function signBundle(
	_run: RunTool,
	_appPath: string,
	_env: Readonly<Record<string, string | undefined>>,
): Promise<Result<void>> {
	return notImplemented("PLAT-25");
}

/** Submits the signed app for notarisation, waits for the verdict and staples the ticket. */
export function notariseBundle(
	_run: RunTool,
	_appPath: string,
	_env: Readonly<Record<string, string | undefined>>,
): Promise<Result<void>> {
	return notImplemented("PLAT-25");
}

/** Reads a built `.app` and reports what it holds and what is missing. */
export function verifyBundle(_run: RunTool, _appPath: string): Promise<Result<BundleReport>> {
	return notImplemented("PLAT-25");
}
