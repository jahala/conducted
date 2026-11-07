/**
 * @feature SIDE-25 Sidecar adapters in their own edge modules
 * @feature SIDE-10 Login-shell environment capture
 * @feature SIDE-01 Entry point and modes
 * Owns: the sidecar's environment edge: the launcher environment, the process facts (pid, parent
 * pid, executable, platform, arch), a snapshot of the live process environment, and the login-shell
 * capture provider built from them.
 * Behaviour: research/conductor/native-and-sidecar-map.md B1, B3 "Shell env capture" and A6 step
 * 6. The parent pid comes from `CONDUCTED_PARENT_PID`, else the real parent. The login shell is
 * the user's `SHELL`, else `/bin/zsh`.
 * Must handle: a missing or invalid parent pid (fall back to the real parent), an environment
 * value that is undefined (left out of the snapshot), a live parent pid that changes (read again
 * on every call), and a capture failure (the provider reports it; this module invents no default).
 * Test first: the parent pid comes from the launcher environment and falls back to the real parent.
 * Our design choice: the factory takes the process facts and the spawn port, so the composition
 * root wires the real ones and the tests pass their own values.
 */
import { randomBytes } from "node:crypto";
import type { Logger } from "../logging/logger.ts";
import {
	FALLBACK_SHELL,
	LoginShellEnvProvider,
	type NotifyShellEnvFailure,
	type SpawnText,
} from "../shell-env/capture.ts";

/** The environment variable that holds the Rust shell's pid. */
export const PARENT_PID_ENV = "CONDUCTED_PARENT_PID";

/** The process facts the sidecar reads. Each is a function, so a live value is never frozen. */
export interface ProcessFacts {
	env: Readonly<Record<string, string | undefined>>;
	pid(): number;
	ppid(): number;
	execPath(): string;
	platform(): string;
	arch(): string;
}

/** The real process facts. */
export const nodeProcessFacts: ProcessFacts = {
	env: process.env,
	pid: () => process.pid,
	ppid: () => process.ppid,
	execPath: () => process.execPath,
	platform: () => process.platform,
	arch: () => process.arch,
};

export interface ProcessEnvironment {
	readonly pid: number;
	readonly ppid: number;
	readonly execPath: string;
	readonly platform: string;
	readonly arch: string;
	/** One snapshot of the live process environment as plain strings. */
	snapshot(): Record<string, string>;
	/** The live environment object, for a lock that writes into it (the Cursor SDK's). */
	target(): Readonly<Record<string, string | undefined>>;
	/** The Rust shell's pid from the launcher environment, else the real parent pid. */
	parentPid(launcherEnv: Readonly<Record<string, string | undefined>>): number;
}

/** Builds the environment edge from the process facts passed in. */
export function createProcessEnvironment(facts: ProcessFacts): ProcessEnvironment {
	return {
		get pid() {
			return facts.pid();
		},
		get ppid() {
			return facts.ppid();
		},
		get execPath() {
			return facts.execPath();
		},
		get platform() {
			return facts.platform();
		},
		get arch() {
			return facts.arch();
		},
		snapshot() {
			const out: Record<string, string> = {};
			for (const [key, value] of Object.entries(facts.env)) {
				if (value !== undefined) out[key] = value;
			}
			return out;
		},
		target() {
			return facts.env;
		},
		parentPid(launcherEnv) {
			const raw = launcherEnv[PARENT_PID_ENV];
			const parsed = raw === undefined ? Number.NaN : Number.parseInt(raw, 10);
			return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : facts.ppid();
		},
	};
}

/** A fresh marker for one login-shell capture. */
export function newEnvironmentMarker(): string {
	return `__conducted_env_${randomBytes(8).toString("hex")}__`;
}

export interface LoginShellEnvProviderDeps {
	/** The environment the Rust shell launched the sidecar with. */
	launcherEnv: Readonly<Record<string, string | undefined>>;
	logger: Logger;
	notifyFailure?: NotifyShellEnvFailure;
	/** Runs the capture command and collects its stdout. */
	spawnText: SpawnText;
	/** A new random marker for each capture. */
	newMarker(): string;
}

/** Builds the login-shell capture provider from the environment and spawn edges passed in. */
export function createLoginShellEnvProvider(
	deps: LoginShellEnvProviderDeps,
): LoginShellEnvProvider {
	return new LoginShellEnvProvider({
		spawnText: deps.spawnText,
		shellPath: deps.launcherEnv.SHELL ?? FALLBACK_SHELL,
		newMarker: deps.newMarker,
		logger: deps.logger,
		notifyFailure: deps.notifyFailure,
	});
}
