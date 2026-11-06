/**
 * @feature PLAT-25 Release bundle: privacy strings, entitlements, signing, notarisation
 * Owns: what a release build must contain, and the steps after `tauri build` that sign, notarise,
 * package and prove the result: privacy strings in `Info.plist`, the entitlements file, the
 * hardened runtime, the sidecar signed on its own, Apple's notarisation, and a disk image built
 * from the app only after it was signed and verified.
 * Behaviour: research/conductor/native-and-sidecar-map.md A1 (entitlements `allow-jit`,
 * `allow-unsigned-executable-memory` and `audio-input`; privacy strings for the microphone and for
 * the Desktop, Documents and Downloads folders; one arm64 binary with no Frameworks folder; signed
 * with a team identity, hardened runtime, notarised).
 * Must handle: a missing signing identity or notarisation credential (an error value that names
 * the missing variable, never a build that ships unsigned; an empty variable counts as missing);
 * the sidecar signed before the app, with the JIT entitlements, because Bun needs them and the app
 * signature covers it; a bundle with a missing privacy string or entitlement (the report lists
 * each); credentials never printed or written to a log (a stored keychain profile keeps the
 * password off the command line; an `APPLE_ID`/`APPLE_PASSWORD` pair is passed to `notarytool` on
 * its command line, so the profile is the preferred way); a notarisation that Apple rejects (the
 * log text is kept and returned); stapling the ticket so the app opens offline; a disk image or
 * archive built before signing (the release builds the app alone, then signs it, and only then
 * makes the disk image from the verified app; the update archive `tauri build` makes from the
 * unsigned app is made again from the notarised one by `scripts/release.ts`).
 * Our design choice: every tool call goes through `RunTool`, so tests give it a scripted runner
 * and never sign anything. The privacy strings and entitlements live in files next to
 * `tauri.conf.json`, and `bundle.macOS` points at them. `bundle.externalBin` lives in
 * `tauri.release.conf.json`, because Tauri refuses to build when a listed sidecar file is missing;
 * `scripts/release.ts` builds the sidecars, then builds the app alone with that release config.
 * Test first: `verifyBundle` on a bundle whose `Info.plist` lacks the microphone string returns a
 * report that names `NSMicrophoneUsageDescription`.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { appError, err, ok, type Result } from "@conducted/shared";
import releaseConfig from "../tauri.release.conf.json" with { type: "json" };

/** Entitlement keys the signed app must hold. */
export const REQUIRED_ENTITLEMENTS = [
	"com.apple.security.cs.allow-jit",
	"com.apple.security.cs.allow-unsigned-executable-memory",
	"com.apple.security.device.audio-input",
] as const;

/** Entitlement keys the sidecar must hold on its own signature. */
export const REQUIRED_SIDECAR_ENTITLEMENTS = [
	"com.apple.security.cs.allow-jit",
	"com.apple.security.cs.allow-unsigned-executable-memory",
] as const;

/** `Info.plist` keys that carry the privacy strings. */
export const REQUIRED_PRIVACY_KEYS = [
	"NSMicrophoneUsageDescription",
	"NSDesktopFolderUsageDescription",
	"NSDocumentsFolderUsageDescription",
	"NSDownloadsFolderUsageDescription",
] as const;

/** The environment variable that names the Developer ID identity. */
export const SIGNING_IDENTITY_ENV = "APPLE_SIGNING_IDENTITY";

/** The environment variable that names a notarytool keychain profile stored with `store-credentials`. */
export const NOTARY_PROFILE_ENV = "APPLE_NOTARY_PROFILE";

/** The entitlements file both signatures use. */
export const ENTITLEMENTS_PATH = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"Entitlements.plist",
);

/** Runs a command line tool such as `codesign` or `xcrun`. Never a shell string. */
export type RunTool = (
	program: string,
	args: readonly string[],
) => Promise<Result<{ stdout: string; stderr: string; exitCode: number }>>;

export interface BundleReport {
	bundleIdentifier: string | null;
	version: string | null;
	missingEntitlements: string[];
	missingPrivacyKeys: string[];
	architectures: string[];
	hasFrameworksFolder: boolean;
	signed: boolean;
	hardenedRuntime: boolean;
	sidecarSigned: boolean;
	sidecarMissingEntitlements: string[];
	notarised: boolean;
}

interface ToolOutput {
	stdout: string;
	stderr: string;
	exitCode: number;
}

/** Runs a real tool and collects its output. */
export const runTool: RunTool = (program, args) =>
	new Promise((resolve) => {
		const child = spawn(program, [...args], { stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		child.on("error", (error) => {
			resolve(
				err(
					appError(
						"release_tool_not_started",
						`Could not run ${program}: ${error.message}.`,
						error,
					),
				),
			);
		});
		child.on("close", (exitCode) => {
			resolve(ok({ stdout, stderr, exitCode: exitCode ?? 1 }));
		});
	});

/** The sidecar's file name inside the app bundle, from the release config. */
export function sidecarBinaryName(): Result<string> {
	const configured = releaseConfig.bundle.externalBin?.[0];
	if (!configured) {
		return err(
			appError(
				"release_external_bin_missing",
				"tauri.release.conf.json has no bundle.externalBin entry for the sidecar.",
			),
		);
	}
	return ok(basename(configured));
}

/** The sidecar's path inside a built app bundle. */
export function sidecarBinaryPath(appPath: string): Result<string> {
	const name = sidecarBinaryName();
	if (!name.ok) return name;
	return ok(join(appPath, "Contents", "MacOS", name.value));
}

/**
 * The `tauri build` arguments for a release. Only the app is bundled, so Tauri never makes a disk
 * image from an unsigned app. `createUpdaterArtifacts` still makes it write an update archive from
 * the unsigned app; `scripts/release.ts` makes the disk image and that archive again after signing.
 */
export function appBuildArguments(target: string, configPath: string): readonly string[] {
	return [
		"pnpm",
		"--filter",
		"@conducted/desktop",
		"tauri",
		"build",
		"--target",
		target,
		"--bundles",
		"app",
		"--config",
		configPath,
	];
}

/** The disk image path next to a built app, named for the product. */
export function diskImagePath(appPath: string): string {
	return join(dirname(appPath), `${basename(appPath, ".app")}.dmg`);
}

/**
 * Makes a compressed disk image from an app that is already signed and notarised. The image holds
 * a copy of that app and the usual Applications shortcut; Tauri is not asked to bundle again,
 * because its macos bundler rebuilds the `.app` from the binary and would drop the signature.
 */
export async function createDiskImage(
	run: RunTool,
	appPath: string,
	dmgPath: string,
): Promise<Result<void>> {
	const staging = mkdtempSync(join(tmpdir(), "conducted-dmg-"));
	try {
		const copied = await runChecked(
			run,
			"ditto",
			[appPath, join(staging, basename(appPath))],
			"release_disk_image_failed",
		);
		if (!copied.ok) return copied;
		const linked = await runChecked(
			run,
			"ln",
			["-s", "/Applications", join(staging, "Applications")],
			"release_disk_image_failed",
		);
		if (!linked.ok) return linked;
		rmSync(dmgPath, { force: true });
		const created = await runChecked(
			run,
			"hdiutil",
			[
				"create",
				"-volname",
				basename(appPath, ".app"),
				"-srcfolder",
				staging,
				"-ov",
				"-format",
				"UDZO",
				dmgPath,
			],
			"release_disk_image_failed",
		);
		if (!created.ok) return created;
		return ok(undefined);
	} finally {
		rmSync(staging, { recursive: true, force: true });
	}
}

/** Signs the sidecar program, then the app, with the hardened runtime. */
export async function signBundle(
	run: RunTool,
	appPath: string,
	env: Readonly<Record<string, string | undefined>>,
): Promise<Result<void>> {
	const identity = env[SIGNING_IDENTITY_ENV]?.trim();
	if (!identity) {
		return err(
			appError(
				"release_signing_identity_missing",
				`Set ${SIGNING_IDENTITY_ENV} to the Developer ID Application identity that signs the release.`,
			),
		);
	}
	const sidecarPath = sidecarBinaryPath(appPath);
	if (!sidecarPath.ok) return sidecarPath;

	for (const target of [sidecarPath.value, appPath]) {
		const signed = await runChecked(
			run,
			"codesign",
			[
				"--force",
				"--timestamp",
				"--options",
				"runtime",
				"--entitlements",
				ENTITLEMENTS_PATH,
				"--sign",
				identity,
				target,
			],
			"release_signing_failed",
		);
		if (!signed.ok) return signed;
		const verified = await runChecked(
			run,
			"codesign",
			["--verify", "--strict", "--verbose=2", target],
			"release_signing_failed",
		);
		if (!verified.ok) return verified;
	}
	return ok(undefined);
}

/** Submits the signed app for notarisation, waits for the verdict and staples the ticket. */
export async function notariseBundle(
	run: RunTool,
	appPath: string,
	env: Readonly<Record<string, string | undefined>>,
): Promise<Result<void>> {
	const credentials = notaryCredentials(env);
	if (!credentials.ok) return credentials;

	const zipPath = `${appPath}.zip`;
	rmSync(zipPath, { force: true });
	const packed = await runChecked(
		run,
		"ditto",
		["-c", "-k", "--keepParent", appPath, zipPath],
		"release_notarisation_failed",
	);
	if (!packed.ok) return packed;

	try {
		const submitted = await submitForNotarisation(run, zipPath, credentials.value);
		if (!submitted.ok) return submitted;
		return stapleArtifact(run, appPath);
	} finally {
		rmSync(zipPath, { force: true });
	}
}

/** Submits the disk image itself for notarisation, waits and staples the ticket to the image. */
export async function notariseDiskImage(
	run: RunTool,
	dmgPath: string,
	env: Readonly<Record<string, string | undefined>>,
): Promise<Result<void>> {
	const credentials = notaryCredentials(env);
	if (!credentials.ok) return credentials;
	const submitted = await submitForNotarisation(run, dmgPath, credentials.value);
	if (!submitted.ok) return submitted;
	return stapleArtifact(run, dmgPath);
}

/**
 * Mounts the shipped disk image and verifies the app inside it, so the file a person downloads is
 * the one that was checked, not a fresh app on disk.
 */
export async function verifyDiskImage(
	run: RunTool,
	dmgPath: string,
	appName: string,
): Promise<Result<BundleReport>> {
	const imageStaple = await runChecked(
		run,
		"xcrun",
		["stapler", "validate", dmgPath],
		"release_disk_image_not_notarised",
	);
	if (!imageStaple.ok) return imageStaple;

	const mountPoint = mkdtempSync(join(tmpdir(), "conducted-release-"));
	const attached = await runChecked(
		run,
		"hdiutil",
		["attach", "-readonly", "-nobrowse", "-mountpoint", mountPoint, dmgPath],
		"release_disk_image_failed",
	);
	if (!attached.ok) {
		rmSync(mountPoint, { recursive: true, force: true });
		return attached;
	}

	const report = await verifyBundle(run, join(mountPoint, appName));
	const detached = await runChecked(
		run,
		"hdiutil",
		["detach", mountPoint],
		"release_disk_image_failed",
	);
	if (!detached.ok) return detached;
	rmSync(mountPoint, { recursive: true, force: true });
	return report;
}

async function submitForNotarisation(
	run: RunTool,
	artifactPath: string,
	credentials: readonly string[],
): Promise<Result<void>> {
	const submitted = await runChecked(
		run,
		"xcrun",
		["notarytool", "submit", artifactPath, "--wait", ...credentials],
		"release_notarisation_failed",
	);
	if (!submitted.ok) return submitted;

	const answer = `${submitted.value.stdout}\n${submitted.value.stderr}`;
	if (!/status:\s*Accepted/i.test(answer)) {
		return err(
			appError(
				"release_notarisation_rejected",
				`Apple rejected the notarisation.\n${await notarisationLog(run, answer, credentials)}`,
			),
		);
	}
	return ok(undefined);
}

async function stapleArtifact(run: RunTool, artifactPath: string): Promise<Result<void>> {
	const stapled = await runChecked(
		run,
		"xcrun",
		["stapler", "staple", artifactPath],
		"release_notarisation_failed",
	);
	if (!stapled.ok) return stapled;
	const validated = await runChecked(
		run,
		"xcrun",
		["stapler", "validate", artifactPath],
		"release_notarisation_failed",
	);
	if (!validated.ok) return validated;
	return ok(undefined);
}

/** Reads a built `.app` and reports what it holds and what is missing. */
export async function verifyBundle(run: RunTool, appPath: string): Promise<Result<BundleReport>> {
	const infoPath = join(appPath, "Contents", "Info.plist");
	const info = await runToolOutput(run, "plutil", ["-convert", "json", "-o", "-", infoPath]);
	if (!info.ok) return info;
	if (info.value.exitCode !== 0) {
		return err(
			appError(
				"release_info_plist_unreadable",
				`Could not read ${infoPath}: ${textOf(info.value)}`,
			),
		);
	}
	const parsed = parseJsonObject(info.value.stdout, infoPath);
	if (!parsed.ok) return parsed;
	const values = parsed.value;

	const bundleIdentifier = stringValue(values.CFBundleIdentifier);
	const version =
		stringValue(values.CFBundleShortVersionString) ?? stringValue(values.CFBundleVersion);
	const executable = stringValue(values.CFBundleExecutable);
	const missingPrivacyKeys = REQUIRED_PRIVACY_KEYS.filter(
		(key) => (stringValue(values[key]) ?? "") === "",
	);

	const architectures = new Set<string>();
	const mainBinary = executable === null ? null : join(appPath, "Contents", "MacOS", executable);
	if (mainBinary !== null) {
		const described = await runToolOutput(run, "file", ["-b", mainBinary]);
		if (!described.ok) return described;
		for (const architecture of architecturesIn(described.value.stdout)) {
			architectures.add(architecture);
		}
	}

	const sidecar = sidecarBinaryPath(appPath);
	if (!sidecar.ok) return sidecar;
	const describedSidecar = await runToolOutput(run, "file", ["-b", sidecar.value]);
	if (!describedSidecar.ok) return describedSidecar;
	for (const architecture of architecturesIn(describedSidecar.value.stdout)) {
		architectures.add(architecture);
	}

	const contents = await runToolOutput(run, "ls", ["-1", join(appPath, "Contents")]);
	if (!contents.ok) return contents;
	const entries = contents.value.stdout
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "");
	const hasFrameworksFolder = entries.includes("Frameworks");

	const appSignature = await signatureOf(run, appPath);
	if (!appSignature.ok) return appSignature;
	const sidecarSignature = await signatureOf(run, sidecar.value);
	if (!sidecarSignature.ok) return sidecarSignature;

	const staple = await runToolOutput(run, "xcrun", ["stapler", "validate", appPath]);
	if (!staple.ok) return staple;

	return ok({
		bundleIdentifier,
		version,
		missingEntitlements: REQUIRED_ENTITLEMENTS.filter(
			(key) => !appSignature.value.entitlements.includes(key),
		),
		missingPrivacyKeys,
		architectures: [...architectures].sort(),
		hasFrameworksFolder,
		signed: appSignature.value.signed,
		hardenedRuntime: appSignature.value.hardenedRuntime,
		sidecarSigned: sidecarSignature.value.signed,
		sidecarMissingEntitlements: REQUIRED_SIDECAR_ENTITLEMENTS.filter(
			(key) => !sidecarSignature.value.entitlements.includes(key),
		),
		notarised: staple.value.exitCode === 0,
	});
}

/** What the release expects of the bundle it just built. */
export interface ExpectedBundle {
	identifier: string;
	/** The version the release set, read after the bump. */
	version: string;
	/** Whether this release notarises; a signed-only release needs no ticket. */
	notarised: boolean;
}

/** Every problem that stops this bundle from being released. Empty means ready. */
export function bundleProblems(report: BundleReport, expected: ExpectedBundle): string[] {
	const problems: string[] = [];
	if (report.bundleIdentifier === null) {
		problems.push("The bundle has no CFBundleIdentifier.");
	} else if (report.bundleIdentifier !== expected.identifier) {
		problems.push(
			`The bundle identifier is ${report.bundleIdentifier}; expected ${expected.identifier}.`,
		);
	}
	if (report.version === null) {
		problems.push("The bundle has no version.");
	} else if (report.version !== expected.version) {
		problems.push(`The bundle version is ${report.version}; expected ${expected.version}.`);
	}
	for (const key of report.missingPrivacyKeys) {
		problems.push(`Info.plist has no privacy string for ${key}.`);
	}
	for (const key of report.missingEntitlements) {
		problems.push(`The app signature has no ${key} entitlement.`);
	}
	if (report.architectures.length !== 1 || report.architectures[0] !== "arm64") {
		problems.push(
			`The app and sidecar must be arm64 only; found ${report.architectures.join(", ")}.`,
		);
	}
	if (report.hasFrameworksFolder) {
		problems.push("The bundle has a Frameworks folder.");
	}
	if (!report.signed) problems.push("The app is not signed with a Developer ID identity.");
	if (!report.hardenedRuntime) problems.push("The app is not signed with the hardened runtime.");
	if (!report.sidecarSigned) problems.push("The sidecar is not signed on its own.");
	for (const key of report.sidecarMissingEntitlements) {
		problems.push(`The sidecar signature has no ${key} entitlement.`);
	}
	if (expected.notarised && !report.notarised)
		problems.push("The app has no stapled notarisation ticket.");
	return problems;
}

interface Signature {
	signed: boolean;
	hardenedRuntime: boolean;
	entitlements: string[];
}

async function signatureOf(run: RunTool, target: string): Promise<Result<Signature>> {
	const output = await runToolOutput(run, "codesign", [
		"-d",
		"--verbose=4",
		"--entitlements",
		":-",
		target,
	]);
	if (!output.ok) return output;
	const text = textOf(output.value);
	return ok({
		signed: output.value.exitCode === 0 && /Authority=/.test(text),
		hardenedRuntime: /flags=[^\n]*\bruntime\b/.test(text),
		entitlements: [...text.matchAll(/<key>([^<]+)<\/key>/g)]
			.map((match) => match[1])
			.filter((key): key is string => key !== undefined),
	});
}

async function runToolOutput(
	run: RunTool,
	program: string,
	args: readonly string[],
): Promise<Result<ToolOutput>> {
	const output = await run(program, args);
	if (!output.ok) return output;
	return ok(output.value);
}

async function runChecked(
	run: RunTool,
	program: string,
	args: readonly string[],
	code: string,
): Promise<Result<ToolOutput>> {
	const output = await runToolOutput(run, program, args);
	if (!output.ok) return output;
	if (output.value.exitCode !== 0) {
		return err(
			appError(
				code,
				`${program} failed: ${textOf(output.value) || `exit ${output.value.exitCode}`}.`,
			),
		);
	}
	return output;
}

/** A trimmed environment value, or `undefined` when it is missing or empty. */
function envValue(
	env: Readonly<Record<string, string | undefined>>,
	name: string,
): string | undefined {
	const value = env[name]?.trim();
	return value === undefined || value === "" ? undefined : value;
}

function missingCredentials(missing: readonly string[]): Result<readonly string[]> {
	return err(
		appError(
			"release_notarisation_credentials_missing",
			`Set ${NOTARY_PROFILE_ENV}, or ${missing.join(", ")} for notarisation.`,
		),
	);
}

function notaryCredentials(
	env: Readonly<Record<string, string | undefined>>,
): Result<readonly string[]> {
	const profile = envValue(env, NOTARY_PROFILE_ENV);
	if (profile !== undefined) {
		return ok(["--keychain-profile", profile]);
	}

	const apiKey = envValue(env, "APPLE_API_KEY");
	const apiKeyId = envValue(env, "APPLE_API_KEY_ID");
	const issuer = envValue(env, "APPLE_API_ISSUER");
	if (apiKey !== undefined || apiKeyId !== undefined || issuer !== undefined) {
		if (apiKey !== undefined && apiKeyId !== undefined && issuer !== undefined) {
			return ok(["--key", apiKey, "--key-id", apiKeyId, "--issuer", issuer]);
		}
		return missingCredentials([
			...(apiKey === undefined ? ["APPLE_API_KEY"] : []),
			...(apiKeyId === undefined ? ["APPLE_API_KEY_ID"] : []),
			...(issuer === undefined ? ["APPLE_API_ISSUER"] : []),
		]);
	}

	const appleId = envValue(env, "APPLE_ID");
	const password = envValue(env, "APPLE_PASSWORD");
	const teamId = envValue(env, "APPLE_TEAM_ID");
	if (appleId !== undefined && password !== undefined && teamId !== undefined) {
		return ok(["--apple-id", appleId, "--password", password, "--team-id", teamId]);
	}
	return missingCredentials([
		...(appleId === undefined ? ["APPLE_ID"] : []),
		...(password === undefined ? ["APPLE_PASSWORD"] : []),
		...(teamId === undefined ? ["APPLE_TEAM_ID"] : []),
	]);
}

async function notarisationLog(
	run: RunTool,
	answer: string,
	credentials: readonly string[],
): Promise<string> {
	const id = /^\s*id:\s*(\S+)/m.exec(answer)?.[1];
	if (id === undefined) return answer.trim();
	const logged = await run("xcrun", ["notarytool", "log", id, ...credentials]);
	if (!logged.ok) return `${answer.trim()}\n${logged.error.message}`;
	const text = `${logged.value.stdout}\n${logged.value.stderr}`.trim();
	return text === "" ? answer.trim() : `${answer.trim()}\n${text}`;
}

function parseJsonObject(text: string, source: string): Result<Record<string, unknown>> {
	try {
		const value: unknown = JSON.parse(text);
		if (typeof value !== "object" || value === null || Array.isArray(value)) {
			return err(appError("release_info_plist_unreadable", `${source} is not a plist dictionary.`));
		}
		return ok(value as Record<string, unknown>);
	} catch (error) {
		return err(appError("release_info_plist_unreadable", `${source} is not valid JSON.`, error));
	}
}

function stringValue(value: unknown): string | null {
	return typeof value === "string" && value.trim() !== "" ? value : null;
}

function architecturesIn(output: string): string[] {
	return [
		...new Set([...output.matchAll(/\b(arm64|x86_64)\b/g)].flatMap((match) => match[1] ?? [])),
	];
}

function textOf(output: ToolOutput): string {
	return `${output.stdout}\n${output.stderr}`.trim();
}
