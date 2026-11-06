/**
 * @feature SIDE-01 Entry point and modes: the "sidecar" mode, started as a real process
 * @feature SIDE-22 Slash command cache that works before a chat starts
 * Owns: proof that the real host starts the way the Rust shell starts it, prints the handshake
 * line, answers one request on its socket and exits 0 on SIGTERM, and that a saved slash-command
 * list answers a request made before any workspace exists.
 * Test first: this file. Before the app tools bridge start-up step was removed, the host exited
 * with "Not implemented: SIDE-13" before it printed the handshake line.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLogger } from "../logging/logger.ts";
import { createNodeCompletionsFiles, FileCompletionsCache } from "../models/completions-cache.ts";
import { encodeLine, LineDecoder } from "../rpc/ndjson.ts";
import { handshakeLine } from "../rpc/server.ts";
import { PARENT_PID_ENV } from "./sidecar-mode.ts";

const MAIN = fileURLToPath(new URL("../main.ts", import.meta.url));
const BIN_DIR = fileURLToPath(new URL("../../../../bin", import.meta.url));
/** Only catches a hang. The host starts in well under a second. */
const HANG_LIMIT_MS = 30_000;

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

interface HostRun {
	/** The path the host printed after SOCKET_PATH=. */
	socketPath: string;
	/** Resolves with the exit code and signal when the process ends. */
	exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
	child: ChildProcess;
	stdout(): string;
	stderr(): string;
}

/** A short folder name, because a Unix socket path is limited to about 100 characters. */
async function ownedFolder(): Promise<string> {
	const folder = await mkdtemp(path.join(tmpdir(), "cs-"));
	cleanups.push(() => rm(folder, { recursive: true, force: true }));
	return folder;
}

/**
 * Starts `main.ts sidecar` with the settings the Rust shell passes. The folder is the host's
 * TMPDIR (so its socket lands there) and its HOME (so nothing is written outside it).
 */
async function startHost(folder: string): Promise<HostRun> {
	const outboxRoot = path.join(folder, "outbox");
	const completionsDir = path.join(folder, "completions");
	const logDir = path.join(folder, "log");
	const home = path.join(folder, "home");
	await mkdir(home);
	const child = spawn(process.execPath, [MAIN, "sidecar"], {
		env: {
			PATH: "/usr/bin:/bin",
			HOME: home,
			SHELL: "/bin/sh",
			TMPDIR: folder,
			CONDUCTED_BIN_DIR: BIN_DIR,
			CONDUCTED_OUTBOX_ROOT: outboxRoot,
			CONDUCTED_COMPLETIONS_DIR: completionsDir,
			CONDUCTED_LOG_DIR: logDir,
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
	// Whatever happens, the process must be gone before the folder is removed.
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
						`The host ended (code ${ended.code}, signal ${ended.signal}) before its handshake line. stderr: ${errText}`,
					),
				),
			reject,
		);
	});
	return { socketPath, exited, child, stdout: () => out, stderr: () => errText };
}

/**
 * Sends one request line to the socket and returns the reply that carries the request's id.
 * The sidecar may send notifications (for example agentInstallsChanged) at any time, before or
 * after the reply, so lines without that id are skipped.
 */
function callOnce(
	socketPath: string,
	request: { jsonrpc: "2.0"; id: number; method: string; params: unknown },
): Promise<unknown> {
	return new Promise((resolve, reject) => {
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
}

describe("SIDE-01 the real sidecar host", () => {
	test(
		"SIDE-01 starts the app tools bridge, answers a request and exits 0 on SIGTERM",
		async () => {
			const folder = await ownedFolder();
			const host = await startHost(folder);

			expect(host.socketPath.startsWith(folder)).toBe(true);
			expect(host.stdout()).toBe(`${handshakeLine(host.socketPath)}\n`);
			const bridgeFolders = (await readdir(folder)).filter((name) => name.startsWith("cmcp-"));
			expect(bridgeFolders).toHaveLength(1);

			const reply = await callOnce(host.socketPath, {
				jsonrpc: "2.0",
				id: 1,
				method: "getSessionStatus",
				params: { sessionId: randomUUID() },
			});
			expect(reply).toEqual({ jsonrpc: "2.0", id: 1, result: { known: false } });

			host.child.kill("SIGTERM");
			const ended = await host.exited;
			expect(ended).toEqual({ code: 0, signal: null });
			// The only stdout line is still the handshake: logs go to stderr.
			expect(host.stdout()).toBe(`${handshakeLine(host.socketPath)}\n`);
			expect(host.stderr()).not.toContain("The sidecar could not start");
			// The socket file and the bridge folder are removed on a clean exit.
			await expect(stat(host.socketPath)).rejects.toMatchObject({ code: "ENOENT" });
			const remaining = (await readdir(folder)).filter((name) => name.startsWith("cmcp-"));
			expect(remaining).toEqual([]);
		},
		HANG_LIMIT_MS,
	);
});

describe("SIDE-22 the real sidecar host and the saved slash-command cache", () => {
	test(
		"SIDE-22 lists a saved repository's slash commands before a workspace exists",
		async () => {
			const folder = await ownedFolder();
			const cache = new FileCompletionsCache({
				dir: path.join(folder, "completions"),
				files: createNodeCompletionsFiles(),
				clock: { now: () => Date.now() },
				logger: createLogger({
					sink: () => {},
					clock: { now: () => 0 },
					level: "error",
					scope: "test",
				}),
			});
			const commands = [
				{
					name: "review",
					description: "Review the working tree",
					source: "project" as const,
					kind: "command" as const,
				},
			];
			const saved = await cache.write({ repoRootPath: "/code/app", agent: "claude" }, commands);
			expect(saved.ok).toBe(true);

			const host = await startHost(folder);
			const reply = await callOnce(host.socketPath, {
				jsonrpc: "2.0",
				id: 2,
				method: "listSlashCommands",
				params: { agent: "claude", repoRootPath: "/code/app" },
			});
			expect(reply).toEqual({
				jsonrpc: "2.0",
				id: 2,
				result: { commands, fromCache: true },
			});
			host.child.kill("SIGTERM");
			await host.exited;
		},
		HANG_LIMIT_MS,
	);
});
