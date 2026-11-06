/**
 * Tests the release bundle checks and signing steps against a scripted runner, so no signing
 * identity or Apple account is needed and nothing is signed.
 */
import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { appError, err, ok, type Result } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import {
	appBuildArguments,
	bundleProblems,
	createDiskImage,
	diskImagePath,
	ENTITLEMENTS_PATH,
	NOTARY_PROFILE_ENV,
	notariseBundle,
	notariseDiskImage,
	REQUIRED_ENTITLEMENTS,
	REQUIRED_PRIVACY_KEYS,
	REQUIRED_SIDECAR_ENTITLEMENTS,
	type RunTool,
	sidecarBinaryName,
	sidecarBinaryPath,
	signBundle,
	verifyBundle,
	verifyDiskImage,
} from "./bundle.ts";

interface Output {
	stdout: string;
	stderr: string;
	exitCode: number;
}

interface Call {
	program: string;
	args: readonly string[];
}

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = "/tmp/Conducted.app";
const SIDECAR = `${APP}/Contents/MacOS/conducted-sidecar`;
const DMG = "/tmp/Conducted.dmg";
const EXPECTED_NOTARISED = { identifier: "build.conducted.app", version: "0.1.0", notarised: true };

const INFO = {
	CFBundleIdentifier: "build.conducted.app",
	CFBundleShortVersionString: "0.1.0",
	CFBundleExecutable: "Conducted",
	NSMicrophoneUsageDescription: "Dictate a message.",
	NSDesktopFolderUsageDescription: "Agents work in Desktop folders.",
	NSDocumentsFolderUsageDescription: "Agents work in Documents folders.",
	NSDownloadsFolderUsageDescription: "Agents work in Downloads folders.",
};

function completeSignature(keys: readonly string[]): string {
	return [
		"Executable=/tmp/Conducted.app/Contents/MacOS/Conducted",
		"Identifier=build.conducted.app",
		"Authority=Developer ID Application: Example (TEAM123)",
		"TeamIdentifier=TEAM123",
		"flags=0x10000(runtime)",
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<plist version="1.0"><dict>',
		...keys.map((key) => `<key>${key}</key><true/>`),
		"</dict></plist>",
	].join("\n");
}

function scripted(respond: (program: string, args: readonly string[]) => Result<Output>): {
	run: RunTool;
	calls: Call[];
} {
	const calls: Call[] = [];
	const run: RunTool = async (program, args) => {
		calls.push({ program, args });
		return respond(program, args);
	};
	return { run, calls };
}

function bundleRun(overrides: {
	info?: Record<string, unknown>;
	appEntitlements?: readonly string[];
	sidecarEntitlements?: readonly string[];
	appFile?: string;
	sidecarFile?: string;
	contents?: string;
	staplerExitCode?: number;
}): { run: RunTool; calls: Call[] } {
	const info = overrides.info ?? INFO;
	return scripted((program, args) => {
		if (program === "plutil") {
			return ok({ stdout: JSON.stringify(info), stderr: "", exitCode: 0 });
		}
		if (program === "file") {
			const target = args.at(-1) ?? "";
			if (target === SIDECAR) {
				return ok({
					stdout: overrides.sidecarFile ?? "Mach-O 64-bit executable arm64\n",
					stderr: "",
					exitCode: 0,
				});
			}
			return ok({
				stdout: overrides.appFile ?? "Mach-O 64-bit executable arm64\n",
				stderr: "",
				exitCode: 0,
			});
		}
		if (program === "ls") {
			return ok({
				stdout: overrides.contents ?? "MacOS\nResources\n",
				stderr: "",
				exitCode: 0,
			});
		}
		if (program === "codesign") {
			const target = args.at(-1) ?? "";
			const keys =
				target === SIDECAR
					? (overrides.sidecarEntitlements ?? REQUIRED_SIDECAR_ENTITLEMENTS)
					: (overrides.appEntitlements ?? REQUIRED_ENTITLEMENTS);
			return ok({ stdout: "", stderr: completeSignature(keys), exitCode: 0 });
		}
		return ok({
			stdout: "",
			stderr: "",
			exitCode: overrides.staplerExitCode ?? 0,
		});
	});
}

describe("PLAT-25 release bundle", () => {
	it("PLAT-25 verifyBundle names a missing microphone privacy string", async () => {
		const { run } = bundleRun({
			info: { ...INFO, NSMicrophoneUsageDescription: undefined },
		});

		const result = await verifyBundle(run, APP);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.missingPrivacyKeys).toEqual(["NSMicrophoneUsageDescription"]);
	});

	it("PLAT-25 verifyBundle names each missing entitlement", async () => {
		const { run } = bundleRun({
			appEntitlements: ["com.apple.security.cs.allow-jit"],
			sidecarEntitlements: ["com.apple.security.cs.allow-jit"],
		});

		const result = await verifyBundle(run, APP);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.missingEntitlements).toEqual([
			"com.apple.security.cs.allow-unsigned-executable-memory",
			"com.apple.security.device.audio-input",
		]);
		expect(result.value.sidecarMissingEntitlements).toEqual([
			"com.apple.security.cs.allow-unsigned-executable-memory",
		]);
	});

	it("PLAT-25 verifyBundle reads the bundle identity, one arm64 binary and no Frameworks folder", async () => {
		const { run } = bundleRun({});

		const result = await verifyBundle(run, APP);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.bundleIdentifier).toBe("build.conducted.app");
		expect(result.value.version).toBe("0.1.0");
		expect(result.value.architectures).toEqual(["arm64"]);
		expect(result.value.hasFrameworksFolder).toBe(false);
		expect(result.value.missingEntitlements).toEqual([]);
		expect(result.value.missingPrivacyKeys).toEqual([]);
		expect(result.value.signed).toBe(true);
		expect(result.value.hardenedRuntime).toBe(true);
		expect(result.value.sidecarSigned).toBe(true);
		expect(result.value.notarised).toBe(true);
	});

	it("PLAT-25 verifyBundle reports a universal binary, a Frameworks folder and a missing ticket", async () => {
		const { run } = bundleRun({
			appFile: "Mach-O universal binary with 2 architectures: [x86_64] [arm64]\n",
			contents: "MacOS\nFrameworks\nResources\n",
			staplerExitCode: 1,
		});

		const result = await verifyBundle(run, APP);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.architectures).toEqual(["arm64", "x86_64"]);
		expect(result.value.hasFrameworksFolder).toBe(true);
		expect(result.value.notarised).toBe(false);
		expect(bundleProblems(result.value, EXPECTED_NOTARISED)).toEqual(
			expect.arrayContaining([
				"The app and sidecar must be arm64 only; found arm64, x86_64.",
				"The bundle has a Frameworks folder.",
				"The app has no stapled notarisation ticket.",
			]),
		);
	});

	it("PLAT-25 bundleProblems compares the bundle with the version the release just set", async () => {
		const { run } = bundleRun({});
		const result = await verifyBundle(run, APP);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(bundleProblems(result.value, { ...EXPECTED_NOTARISED, version: "0.1.0" })).toEqual([]);
		expect(bundleProblems(result.value, { ...EXPECTED_NOTARISED, version: "0.2.0" })).toEqual([
			"The bundle version is 0.1.0; expected 0.2.0.",
		]);
	});

	it("PLAT-25 bundleProblems asks for a notarisation ticket only when the release notarises", async () => {
		const { run } = bundleRun({ staplerExitCode: 1 });
		const result = await verifyBundle(run, APP);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(bundleProblems(result.value, { ...EXPECTED_NOTARISED, notarised: false })).toEqual([]);
		expect(bundleProblems(result.value, EXPECTED_NOTARISED)).toEqual([
			"The app has no stapled notarisation ticket.",
		]);
	});

	it("PLAT-25 signs the sidecar on its own with the JIT entitlements, then the app", async () => {
		const { run, calls } = scripted(() => ok({ stdout: "", stderr: "", exitCode: 0 }));

		const result = await signBundle(run, APP, {
			APPLE_SIGNING_IDENTITY: "Developer ID Application: Example (TEAM123)",
		});

		expect(result).toEqual({ ok: true, value: undefined });
		expect(calls.map((call) => call.program)).toEqual([
			"codesign",
			"codesign",
			"codesign",
			"codesign",
		]);
		expect(calls[0]?.args.at(-1)).toBe(SIDECAR);
		expect(calls[2]?.args.at(-1)).toBe(APP);
		for (const call of [calls[0], calls[2]]) {
			expect(call?.args).toContain("runtime");
			expect(call?.args).toContain(ENTITLEMENTS_PATH);
			expect(call?.args).toContain("Developer ID Application: Example (TEAM123)");
		}
	});

	it("PLAT-25 refuses to sign without an identity and names the variable", async () => {
		const { run, calls } = scripted(() => ok({ stdout: "", stderr: "", exitCode: 0 }));

		const result = await signBundle(run, APP, {});

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.message).toContain("APPLE_SIGNING_IDENTITY");
		expect(calls).toEqual([]);
	});

	it("PLAT-25 refuses to notarise without credentials and names each missing variable", async () => {
		const { run, calls } = scripted(() => ok({ stdout: "", stderr: "", exitCode: 0 }));

		const result = await notariseBundle(run, APP, {});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.message).toContain("APPLE_ID");
			expect(result.error.message).toContain("APPLE_PASSWORD");
			expect(result.error.message).toContain("APPLE_TEAM_ID");
		}
		expect(calls).toEqual([]);
	});

	it("PLAT-25 packs, submits, waits, staples and validates the app", async () => {
		const { run, calls } = scripted((program, args) => {
			if (program === "ditto") return ok({ stdout: "", stderr: "", exitCode: 0 });
			if (program === "xcrun" && args[1] === "submit") {
				return ok({ stdout: "id: request-1\nstatus: Accepted\n", stderr: "", exitCode: 0 });
			}
			if (program === "xcrun") return ok({ stdout: "validated\n", stderr: "", exitCode: 0 });
			return err(appError("unexpected_tool", `Unexpected tool ${program}.`));
		});

		const result = await notariseBundle(run, APP, {
			APPLE_ID: "person@example.com",
			APPLE_PASSWORD: "app-password",
			APPLE_TEAM_ID: "TEAM123",
		});

		expect(result).toEqual({ ok: true, value: undefined });
		expect(calls[0]).toEqual({
			program: "ditto",
			args: ["-c", "-k", "--keepParent", APP, `${APP}.zip`],
		});
		expect(calls[1]?.program).toBe("xcrun");
		expect(calls[1]?.args.slice(0, 4)).toEqual(["notarytool", "submit", `${APP}.zip`, "--wait"]);
		expect(calls[1]?.args).toContain("--apple-id");
		expect(calls[1]?.args).toContain("person@example.com");
		expect(calls[2]?.args).toEqual(["stapler", "staple", APP]);
		expect(calls[3]?.args).toEqual(["stapler", "validate", APP]);
	});

	it("PLAT-25 treats an empty or whitespace credential as missing", async () => {
		const { run, calls } = scripted(() => ok({ stdout: "", stderr: "", exitCode: 0 }));

		const result = await notariseBundle(run, APP, {
			APPLE_ID: "",
			APPLE_PASSWORD: "   ",
			APPLE_TEAM_ID: "TEAM123",
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.message).toContain("APPLE_ID");
			expect(result.error.message).toContain("APPLE_PASSWORD");
		}
		expect(calls).toEqual([]);
	});

	it("PLAT-25 uses a stored keychain profile so the password stays off the command line", async () => {
		const { run, calls } = scripted((program, args) => {
			if (program === "ditto") return ok({ stdout: "", stderr: "", exitCode: 0 });
			if (program === "xcrun" && args[1] === "submit") {
				return ok({ stdout: "status: Accepted\n", stderr: "", exitCode: 0 });
			}
			if (program === "xcrun") return ok({ stdout: "validated\n", stderr: "", exitCode: 0 });
			return err(appError("unexpected_tool", `Unexpected tool ${program}.`));
		});

		const result = await notariseBundle(run, APP, {
			[NOTARY_PROFILE_ENV]: "conducted-notary",
		});

		expect(result).toEqual({ ok: true, value: undefined });
		const submit = calls.find((call) => call.program === "xcrun" && call.args[1] === "submit");
		expect(submit?.args).toContain("--keychain-profile");
		expect(submit?.args).toContain("conducted-notary");
		expect(submit?.args).not.toContain("--password");
		expect(submit?.args).not.toContain("--apple-id");
	});

	it("PLAT-25 makes the disk image from the verified app and the Applications shortcut", async () => {
		const { run, calls } = scripted(() => ok({ stdout: "", stderr: "", exitCode: 0 }));

		const result = await createDiskImage(run, APP, DMG);

		expect(diskImagePath(APP)).toBe(DMG);
		expect(result).toEqual({ ok: true, value: undefined });
		expect(calls.map((call) => call.program)).toEqual(["ditto", "ln", "hdiutil"]);
		expect(calls[0]?.args[0]).toBe(APP);
		expect(calls[0]?.args[1]).toMatch(/Conducted\.app$/);
		expect(calls[1]?.args).toEqual(["-s", "/Applications", expect.stringMatching(/Applications$/)]);
		expect(calls[2]?.args[0]).toBe("create");
		expect(calls[2]?.args).toContain("-srcfolder");
		expect(calls[2]?.args.at(-1)).toBe(DMG);
	});

	it("PLAT-25 notarises and staples the disk image itself", async () => {
		const dmgPath = DMG;
		const { run, calls } = scripted((program, args) => {
			if (program === "xcrun" && args[1] === "submit") {
				return ok({ stdout: "status: Accepted\n", stderr: "", exitCode: 0 });
			}
			if (program === "xcrun") return ok({ stdout: "validated\n", stderr: "", exitCode: 0 });
			return err(appError("unexpected_tool", `Unexpected tool ${program}.`));
		});

		const result = await notariseDiskImage(run, dmgPath, {
			[NOTARY_PROFILE_ENV]: "conducted-notary",
		});

		expect(result).toEqual({ ok: true, value: undefined });
		expect(calls[0]?.args).toEqual([
			"notarytool",
			"submit",
			dmgPath,
			"--wait",
			"--keychain-profile",
			"conducted-notary",
		]);
		expect(calls[1]?.args).toEqual(["stapler", "staple", dmgPath]);
		expect(calls[2]?.args).toEqual(["stapler", "validate", dmgPath]);
	});

	it("PLAT-25 verifies the app inside the shipped disk image", async () => {
		const dmgPath = DMG;
		const { run, calls } = scripted((program) => {
			if (program === "hdiutil") return ok({ stdout: "", stderr: "", exitCode: 0 });
			if (program === "xcrun") return ok({ stdout: "validated\n", stderr: "", exitCode: 0 });
			if (program === "plutil") {
				return ok({ stdout: JSON.stringify(INFO), stderr: "", exitCode: 0 });
			}
			if (program === "file") {
				return ok({
					stdout: "Mach-O 64-bit executable arm64\n",
					stderr: "",
					exitCode: 0,
				});
			}
			if (program === "ls") {
				return ok({ stdout: "MacOS\nResources\n", stderr: "", exitCode: 0 });
			}
			if (program === "codesign") {
				return ok({
					stdout: "",
					stderr: completeSignature(REQUIRED_ENTITLEMENTS),
					exitCode: 0,
				});
			}
			return err(appError("unexpected_tool", `Unexpected tool ${program}.`));
		});

		const result = await verifyDiskImage(run, dmgPath, basename(APP));

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.bundleIdentifier).toBe("build.conducted.app");
		const attach = calls.find((call) => call.program === "hdiutil" && call.args[0] === "attach");
		const mountPoint = attach?.args[4];
		expect(mountPoint).toBeDefined();
		expect(
			calls.some(
				(call) =>
					call.program === "hdiutil" && call.args[0] === "detach" && call.args[1] === mountPoint,
			),
		).toBe(true);
		const plutil = calls.find((call) => call.program === "plutil");
		expect(plutil?.args.at(-1)).toBe(
			join(mountPoint ?? "", "Conducted.app", "Contents", "Info.plist"),
		);
	});

	it("PLAT-25 builds only the app so signing happens before the disk image is made", () => {
		const args = appBuildArguments("aarch64-apple-darwin", "src-tauri/tauri.release.conf.json");

		expect(args[args.indexOf("--bundles") + 1]).toBe("app");
		expect(args).not.toContain("all");
	});

	it("PLAT-25 returns Apple's log when notarisation is rejected", async () => {
		const { run } = scripted((program, args) => {
			if (program === "ditto") return ok({ stdout: "", stderr: "", exitCode: 0 });
			if (program === "xcrun" && args[1] === "submit") {
				return ok({ stdout: "id: request-2\nstatus: Invalid\n", stderr: "", exitCode: 0 });
			}
			if (program === "xcrun" && args[1] === "log") {
				return ok({
					stdout: "The sidecar is not signed with a Developer ID certificate.",
					stderr: "",
					exitCode: 0,
				});
			}
			return ok({ stdout: "", stderr: "", exitCode: 0 });
		});

		const result = await notariseBundle(run, APP, {
			APPLE_API_KEY: "/tmp/AuthKey.p8",
			APPLE_API_KEY_ID: "KEY123",
			APPLE_API_ISSUER: "issuer-1",
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.message).toContain("The sidecar is not signed");
			expect(result.error.message).not.toContain("issuer-1");
		}
	});

	it("PLAT-25 the release config, entitlements and privacy strings are present", () => {
		const tauri = JSON.parse(readFileSync(join(HERE, "..", "tauri.conf.json"), "utf8")) as {
			bundle: {
				macOS: { entitlements: string; infoPlist: string; hardenedRuntime: boolean };
			};
		};
		const release = JSON.parse(
			readFileSync(join(HERE, "..", "tauri.release.conf.json"), "utf8"),
		) as { bundle: { externalBin: string[] } };
		const entitlements = readFileSync(ENTITLEMENTS_PATH, "utf8");
		const info = readFileSync(join(HERE, "..", "Info.plist"), "utf8");

		expect(sidecarBinaryName()).toEqual({ ok: true, value: "conducted-sidecar" });
		expect(sidecarBinaryPath(APP)).toEqual({ ok: true, value: SIDECAR });
		expect(release.bundle.externalBin).toEqual(["binaries/conducted-sidecar"]);
		expect(tauri.bundle.macOS).toEqual({
			entitlements: "Entitlements.plist",
			infoPlist: "Info.plist",
			hardenedRuntime: true,
		});
		for (const key of REQUIRED_ENTITLEMENTS) {
			expect(entitlements).toContain(`<key>${key}</key>`);
		}
		for (const key of REQUIRED_PRIVACY_KEYS) {
			expect(info).toContain(`<key>${key}</key>`);
			expect(info).toMatch(new RegExp(`<key>${key}</key>\\s*<string>[^<]+</string>`));
		}
	});
});
