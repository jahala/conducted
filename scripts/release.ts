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
 * It never pushes. The last line prints the push command, so publishing stays a separate,
 * deliberate step.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
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

const root = join(import.meta.dir, "..");
const version = process.argv[2];
const go = process.argv.includes("--go");

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
	console.error("Usage: pnpm release <major.minor.patch> [--go]");
	process.exit(64);
}

interface Step {
	say: string;
	undo: string;
	/** A step that changes nothing also runs in the dry run, so the dry run says whether --go would stop. */
	readOnly?: true;
	run: () => void | Promise<void>;
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

function sh(cmd: readonly string[], cwd = root): string {
	const result = Bun.spawnSync([...cmd], { cwd, stdout: "pipe", stderr: "pipe" });
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

let notarised = false;
const tauriDir = join(root, "apps/desktop/src-tauri");
const steps: Step[] = [
	{
		say: "Check the tree is clean, on main at origin/main, and main's CI passed for it",
		undo: "nothing to undo",
		readOnly: true,
		run: () => {
			if (sh(["git", "status", "--porcelain"]) !== "")
				throw new Error("The working tree has changes.");
			if (sh(["git", "branch", "--show-current"]) !== "main") throw new Error("Not on main.");
			if (sh(["git", "tag", "--list", `v${version}`]) !== "")
				throw new Error(`v${version} exists.`);
			sh(["git", "fetch", "--quiet", "origin", "main"]);
			const head = sh(["git", "rev-parse", "HEAD"]);
			const runs = JSON.parse(
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
			gate(ciGate({ head, mainHead: sh(["git", "rev-parse", "origin/main"]), runs }));
		},
	},
	{
		say: `Set version ${version} in ${VERSION_FILES.join(", ")}`,
		undo: "git checkout -- <those files>",
		run: () => {
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
	},
	{
		say: "Install the locked packages, build the arm64 app alone, sign and notarise it, then make and verify the disk image",
		undo: "git checkout -- . (drops the version bump); build output stays under apps/desktop/src-tauri/target",
		run: async () => {
			const env: Record<string, string | undefined> = {
				...process.env,
				[SIGNING_IDENTITY_ENV]: signingIdentity(),
			};
			const notarise = Boolean(env[NOTARY_PROFILE_ENV]?.trim()) || notaryProfileExists();
			if (notarise && !env[NOTARY_PROFILE_ENV]?.trim()) env[NOTARY_PROFILE_ENV] = NOTARY_PROFILE;
			// The build uses exactly the packages main's lockfile names, whatever this checkout had installed.
			sh(["pnpm", "install", "--frozen-lockfile"]);
			sh(["pnpm", "--filter", "@conducted/sidecar", "build"]);
			sh(appBuildArguments("aarch64-apple-darwin", "src-tauri/tauri.release.conf.json"));
			const appPath = join(
				tauriDir,
				"target",
				"aarch64-apple-darwin",
				"release",
				"bundle",
				"macos",
				"Conducted.app",
			);
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

			const dmgPath = diskImagePath(appPath);
			await must(createDiskImage(runTool, appPath, dmgPath));
			if (notarise) await must(notariseDiskImage(runTool, dmgPath, env));
			notarised = notarise;
			rejectProblems(
				await must(verifyDiskImage(runTool, dmgPath, basename(appPath), expected)),
				expected,
			);
		},
	},
	{
		say: `Commit "release: v${version}" and tag v${version}`,
		undo: `git tag -d v${version} && git revert HEAD`,
		run: () => {
			sh(["git", "add", ...VERSION_FILES]);
			sh(["git", "commit", "-m", `release: v${version}`]);
			sh(["git", "tag", "-a", `v${version}`, "-m", `v${version}`]);
		},
	},
];

console.log(go ? `Releasing v${version}` : `Dry run for v${version} (add --go to do it)`);
for (const [index, step] of steps.entries()) {
	console.log(`${index + 1}. ${step.say}\n   undo: ${step.undo}`);
	if (!go && !step.readOnly) continue;
	try {
		await step.run();
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
console.log(
	go ? `\nDone. Publish with: git push origin main v${version}` : "\nNothing was changed.",
);
