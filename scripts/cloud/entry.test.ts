/**
 * @feature CLOUD-04 Sandbox image with git, gh, the agent programs and our sidecar
 * Tests the container's main process: it sets the sidecar's folders, starts the real sidecar,
 * answers its health check and relays one JSON-RPC request over the sandbox port.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sandboxEnvironment, sidecarHandshake } from "../../apps/cloud/sandbox/entry.ts";
import { buildSidecar } from "../../packages/sidecar/src/packaging.ts";
import { hostSidecarTarget } from "../../packages/sidecar/src/test-support/host-target.ts";

const root = fileURLToPath(new URL("../..", import.meta.url));
const SIDECAR_DIR = path.join(root, "packages/sidecar");
const ENTRY = path.join(root, "apps/cloud/sandbox/entry.ts");
const BIN_DIR = path.join(root, "bin");
const HANG_LIMIT_MS = 90_000;

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe("CLOUD-04 the sandbox entry point", () => {
	test("CLOUD-04 the sidecar gets its folders, the bin folder first on PATH and the sandbox flag", () => {
		const dirs = {
			binDir: "/opt/conducted/bin",
			agentBinariesDir: "/opt/conducted/agent-binaries",
			outboxRoot: "/var/conducted/outbox",
			completionsDir: "/var/conducted/completions",
			cursorStoreDir: "/var/conducted/cursor-sdk-store",
			logDir: "/var/conducted/log",
		};
		const env = sandboxEnvironment(
			{ PATH: "/usr/bin:/bin", HOME: "/root", SHELL: "/bin/bash" },
			dirs,
		);
		expect(env.CONDUCTED_BIN_DIR).toBe(dirs.binDir);
		expect(env.CONDUCTED_AGENT_BINARIES_DIR).toBe(dirs.agentBinariesDir);
		expect(env.CONDUCTED_OUTBOX_ROOT).toBe(dirs.outboxRoot);
		expect(env.CONDUCTED_COMPLETIONS_DIR).toBe(dirs.completionsDir);
		expect(env.CONDUCTED_CURSOR_STORE_DIR).toBe(dirs.cursorStoreDir);
		expect(env.CONDUCTED_LOG_DIR).toBe(dirs.logDir);
		expect(env.CONDUCTED_LOG_LEVEL).toBe("info");
		expect(env.CLAUDE_CODE_SANDBOXED).toBe("1");
		expect(env.PATH).toBe(`${dirs.binDir}:/usr/bin:/bin`);
	});

	test("CLOUD-04 only the SOCKET_PATH handshake line names the sidecar's socket", () => {
		expect(sidecarHandshake("SOCKET_PATH=/tmp/conducted-sidecar-1.sock\n")).toBe(
			"/tmp/conducted-sidecar-1.sock",
		);
		for (const line of ["", "hello\n", "SOCKET_PATH=\n"]) {
			expect(sidecarHandshake(line)).toBeNull();
		}
	});

	test(
		"CLOUD-04 the real sidecar answers one request through the entry's WebSocket",
		async () => {
			const folder = await mkdtemp(path.join(tmpdir(), "cloud04-entry-"));
			cleanups.push(() => rm(folder, { recursive: true, force: true }));
			const sidecarOut = path.join(folder, "conducted-sidecar");
			const code = buildSidecar(hostSidecarTarget(), sidecarOut, (argv) => {
				const child = Bun.spawnSync([...argv], {
					cwd: SIDECAR_DIR,
					stdout: "inherit",
					stderr: "inherit",
				});
				return child.exitCode ?? 1;
			});
			expect(code).toBe(0);
			await expect(stat(sidecarOut)).resolves.toBeDefined();

			const home = path.join(folder, "home");
			await mkdir(home, { recursive: true });
			const child = spawn(process.execPath, [ENTRY], {
				env: {
					PATH: "/usr/bin:/bin",
					HOME: home,
					SHELL: "/bin/sh",
					TMPDIR: folder,
					CONDUCTED_SIDECAR_BIN: sidecarOut,
					CONDUCTED_BIN_DIR: BIN_DIR,
					CONDUCTED_AGENT_BINARIES_DIR: path.join(folder, "agent-binaries"),
					CONDUCTED_OUTBOX_ROOT: path.join(folder, "outbox"),
					CONDUCTED_COMPLETIONS_DIR: path.join(folder, "completions"),
					CONDUCTED_CURSOR_STORE_DIR: path.join(folder, "cursor-sdk-store"),
					CONDUCTED_LOG_DIR: path.join(folder, "log"),
					CONDUCTED_APP_VERSION: "0.0.0",
					CONDUCTED_LOG_LEVEL: "info",
					CONDUCTED_SANDBOX_PORT: "0",
					CONDUCTED_WORKSPACE: folder,
				},
				stdio: ["ignore", "pipe", "pipe"],
			});
			let out = "";
			let errText = "";
			child.stdout?.setEncoding("utf8");
			child.stderr?.setEncoding("utf8");
			child.stderr?.on("data", (chunk: string) => {
				errText += chunk;
			});
			const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
				(resolve, reject) => {
					child.once("error", reject);
					child.once("close", (exitCode, signal) => resolve({ code: exitCode, signal }));
				},
			);
			cleanups.push(async () => {
				if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
				await exited.catch(() => {});
			});

			const port = await new Promise<number>((resolve, reject) => {
				child.stdout?.on("data", (chunk: string) => {
					out += chunk;
					const listening = /^LISTENING=(\d+)\n/m.exec(out);
					if (listening?.[1] !== undefined) resolve(Number(listening[1]));
				});
				exited.then(
					(ended) =>
						reject(
							new Error(
								`The entry ended (code ${ended.code}, signal ${ended.signal}) before it listened. stderr: ${errText}`,
							),
						),
					reject,
				);
			});

			const healthy = await waitForHealth(port);
			expect(healthy).toBe(true);

			const request = {
				jsonrpc: "2.0",
				id: 1,
				method: "getSessionStatus",
				params: { sessionId: randomUUID() },
			};
			const reply = await overWebSocket(port, request);
			expect(reply).toEqual({ jsonrpc: "2.0", id: 1, result: { known: false } });

			child.kill("SIGTERM");
			const ended = await exited;
			expect(ended.code).toBe(0);
		},
		HANG_LIMIT_MS,
	);
});

/** Waits for the entry's health route, with a bound so a broken start fails instead of hanging. */
async function waitForHealth(port: number): Promise<boolean> {
	for (let attempt = 0; attempt < 100; attempt++) {
		try {
			const response = await fetch(`http://127.0.0.1:${port}/health`);
			if (response.ok) return true;
		} catch {
			// The server is not listening yet; the next attempt is soon.
		}
		await Bun.sleep(50);
	}
	return false;
}

function overWebSocket(port: number, request: unknown): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const socket = new WebSocket(`ws://127.0.0.1:${port}/rpc`);
		socket.onopen = () => socket.send(`${JSON.stringify(request)}\n`);
		socket.onmessage = async (event) => {
			try {
				const line = JSON.parse(await messageText(event.data)) as { id?: unknown };
				if (line.id !== (request as { id: number }).id) return;
				socket.close();
				resolve(line);
			} catch (cause) {
				socket.close();
				reject(cause);
			}
		};
		socket.onerror = () => reject(new Error("The WebSocket failed before a reply arrived"));
	});
}

/** The relay sends the sidecar's bytes unchanged, so a reply may arrive as text or binary. */
async function messageText(data: unknown): Promise<string> {
	if (typeof data === "string") return data;
	if (data instanceof Blob) return data.text();
	if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
	return String(data);
}
