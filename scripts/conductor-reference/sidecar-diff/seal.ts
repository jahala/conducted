/**
 * The sealed setup each sidecar of the differential run (diff.ts) starts in.
 *
 * - A fresh folder under /tmp holds everything the run writes: the home folder, the temp folder (the
 *   sidecar's socket lands there), every data folder the sidecar is told about, a small git
 *   repository the chats run in, the fake agent programs and the agents' log.
 * - The environment is built from nothing (no variable of this shell passes through): HOME, TMPDIR,
 *   a PATH of the fake programs' folder and the system folders only, and each sidecar's own folder
 *   variables. /usr/bin and /bin hold no `claude` or `codex`; `assertNoRealAgents` checks that.
 * - The sidecar runs under `sandbox-exec` with a profile that refuses every IP connection beyond
 *   this Mac's loopback, inbound and outbound, and every write under the owner's home folder. Unix
 *   sockets and 127.0.0.1 stay open: the app's socket needs the first, and Conductor's Codex runner
 *   serves a hook bridge on the second. `proveSealed` runs curl (to a name and to a bare address) and
 *   touch inside the same profile and fails the run unless all three are refused.
 * - `removeSeal` takes the folder away when the scenario ends, whatever happened in it.
 *
 * Conductor's program is run from the app bundle in place, read-only. Nothing of it is copied.
 */
import { spawnSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const CONDUCTOR_RUNTIME =
	"/Applications/Conductor.app/Contents/Resources/bin/.internal/conductor-runtime";
export const CONDUCTOR_BIN = "/Applications/Conductor.app/Contents/Resources/bin";

const FAKE_AGENT = join(import.meta.dir, "fake-agent.ts");
const SYSTEM_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";

export interface Seal {
	root: string;
	home: string;
	tmp: string;
	fakeBin: string;
	data: string;
	repo: string;
	agentLog: string;
	profile: string;
	/** The base environment: nothing from this shell. */
	env: Record<string, string>;
}

function profileText(ownerHome: string, execOutside: readonly string[]): string {
	return [
		"(version 1)",
		"(allow default)",
		// A sandboxed process may not run a setuid program; these run outside the sandbox instead.
		...execOutside.map(
			(program) => `(allow process-exec (literal ${JSON.stringify(program)}) (with no-sandbox))`,
		),
		"(deny network-outbound (remote ip))",
		"(deny network-inbound (local ip))",
		"(deny network-bind (local ip))",
		// Loopback stays open: Conductor's Codex runner serves its hook bridge on 127.0.0.1.
		'(allow network-bind (local ip "localhost:*"))',
		'(allow network-inbound (local ip "localhost:*"))',
		'(allow network-outbound (remote ip "localhost:*"))',
		`(deny file-write* (subpath ${JSON.stringify(ownerHome)}))`,
		"",
	].join("\n");
}

/** What a scenario sets up for the fake agents beyond the defaults. */
export interface SealOptions {
	/** The managed requirements the fake Codex answers `configRequirements/read` with. */
	codexRequirements?: Record<string, unknown>;
	/**
	 * Setuid system programs the sealed process may run, outside the sandbox (a sandboxed process
	 * cannot run a setuid program). Our app's shell reads the process table with `/bin/ps`.
	 */
	execOutside?: readonly string[];
}

/** A value quoted for a POSIX shell, so JSON passes through unchanged. */
const shellQuote = (value: string): string => `'${value.replaceAll("'", `'"'"'`)}'`;

function wrapper(agent: "claude" | "codex", agentLog: string, options: SealOptions): string {
	const requirements =
		options.codexRequirements === undefined
			? []
			: [
					`SDIFF_CODEX_REQUIREMENTS=${shellQuote(JSON.stringify(options.codexRequirements))}`,
					"export SDIFF_CODEX_REQUIREMENTS",
				];
	return [
		"#!/bin/sh",
		"# The fake agent program of the sidecar differential run.",
		`SDIFF_AGENT_LOG=${JSON.stringify(agentLog)}`,
		"export SDIFF_AGENT_LOG",
		...requirements,
		`exec ${JSON.stringify(process.execPath)} ${JSON.stringify(FAKE_AGENT)} ${agent} "$@"`,
		"",
	].join("\n");
}

/**
 * The login shell both sidecars capture their environment from. It is named `zsh`, so both pick
 * the `-ilc` form, and it runs the script with `zsh -f`: no system profile, so path_helper cannot
 * put the owner's Homebrew folder (and the real agents in it) back on the PATH.
 */
const LOGIN_SHELL = [
	"#!/bin/sh",
	"# The login shell stand-in of the sidecar differential run.",
	'eval "script=\\"\\$$#\\""',
	'exec /bin/zsh -f -c "$script"',
	"",
].join("\n");

function git(cwd: string, env: Record<string, string>, ...args: string[]): void {
	const done = spawnSync("git", args, { cwd, env, encoding: "utf8" });
	if (done.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${done.stderr}`);
}

export function makeSeal(label: string, options: SealOptions = {}): Seal {
	const root = realpathSync(mkdtempSync(`/tmp/sdiff-${label}-`));
	const home = join(root, "home");
	const tmp = join(root, "tmp");
	const fakeBin = join(root, "fakebin");
	const shellDir = join(root, "shell");
	const data = join(root, "data");
	const repo = join(root, "repo");
	for (const dir of [home, tmp, fakeBin, shellDir, data, repo]) mkdirSync(dir, { recursive: true });
	const agentLog = join(root, "agent-log.jsonl");
	writeFileSync(agentLog, "");
	for (const agent of ["claude", "codex"] as const) {
		const file = join(fakeBin, agent);
		writeFileSync(file, wrapper(agent, agentLog, options));
		chmodSync(file, 0o755);
	}
	const shell = join(shellDir, "zsh");
	writeFileSync(shell, LOGIN_SHELL);
	chmodSync(shell, 0o755);
	const profile = join(root, "deny-network.sb");
	writeFileSync(profile, profileText(homedir(), options.execOutside ?? []));
	const env: Record<string, string> = {
		HOME: home,
		TMPDIR: `${tmp}/`,
		PATH: `${fakeBin}:${SYSTEM_PATH}`,
		SHELL: shell,
		LANG: "en_US.UTF-8",
		USER: "sdiff",
		BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
		GIT_CONFIG_NOSYSTEM: "1",
	};
	const gitEnv = {
		...env,
		GIT_AUTHOR_NAME: "Sdiff",
		GIT_AUTHOR_EMAIL: "sdiff@example.invalid",
		GIT_COMMITTER_NAME: "Sdiff",
		GIT_COMMITTER_EMAIL: "sdiff@example.invalid",
	};
	git(repo, gitEnv, "init", "-q", "-b", "main");
	writeFileSync(join(repo, "README.md"), "# Fixture\n");
	git(repo, gitEnv, "add", "README.md");
	git(repo, gitEnv, "commit", "-q", "-m", "base");
	return { root, home, tmp, fakeBin, data, repo, agentLog, profile, env };
}

/** Fails unless the profile refuses outbound connections and a write under the owner's home. */
export function proveSealed(seal: Seal): {
	network: string;
	bareAddress: string;
	homeWrite: string;
} {
	const curl = spawnSync(
		"sandbox-exec",
		[
			"-f",
			seal.profile,
			"/usr/bin/curl",
			"-sS",
			"-m",
			"5",
			"-o",
			"/dev/null",
			"https://example.com",
		],
		{ env: seal.env, encoding: "utf8" },
	);
	if (curl.status === 0) throw new Error("the sandbox let curl reach the network");
	const bare = spawnSync(
		"sandbox-exec",
		["-f", seal.profile, "/usr/bin/curl", "-sS", "-m", "5", "-o", "/dev/null", "http://1.1.1.1"],
		{ env: seal.env, encoding: "utf8" },
	);
	if (bare.status === 0) throw new Error("the sandbox let curl reach a bare IP address");
	const probe = join(homedir(), `.sdiff-probe-${process.pid}`);
	const touch = spawnSync("sandbox-exec", ["-f", seal.profile, "/usr/bin/touch", probe], {
		env: seal.env,
		encoding: "utf8",
	});
	if (touch.status === 0 || existsSync(probe)) {
		if (existsSync(probe)) rmSync(probe);
		throw new Error("the sandbox let a write land in the owner's home folder");
	}
	return {
		network: curl.stderr.trim(),
		bareAddress: bare.stderr.trim(),
		homeWrite: touch.stderr.trim(),
	};
}

export function assertNoRealAgents(): void {
	for (const dir of SYSTEM_PATH.split(":"))
		for (const name of ["claude", "codex"])
			if (existsSync(join(dir, name))) throw new Error(`${dir}/${name} exists; PATH is not clean`);
}

export function removeSeal(seal: Seal): void {
	rmSync(seal.root, { recursive: true, force: true });
}
