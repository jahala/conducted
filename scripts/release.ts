/**
 * Cuts a release as one command that stops at its first failure.
 *
 * Usage:
 *   pnpm release 0.2.0          dry run: says every step and how to undo it, changes nothing
 *   pnpm release 0.2.0 --go     does it: check main's CI, bump versions, build, sign, commit, tag
 *
 * It runs no tests on this Mac: it releases only origin/main's HEAD, and only when main's CI passed
 * for it (the owner's ruling, 2026-11-06). The dry run makes the same read-only checks, so it says
 * whether --go would refuse. It signs with the keychain's Developer ID Application identity unless
 * APPLE_SIGNING_IDENTITY names one, and notarises with the notarytool keychain profile "conducted"
 * when that profile exists; without it the app is signed but not notarised, and the last lines say so.
 *
 * App updates (PLAT-13, D079): the build reads the updater key and its password from the keychain
 * straight into the build's environment, because `createUpdaterArtifacts` makes `tauri build` sign
 * an update archive. That archive is made before the app is signed and notarised, so the release
 * makes it again from the notarised app, signs it with `tauri signer sign`, and writes `latest.json`
 * beside the disk image. The key is never printed, logged or written to a file.
 *
 * It never pushes and never publishes. The last lines print the push command and the
 * `gh release create` command that uploads the disk image, the archive and the feed, so publishing
 * stays a separate, deliberate step.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import {
	appBuildArguments,
	type BundleReport,
	bundleProblems,
	createDiskImage,
	diskImagePath,
	type ExpectedBundle,
	NOTARY_PROFILE_ENV,
	notariseBundle,
	notariseDiskImage,
	runTool,
	SIGNING_IDENTITY_ENV,
	signBundle,
	verifyBundle,
	verifyDiskImage,
} from "../apps/desktop/src-tauri/release/bundle.ts";
import { VERSION_FILES } from "./guards/versions.ts";
import { type CiRun, ciGate, parseIdentities, pickSigningIdentity } from "./release/gates.ts";
import { type ReleaseStepId, releasePlan } from "./release/plan.ts";
import {
	FEED_FILE_NAME,
	ghReleaseCommand,
	UPDATER_KEY_ITEMS,
	updaterArchivePath,
	updaterFeed,
	updaterKeyLookup,
} from "./release/updater.ts";

const root = join(import.meta.dir, "..");
const version = process.argv[2];
const go = process.argv.includes("--go");

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
	console.error("Usage: pnpm release <major.minor.patch> [--go]");
	process.exit(64);
}

type ToolResult<T> = { ok: true; value: T } | { ok: false; error: { message: string } };

async function must<T>(result: Promise<ToolResult<T>>): Promise<T> {
	const value = await result;
	if (!value.ok) throw new Error(value.error.message);
	return value.value;
}

function rejectProblems(report: BundleReport, expected: ExpectedBundle): void {
	const problems = bundleProblems(report, expected);
	if (problems.length > 0) throw new Error(problems.join("\n"));
}

function sh(
	cmd: readonly string[],
	cwd = root,
	env: Record<string, string | undefined> = process.env,
): string {
	const result = Bun.spawnSync([...cmd], { cwd, env, stdout: "pipe", stderr: "pipe" });
	if (result.exitCode !== 0) {
		throw new Error(
			`${cmd.join(" ")} failed:\n${result.stderr.toString()}${result.stdout.toString()}`,
		);
	}
	return result.stdout.toString().trim();
}

function gate<T>(result: ToolResult<T>): T {
	if (!result.ok) throw new Error(result.error.message);
	return result.value;
}

/** The identity to sign with: APPLE_SIGNING_IDENTITY, else the keychain's longest-lasting Developer ID. */
function signingIdentity(): string {
	const named = process.env[SIGNING_IDENTITY_ENV]?.trim();
	if (named) return named;
	const identities = parseIdentities(sh(["security", "find-identity", "-v", "-p", "codesigning"]));
	const dated = identities.map((identity) => {
		const pems = sh(["security", "find-certificate", "-a", "-Z", "-p", "-c", identity.name]);
		const block = pems.split(/^SHA-1 hash: /m).find((part) => part.startsWith(identity.hash));
		const pem = block?.slice(block.indexOf("-----BEGIN CERTIFICATE-----"));
		const end = pem
			? Bun.spawnSync(["openssl", "x509", "-noout", "-enddate"], { stdin: Buffer.from(pem) })
			: null;
		const text = end?.exitCode === 0 ? end.stdout.toString().trim() : "";
		return { ...identity, notAfter: new Date(text.replace(/^notAfter=/, "") || 0) };
	});
	return gate(pickSigningIdentity(dated));
}

const NOTARY_PROFILE = "conducted";

/** Whether the notarytool keychain profile exists. Without it the release is signed only. */
function notaryProfileExists(): boolean {
	const result = Bun.spawnSync(
		["xcrun", "notarytool", "history", "--keychain-profile", NOTARY_PROFILE],
		{ stdout: "ignore", stderr: "ignore" },
	);
	return result.exitCode === 0;
}

/**
 * The updater key and its password, read from the keychain. The values go only into the
 * environment of the child that needs them; a failure names the keychain item, never its value.
 */
function readUpdaterKey(): Record<keyof typeof UPDATER_KEY_ITEMS, string> {
	const read = (service: string): string => {
		const result = Bun.spawnSync([...updaterKeyLookup(service)], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const value = result.stdout.toString().replace(/\n$/, "");
		if (result.exitCode !== 0 || value === "") {
			throw new Error(
				`The keychain item "${service}" (account conducted) could not be read: ${result.stderr.toString().trim()}`,
			);
		}
		return value;
	};
	return {
		TAURI_SIGNING_PRIVATE_KEY: read(UPDATER_KEY_ITEMS.TAURI_SIGNING_PRIVATE_KEY),
		TAURI_SIGNING_PRIVATE_KEY_PASSWORD: read(UPDATER_KEY_ITEMS.TAURI_SIGNING_PRIVATE_KEY_PASSWORD),
	};
}

let notarised = false;
/** Read once by the build step and used again to sign the update archive. */
let updaterKey: Record<keyof typeof UPDATER_KEY_ITEMS, string> | null = null;
const tauriDir = join(root, "apps/desktop/src-tauri");
const appPath = join(
	tauriDir,
	"target",
	"aarch64-apple-darwin",
	"release",
	"bundle",
	"macos",
	"Conducted.app",
);
const dmgPath = diskImagePath(appPath);
const archivePath = updaterArchivePath(appPath);
const signaturePath = `${archivePath}.sig`;
const feedPath = join(dirname(dmgPath), FEED_FILE_NAME);

const runs: Record<ReleaseStepId, () => void | Promise<void>> = {
	check: () => {
		if (sh(["git", "status", "--porcelain"]) !== "")
			throw new Error("The working tree has changes.");
		if (sh(["git", "branch", "--show-current"]) !== "main") throw new Error("Not on main.");
		if (sh(["git", "tag", "--list", `v${version}`]) !== "") throw new Error(`v${version} exists.`);
		sh(["git", "fetch", "--quiet", "origin", "main"]);
		const head = sh(["git", "rev-parse", "HEAD"]);
		const ciRuns = JSON.parse(
			sh([
				"gh",
				"run",
				"list",
				"--branch",
				"main",
				"--commit",
				head,
				"--limit",
				"20",
				"--json",
				"name,headSha,status,conclusion",
			]),
		) as CiRun[];
		gate(ciGate({ head, mainHead: sh(["git", "rev-parse", "origin/main"]), runs: ciRuns }));
	},
	bump: () => {
		for (const file of VERSION_FILES.filter((f) => f.endsWith(".json"))) {
			const path = join(root, file);
			const data = JSON.parse(readFileSync(path, "utf8"));
			data.version = version;
			writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
		}
		const tomlPath = join(tauriDir, "Cargo.toml");
		const toml = readFileSync(tomlPath, "utf8") as string;
		writeFileSync(tomlPath, toml.replace(/^version = "[^"]+"/m, `version = "${version}"`));
		sh(["cargo", "update", "--package", "conducted", "--offline"], tauriDir);
		sh([
			"node_modules/.bin/biome",
			"format",
			"--write",
			...VERSION_FILES.filter((f) => f.endsWith(".json")),
		]);
	},
	build: async () => {
		const env: Record<string, string | undefined> = {
			...process.env,
			[SIGNING_IDENTITY_ENV]: signingIdentity(),
		};
		const notarise = Boolean(env[NOTARY_PROFILE_ENV]?.trim()) || notaryProfileExists();
		if (notarise && !env[NOTARY_PROFILE_ENV]?.trim()) env[NOTARY_PROFILE_ENV] = NOTARY_PROFILE;
		// The build uses exactly the packages main's lockfile names, whatever this checkout had installed.
		sh(["pnpm", "install", "--frozen-lockfile"]);
		sh(["pnpm", "--filter", "@conducted/sidecar", "build"]);
		// createUpdaterArtifacts makes the build sign an update archive, so only the build gets the key.
		updaterKey = readUpdaterKey();
		sh(appBuildArguments("aarch64-apple-darwin", "src-tauri/tauri.release.conf.json"), root, {
			...process.env,
			...updaterKey,
		});
		await must(signBundle(runTool, appPath, env));
		if (notarise) await must(notariseBundle(runTool, appPath, env));
		// Read after step 2's bump: a copy loaded at start would still hold the old version.
		const config = JSON.parse(readFileSync(join(tauriDir, "tauri.conf.json"), "utf8")) as {
			identifier: string;
		};
		const expected: ExpectedBundle = {
			identifier: config.identifier,
			version,
			notarised: notarise,
		};
		rejectProblems(await must(verifyBundle(runTool, appPath)), expected);

		await must(createDiskImage(runTool, appPath, dmgPath));
		if (notarise) await must(notariseDiskImage(runTool, dmgPath, env));
		notarised = notarise;
		rejectProblems(await must(verifyDiskImage(runTool, dmgPath, basename(appPath))), expected);
	},
	updaterArchive: () => {
		if (updaterKey === null) throw new Error("The updater key was not read by the build step.");
		// The build's archive and signature hold the app from before signing; neither may ship.
		if (existsSync(signaturePath)) sh(["trash", signaturePath]);
		// No AppleDouble files: the updater unpacks the archive over the installed app.
		sh(["tar", "-czf", archivePath, "-C", dirname(appPath), basename(appPath)], root, {
			...process.env,
			COPYFILE_DISABLE: "1",
		});
		sh(["pnpm", "--filter", "@conducted/desktop", "tauri", "signer", "sign", archivePath], root, {
			...process.env,
			...updaterKey,
		});
		if (!existsSync(signaturePath)) {
			throw new Error(`tauri signer sign wrote no signature at ${signaturePath}.`);
		}
	},
	updaterFeed: () => {
		const feed = updaterFeed({
			version,
			notes: `v${version}`,
			pubDate: new Date(),
			archiveName: basename(archivePath),
			signature: readFileSync(signaturePath, "utf8"),
		});
		writeFileSync(feedPath, `${JSON.stringify(feed, null, 2)}\n`);
	},
	commit: () => {
		sh(["git", "add", ...VERSION_FILES]);
		sh(["git", "commit", "-m", `release: v${version}`]);
		sh(["git", "tag", "-a", `v${version}`, "-m", `v${version}`]);
	},
};

console.log(go ? `Releasing v${version}` : `Dry run for v${version} (add --go to do it)`);
for (const [index, step] of releasePlan(version).entries()) {
	console.log(`${index + 1}. ${step.say}\n   undo: ${step.undo}`);
	if (!go && !step.readOnly) continue;
	try {
		await runs[step.id]();
	} catch (error) {
		console.error(`\nStopped at step ${index + 1}: ${(error as Error).message}`);
		process.exit(1);
	}
}
if (go && !notarised) {
	console.log(
		`\nSigned but not notarised: there is no notarytool keychain profile "${NOTARY_PROFILE}". Store one with: xcrun notarytool store-credentials ${NOTARY_PROFILE} --team-id <team> --apple-id <Apple ID>`,
	);
}
if (go) {
	console.log(`\nDone. Publish with: git push origin main v${version}`);
	console.log(
		`Then upload the release with: ${ghReleaseCommand(version, [dmgPath, archivePath, feedPath])}`,
	);
} else {
	console.log("\nNothing was changed.");
}
