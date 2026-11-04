/**
 * Cuts a release as one command that stops at its first failure.
 *
 * Usage:
 *   pnpm release 0.2.0          dry run: says every step and how to undo it, changes nothing
 *   pnpm release 0.2.0 --go     does it: bump versions, run every check, commit, tag
 *
 * It never pushes. The last line prints the push command, so publishing stays a separate,
 * deliberate step.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { VERSION_FILES } from "./guards/versions.ts";

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
	run: () => void;
}

function sh(cmd: string[], cwd = root): string {
	const result = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
	if (result.exitCode !== 0) {
		throw new Error(
			`${cmd.join(" ")} failed:\n${result.stderr.toString()}${result.stdout.toString()}`,
		);
	}
	return result.stdout.toString().trim();
}

const tauriDir = join(root, "apps/desktop/src-tauri");
const steps: Step[] = [
	{
		say: "Check the tree is clean and on main",
		undo: "nothing to undo",
		run: () => {
			if (sh(["git", "status", "--porcelain"]) !== "")
				throw new Error("The working tree has changes.");
			if (sh(["git", "branch", "--show-current"]) !== "main") throw new Error("Not on main.");
			if (sh(["git", "tag", "--list", `v${version}`]) !== "")
				throw new Error(`v${version} exists.`);
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
		say: "Run every check (pnpm check, cargo fmt, clippy, test)",
		undo: "git checkout -- . (drops the version bump)",
		run: () => {
			sh(["pnpm", "check"]);
			sh(["cargo", "fmt", "--check"], tauriDir);
			sh(["cargo", "clippy", "--all-targets", "--", "-D", "warnings"], tauriDir);
			sh(["cargo", "test"], tauriDir);
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
	if (!go) continue;
	try {
		step.run();
	} catch (error) {
		console.error(`\nStopped at step ${index + 1}: ${(error as Error).message}`);
		process.exit(1);
	}
}
console.log(
	go ? `\nDone. Publish with: git push origin main v${version}` : "\nNothing was changed.",
);
