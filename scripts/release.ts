/**
 * Cuts a release as one command that stops at its first failure (PLAT-37, PLAT-39).
 *
 * Usage:
 *   pnpm release 0.2.0          dry run: says every step and how to undo it, changes nothing
 *   pnpm release 0.2.0 --go     does it: check main's CI, bump versions, write CHANGELOG.md, commit, tag
 *
 * It runs no tests on this Mac: it releases only origin/main's HEAD, and only when main's CI passed
 * for it (the owner's ruling, 2026-11-06). The dry run makes the same read-only checks, so it says
 * whether --go would refuse.
 *
 * It does not build. Pushing the tag starts .github/workflows/release.yml, which builds, signs,
 * notarises, attests and publishes the files on a GitHub-hosted macOS runner (PLAT-37, PLAT-38).
 * The notes are written here from the commit subjects since the last tag, into CHANGELOG.md; the
 * workflow cuts the GitHub release body from that version's section (PLAT-39).
 *
 * It never pushes and never publishes. The last line prints the one push command.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setVersion, VERSION_FILES } from "./guards/versions.ts";
import { addRelease, releaseSection } from "./release/changelog.ts";
import { type CiRun, ciGate } from "./release/gates.ts";
import { type ReleaseStepId, releasePlan } from "./release/plan.ts";

const root = join(import.meta.dir, "..");
const version = process.argv[2];
const go = process.argv.includes("--go");

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
	console.error("Usage: pnpm release <major.minor.patch> [--go]");
	process.exit(64);
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

function gate<T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): T {
	if (!result.ok) throw new Error(result.error.message);
	return result.value;
}

/** The newest reachable tag, or null when the repository has none. */
function lastTag(): string | null {
	const result = Bun.spawnSync(["git", "describe", "--tags", "--abbrev=0"], {
		stdout: "pipe",
		stderr: "ignore",
	});
	return result.exitCode === 0 ? result.stdout.toString().trim() : null;
}

/** The commit subjects since the last tag, newest first, as `git log` lists them. */
function commitsSince(tag: string | null): string[] {
	const range = tag === null ? "HEAD" : `${tag}..HEAD`;
	return sh(["git", "log", range, "--format=%s"])
		.split("\n")
		.filter((line) => line !== "");
}

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
		// Cargo.lock follows Cargo.toml through cargo itself; the other files are written in place.
		for (const file of VERSION_FILES) {
			if (file.endsWith(".json") || file.endsWith("Cargo.lock")) continue;
			const path = join(root, file);
			writeFileSync(path, setVersion(file, readFileSync(path, "utf8") as string, version));
		}
		sh(
			["cargo", "update", "--package", "conducted", "--offline"],
			join(root, "apps/desktop/src-tauri"),
		);
		sh([
			"node_modules/.bin/biome",
			"format",
			"--write",
			...VERSION_FILES.filter((f) => f.endsWith(".json")),
		]);
	},
	changelog: () => {
		const path = join(root, "CHANGELOG.md");
		const existing = existsSync(path) ? readFileSync(path, "utf8") : "# Changelog\n";
		const date = new Date().toISOString().slice(0, 10);
		const section = releaseSection({ version, date, commits: commitsSince(lastTag()) });
		writeFileSync(path, addRelease(existing, section));
	},
	commit: () => {
		sh(["git", "add", ...VERSION_FILES, "CHANGELOG.md"]);
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
if (go) {
	console.log(`\nDone. Publish with: git push origin main v${version}`);
} else {
	console.log("\nNothing was changed.");
}
