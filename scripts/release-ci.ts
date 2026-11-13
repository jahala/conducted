/**
 * Builds, signs, notarises and packages one tagged release on the CI runner (PLAT-37). The
 * workflow calls it after installing the locked packages and importing the certificate. All
 * credentials come from the environment; a missing one stops the run before the build, and CI
 * never makes a signed-but-not-notarised build.
 *
 * The steps themselves live in the same modules the local release used: the app build, signing,
 * notarisation, disk image and verification are in `apps/desktop/src-tauri/release/bundle.ts`,
 * and the updater archive, its signature and `latest.json` are in `scripts/release/updater.ts`.
 *
 * Usage: bun scripts/release-ci.ts v0.2.2
 */
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import {
	appBuildArguments,
	type BundleReport,
	bundleProblems,
	createDiskImage,
	diskImagePath,
	type ExpectedBundle,
	notariseBundle,
	notariseDiskImage,
	RELEASE_TARGET,
	runTool,
	SIGNING_IDENTITY_ENV,
	signBundle,
	verifyBundle,
	verifyDiskImage,
} from "../apps/desktop/src-tauri/release/bundle.ts";
import { BUILD_SECRETS, missingReleaseSecrets } from "./release/credentials.ts";
import { readTag } from "./release/tag.ts";
import { FEED_FILE_NAME, updaterArchivePath, updaterFeed } from "./release/updater.ts";

const root = join(import.meta.dir, "..");
const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME ?? "";
const release = readTag(tag);

const missing = missingReleaseSecrets(process.env, BUILD_SECRETS);
for (const name of missing) console.error(`Missing release credential: ${name}.`);
if (missing.length > 0) process.exit(1);
if (release === null) {
	console.error(`The tag "${tag}" is not v<major>.<minor>.<patch> or v<version>-<pre-release>.`);
	process.exit(64);
}
if ((process.env.APPLE_API_KEY ?? "").trim() === "") {
	console.error("APPLE_API_KEY is not set to the App Store Connect key file.");
	process.exit(1);
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

const tauriDir = join(root, "apps/desktop/src-tauri");
const appPath = join(
	tauriDir,
	"target",
	RELEASE_TARGET,
	"release",
	"bundle",
	"macos",
	"Conducted.app",
);
const dmgPath = diskImagePath(appPath);
const archivePath = updaterArchivePath(appPath);
const signaturePath = `${archivePath}.sig`;
const feedPath = join(dirname(dmgPath), FEED_FILE_NAME);

const identity = (process.env.APPLE_SIGNING_IDENTITY ?? "").trim();
const env: Record<string, string | undefined> = {
	...process.env,
	[SIGNING_IDENTITY_ENV]: identity,
};

/**
 * The build's environment without any credential. Tauri signs and notarises by itself when Apple's
 * variables are present, and this release signs and notarises once, after the build. The updater key
 * stays out too, because the build runs the packages' own build code.
 */
function unsignedBuildEnv(): Record<string, string | undefined> {
	const copy: Record<string, string | undefined> = { ...process.env };
	for (const name of [
		SIGNING_IDENTITY_ENV,
		"APPLE_API_KEY",
		"APPLE_API_KEY_ID",
		"APPLE_API_ISSUER",
		"APPLE_ID",
		"APPLE_PASSWORD",
		"APPLE_TEAM_ID",
		"APPLE_CERTIFICATE_P12",
		"APPLE_CERTIFICATE_PASSWORD",
		"APPLE_NOTARY_PROFILE",
	]) {
		delete copy[name];
	}
	delete copy.TAURI_SIGNING_PRIVATE_KEY;
	delete copy.TAURI_SIGNING_PRIVATE_KEY_PASSWORD;
	return copy;
}

try {
	// The sidecar binary is built first because the release config lists it as an external binary.
	sh(["pnpm", "--filter", "@conducted/sidecar", "build"]);
	// The deploy inputs the app carries (D109): the bundled Worker, the sandbox Dockerfile and the
	// image's build output. `tauri build` copies them from `src-tauri/resources/cloud`.
	sh(["bun", "scripts/cloud/prepare-deploy.ts"]);
	// The build gets no credential: it runs the packages' build code. The release config makes no
	// update archive, because the archive must be made from the notarised app; only `tauri signer
	// sign` below sees the updater key.
	sh(
		appBuildArguments(RELEASE_TARGET, "src-tauri/tauri.release.conf.json"),
		root,
		unsignedBuildEnv(),
	);
	await must(signBundle(runTool, appPath, env));
	await must(notariseBundle(runTool, appPath, env));

	const config = JSON.parse(readFileSync(join(tauriDir, "tauri.conf.json"), "utf8")) as {
		identifier: string;
	};
	const expected: ExpectedBundle = {
		identifier: config.identifier,
		version: release.version,
		notarised: true,
	};
	rejectProblems(await must(verifyBundle(runTool, appPath)), expected);

	await must(createDiskImage(runTool, appPath, dmgPath));
	await must(notariseDiskImage(runTool, dmgPath, env));
	rejectProblems(
		await must(verifyDiskImage(runTool, dmgPath, basename(appPath), expected)),
		expected,
	);

	// Neither the unsigned archive nor its signature may ship. The archive is made again from the
	// signed, notarised app, and signed with the updater key.
	if (existsSync(signaturePath)) rmSync(signaturePath, { force: true });
	sh(["tar", "-czf", archivePath, "-C", dirname(appPath), basename(appPath)], root, {
		...process.env,
		COPYFILE_DISABLE: "1",
	});
	sh(["pnpm", "--filter", "@conducted/desktop", "tauri", "signer", "sign", archivePath], root, {
		...process.env,
		TAURI_SIGNING_PRIVATE_KEY: process.env.TAURI_SIGNING_PRIVATE_KEY,
		TAURI_SIGNING_PRIVATE_KEY_PASSWORD: process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD,
	});
	if (!existsSync(signaturePath)) {
		throw new Error(`tauri signer sign wrote no signature at ${signaturePath}.`);
	}

	const feed = updaterFeed({
		version: release.version,
		notes: `v${release.version}`,
		pubDate: new Date(),
		archiveName: basename(archivePath),
		signature: readFileSync(signaturePath, "utf8"),
	});
	writeFileSync(feedPath, `${JSON.stringify(feed, null, 2)}\n`);
} catch (error) {
	console.error((error as Error).message);
	process.exit(1);
}

const outputs = [
	`dmg=${dmgPath}`,
	`archive=${archivePath}`,
	`signature=${signaturePath}`,
	`feed=${feedPath}`,
];
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${outputs.join("\n")}\n`);
console.log(outputs.join("\n"));
