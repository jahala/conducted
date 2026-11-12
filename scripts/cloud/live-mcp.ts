/**
 * @feature CLOUD-17 MCP servers in the cloud sandbox
 * Owns: the one command for CLOUD-17's live run on the owner's Cloudflare account.
 * - Builds the deploy inputs (`pnpm cloud:prepare`), then runs the ignored Rust test
 *   `apps/desktop/src-tauri/tests/cloud_c17_live.rs`, which deploys a throwaway
 *   `conducted-dev-c17l-<time>` Worker and sandbox, proves an agent in the sandbox lists and calls
 *   a bearer-token MCP server, searches the sandbox for the token, and deletes what it made.
 * - On every ending, failure included, moves the deploy inputs this run built to the Trash, so a
 *   checkout that had none is left with none.
 * - With `--cleanup` it runs the test's `remove_leftover_c17_deployments` instead, for a run that
 *   was killed before its own teardown.
 * Needs: the wrangler login on this Mac, Docker and `cloudflared` on the PATH. The Rust build uses
 * `CARGO_TARGET_DIR` when it is set.
 * Usage: pnpm cloud:live-mcp [--cleanup]
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "../..");
const tauri = join(root, "apps/desktop/src-tauri");
/**
 * The folders `pnpm cloud:prepare` writes (scripts/cloud/prepare-deploy.ts), children before the
 * parent it may also have made.
 */
const BUILT = [
	join(tauri, "resources/cloud"),
	join(tauri, "resources"),
	join(root, "apps/cloud/sandbox/build"),
];

function run(command: string, args: string[], cwd: string): number {
	const result = spawnSync(command, args, { cwd, stdio: "inherit" });
	return result.status ?? 1;
}

const cleanup = process.argv.includes("--cleanup");
const existed = BUILT.map((path) => existsSync(path));
let code = run("pnpm", ["cloud:prepare"], root);
if (code === 0) {
	code = run(
		"cargo",
		[
			"test",
			"--test",
			"cloud_c17_live",
			cleanup ? "remove_leftover_c17_deployments" : "an_agent_in_the_sandbox",
			"--",
			"--ignored",
			"--nocapture",
			"--test-threads",
			"1",
		],
		tauri,
	);
}
BUILT.forEach((path, index) => {
	if (!existed[index] && existsSync(path) && run("trash", [path], root) !== 0) {
		console.error(`Could not move ${path} to the Trash.`);
		code = code === 0 ? 1 : code;
	}
});
process.exit(code);
