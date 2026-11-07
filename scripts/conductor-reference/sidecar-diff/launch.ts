/**
 * Starts one sidecar inside a seal (seal.ts) for the differential run, and stops it again.
 *
 * - "conductor": Conductor's `conductor-runtime sidecar`, from the app bundle in place, with the
 *   folder variables its Rust shell sets (native-and-sidecar-map.md A6 and B4) pointed into the seal.
 *   The HTTP bootstrap variable is left out, so it serves no HTTP port. Telemetry is switched off,
 *   and the sandbox refuses the network in any case.
 * - "ours": our sidecar from this checkout (`packages/sidecar/src/main.ts sidecar`) with the variables
 *   of config.ts pointed into the seal.
 * - Both print `SOCKET_PATH=<path>` on stdout; the launcher waits for that line (bounded) and keeps
 *   stderr for the report. `stop` sends SIGTERM to the pid it started, then SIGKILL if the process is
 *   still there after a grace period.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { CONDUCTOR_BIN, CONDUCTOR_RUNTIME, type Seal } from "./seal.ts";

export type Side = "conductor" | "ours";

const OUR_MAIN = join(import.meta.dir, "../../../packages/sidecar/src/main.ts");
const OUR_BIN = join(import.meta.dir, "../../../bin");

export interface Running {
	side: Side;
	pid: number;
	socketPath: string;
	stderr: () => string;
	stop: () => Promise<number | null>;
}

function sideEnv(side: Side, seal: Seal): Record<string, string> {
	const dir = (name: string) => {
		const path = join(seal.data, name);
		mkdirSync(path, { recursive: true });
		return path;
	};
	if (side === "conductor")
		return {
			...seal.env,
			CONDUCTOR_EXTERNAL_LOGGING_DISABLED: "1",
			CONDUCTOR_INTERNAL_BIN_DIR: CONDUCTOR_BIN,
			CONDUCTOR_AGENT_BINARIES_DIR: dir("agent-binaries"),
			CONDUCTOR_ACP_PROVIDERS_DIR: dir("acp-providers"),
			CONDUCTOR_SESSION_EVENT_OUTBOX_ROOT: dir("outbox"),
			CONDUCTOR_SIDECAR_V2_COMPLETIONS_DIR: dir("completions"),
			CONDUCTOR_CURSOR_STORE_DIR: dir("cursor-store"),
		};
	return {
		...seal.env,
		CONDUCTED_BIN_DIR: OUR_BIN,
		CONDUCTED_AGENT_BINARIES_DIR: dir("agent-binaries"),
		CONDUCTED_OUTBOX_ROOT: dir("outbox"),
		CONDUCTED_COMPLETIONS_DIR: dir("completions"),
		CONDUCTED_CURSOR_STORE_DIR: dir("cursor-store"),
		CONDUCTED_LOG_DIR: dir("log"),
		CONDUCTED_APP_VERSION: "0.0.0-sdiff",
		CONDUCTED_LOG_LEVEL: "info",
		CONDUCTED_PARENT_PID: String(process.pid),
	};
}

function command(side: Side): string[] {
	return side === "conductor"
		? [CONDUCTOR_RUNTIME, "sidecar"]
		: [process.execPath, OUR_MAIN, "sidecar"];
}

export async function startSidecar(side: Side, seal: Seal, timeoutMs = 20_000): Promise<Running> {
	const child: ChildProcess = spawn("sandbox-exec", ["-f", seal.profile, ...command(side)], {
		cwd: seal.home,
		env: sideEnv(side, seal),
		stdio: ["pipe", "pipe", "pipe"],
	});
	let stdout = "";
	let stderr = "";
	child.stdout?.setEncoding("utf8");
	child.stderr?.setEncoding("utf8");
	child.stderr?.on("data", (chunk: string) => {
		stderr += chunk;
	});
	const exited = new Promise<number | null>((resolve) =>
		child.once("close", (code) => resolve(code)),
	);
	const socketPath = await new Promise<string>((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error(`${side} printed no SOCKET_PATH in ${timeoutMs} ms`)),
			timeoutMs,
		);
		child.stdout?.on("data", (chunk: string) => {
			stdout += chunk;
			const found = /^SOCKET_PATH=(.+)$/m.exec(stdout);
			if (found?.[1] !== undefined) {
				clearTimeout(timer);
				resolve(found[1].trim());
			}
		});
		child.once("error", (cause) => {
			clearTimeout(timer);
			reject(cause);
		});
		child.once("close", (code) => {
			clearTimeout(timer);
			reject(
				new Error(`${side} ended before its handshake (exit ${code}): ${stderr.slice(-2000)}`),
			);
		});
	});
	const pid = child.pid as number;
	return {
		side,
		pid,
		socketPath,
		stderr: () => stderr,
		stop: async () => {
			if (child.exitCode !== null || child.signalCode !== null) return child.exitCode;
			child.kill("SIGTERM");
			const timer = setTimeout(() => {
				if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
			}, 5000);
			const code = await exited;
			clearTimeout(timer);
			return code;
		},
	};
}
