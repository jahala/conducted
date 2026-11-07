/**
 * @feature CLOUD-04 Sandbox image with git, gh, the agent programs and our sidecar
 * Tests the Linux build of the sidecar: the target parameter, the compile command, and one real
 * compiled program started and answering one JSON-RPC request.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCloudBuildArgs } from "./cloud-build.ts";
import { PARENT_PID_ENV } from "./modes/sidecar-mode.ts";
import {
	buildSidecar,
	CLOUD_SIDECAR_TARGET,
	compileArguments,
	SIDECAR_TARGETS,
} from "./packaging.ts";
import { encodeLine, LineDecoder } from "./rpc/ndjson.ts";
import { hostSidecarTarget } from "./test-support/host-target.ts";

const SIDECAR_DIR = fileURLToPath(new URL("..", import.meta.url));
const BIN_DIR = fileURLToPath(new URL("../../../bin", import.meta.url));
/** Only catches a hang. A compiled program starts in well under a second. */
const HANG_LIMIT_MS = 60_000;

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe("CLOUD-04 the sidecar's Linux build", () => {
	test("CLOUD-04 the default target is the baseline Linux build and the image's build folder", () => {
		const parsed = parseCloudBuildArgs([]);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.value.target).toEqual(CLOUD_SIDECAR_TARGET);
		expect(parsed.value.outFile.endsWith("apps/cloud/sandbox/build/conducted-sidecar")).toBe(true);
	});

	test("CLOUD-04 the target is a parameter, so the same builder makes the Mac and the Linux program", () => {
		const arm64 = SIDECAR_TARGETS.find((target) => target.arch === "arm64");
		expect(arm64).toBeDefined();
		if (arm64 === undefined) return;
		const parsed = parseCloudBuildArgs(["--target", "darwin-arm64", "--out", "/tmp/sidecar"]);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.value.target).toEqual(arm64);
		expect(parsed.value.outFile).toBe("/tmp/sidecar");
	});

	test("CLOUD-04 an unknown target is an error value that names it", () => {
		const parsed = parseCloudBuildArgs(["--target", "linux-arm64"]);
		expect(parsed.ok).toBe(false);
		if (parsed.ok) return;
		expect(parsed.error.message).toContain("linux-arm64");
	});

	test("CLOUD-04 the Linux target uses the baseline build, which needs no AVX2", () => {
		const command = compileArguments(CLOUD_SIDECAR_TARGET, "/tmp/out");
		expect(command).toContain("bun-linux-x64-baseline");
		expect(command.join(" ")).toContain("conducted-sidecar");
	});

	test(
		"CLOUD-04 the built file starts and answers one JSON-RPC request",
		async () => {
			const folder = await mkdtemp(path.join(tmpdir(), "cloud04-build-"));
			cleanups.push(() => rm(folder, { recursive: true, force: true }));
			const outFile = path.join(folder, "conducted-sidecar");
			const target = hostSidecarTarget();
			const code = buildSidecar(target, outFile, (argv) => {
				const child = Bun.spawnSync([...argv], {
					cwd: SIDECAR_DIR,
					stdout: "inherit",
					stderr: "inherit",
				});
				return child.exitCode ?? 1;
			});
			expect(code).toBe(0);
			await expect(stat(outFile)).resolves.toBeDefined();

			const reply = await oneRequest(outFile, folder);
			expect(reply).toEqual({ jsonrpc: "2.0", id: 1, result: { known: false } });
		},
		HANG_LIMIT_MS,
	);
});

/** Starts a compiled sidecar and sends one `getSessionStatus` request over its socket. */
async function oneRequest(program: string, folder: string): Promise<unknown> {
	const home = path.join(folder, "home");
	await mkdir(home, { recursive: true });
	// A login shell that finds only the system programs, so the detector starts no agent from this
	// Mac while the test checks the compiled sidecar's one request. The fallback capture uses zsh.
	const profile = "PATH=/usr/bin:/bin\nexport PATH\n";
	await writeFile(path.join(home, ".profile"), profile);
	await writeFile(path.join(home, ".zprofile"), profile);
	const child = spawn(program, ["sidecar"], {
		env: {
			PATH: "/usr/bin:/bin",
			HOME: home,
			SHELL: "/bin/sh",
			TMPDIR: folder,
			CONDUCTED_BIN_DIR: BIN_DIR,
			CONDUCTED_OUTBOX_ROOT: path.join(folder, "outbox"),
			CONDUCTED_COMPLETIONS_DIR: path.join(folder, "completions"),
			CONDUCTED_CURSOR_STORE_DIR: path.join(folder, "cursor-sdk-store"),
			CONDUCTED_AGENT_BINARIES_DIR: path.join(folder, "agent-binaries"),
			CONDUCTED_LOG_DIR: path.join(folder, "log"),
			CONDUCTED_APP_VERSION: "0.0.0",
			CONDUCTED_LOG_LEVEL: "info",
			[PARENT_PID_ENV]: String(process.pid),
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
			child.once("close", (code, signal) => resolve({ code, signal }));
		},
	);
	cleanups.push(async () => {
		if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
		await exited.catch(() => {});
	});

	const socketPath = await new Promise<string>((resolve, reject) => {
		child.stdout?.on("data", (chunk: string) => {
			out += chunk;
			const handshake = /^SOCKET_PATH=(.+)\n/m.exec(out);
			if (handshake?.[1] !== undefined) resolve(handshake[1]);
		});
		exited.then(
			(ended) =>
				reject(
					new Error(
						`The sidecar ended (code ${ended.code}, signal ${ended.signal}) before its handshake line. stderr: ${errText}`,
					),
				),
			reject,
		);
	});

	const request = {
		jsonrpc: "2.0" as const,
		id: 1,
		method: "getSessionStatus",
		params: { sessionId: randomUUID() },
	};
	const reply = await new Promise<unknown>((resolve, reject) => {
		const socket = createConnection(socketPath);
		socket.setEncoding("utf8");
		const decoder = new LineDecoder();
		socket.once("connect", () => socket.write(encodeLine(request)));
		socket.on("data", (chunk: string) => {
			for (const decoded of decoder.push(chunk)) {
				if (!decoded.ok) {
					socket.destroy();
					reject(decoded.error);
					return;
				}
				const line = decoded.value as { id?: unknown };
				if (line.id !== request.id) continue;
				socket.destroy();
				resolve(decoded.value);
				return;
			}
		});
		socket.once("error", reject);
		socket.once("close", () => reject(new Error("The socket closed before a reply arrived")));
	});

	child.kill("SIGTERM");
	await exited;
	return reply;
}
