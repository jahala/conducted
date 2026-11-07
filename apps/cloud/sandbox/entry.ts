/**
 * @feature CLOUD-04 Sandbox image with git, gh, the agent programs and our sidecar
 * Owns: the container's main process. It sets the sidecar's folders and the sandbox flag, starts
 * the compiled sidecar, reads its `SOCKET_PATH=` handshake, and relays each WebSocket on the
 * sandbox port to that Unix socket. `GET /health` answers once the sidecar listens.
 * Behaviour: cloud-and-remote.md Part 1 ("The sidecar runs inside the sandbox unchanged") and the
 * CLOUD-02 spike's bridge, which showed the same relay working in a Cloudflare sandbox
 * (cloud-spike-2026-11-06.md); claude-runner.md 1.3 says a cloud sandbox adds
 * `CLAUDE_CODE_SANDBOXED=1`.
 * Must handle: the sidecar exiting (the container exits 1, never runs without an agent host); a
 * WebSocket that arrives before the handshake (503, not a made-up socket); a socket that closes
 * (the WebSocket closes with it); a port that is not a number (exit 64 with a message); a
 * termination signal (forward SIGTERM to the sidecar and wait for it, so its socket is removed).
 * Our design choice: the same three handshake lines the Rust shell uses locally, with the port
 * fixed by the image (`IMAGE.port`, overridable for a test or a local run). The relay carries bytes
 * unchanged; it never reads the JSON-RPC lines.
 * Test first: `sandboxEnvironment` puts `CONDUCTED_BIN_DIR` first on PATH and sets
 * `CLAUDE_CODE_SANDBOXED=1`.
 */
import { mkdirSync } from "node:fs";
import { IMAGE } from "./image.ts";

export interface SandboxDirs {
	binDir: string;
	agentBinariesDir: string;
	outboxRoot: string;
	completionsDir: string;
	cursorStoreDir: string;
	logDir: string;
}

/** The folders the sidecar needs, from the environment or the image's fixed layout. */
export function sandboxDirs(env: Readonly<Record<string, string | undefined>>): SandboxDirs {
	return {
		binDir: env.CONDUCTED_BIN_DIR ?? IMAGE.binDir,
		agentBinariesDir: env.CONDUCTED_AGENT_BINARIES_DIR ?? IMAGE.agentBinariesDir,
		outboxRoot: env.CONDUCTED_OUTBOX_ROOT ?? `${IMAGE.varDir}/outbox`,
		completionsDir: env.CONDUCTED_COMPLETIONS_DIR ?? `${IMAGE.varDir}/completions`,
		cursorStoreDir: env.CONDUCTED_CURSOR_STORE_DIR ?? `${IMAGE.varDir}/cursor-sdk-store`,
		logDir: env.CONDUCTED_LOG_DIR ?? `${IMAGE.varDir}/log`,
	};
}

/**
 * The environment the sidecar starts with: what the container was given, plus its folders, the app
 * version and the sandbox flag. The bin folder goes first on PATH, as it does locally (D088), so a
 * terminal or a setup script finds the managed `gh` and the scripts.
 */
export function sandboxEnvironment(
	parent: Readonly<Record<string, string | undefined>>,
	dirs: SandboxDirs,
): Record<string, string> {
	const defined: Record<string, string> = {};
	for (const [name, value] of Object.entries(parent)) {
		if (value !== undefined) defined[name] = value;
	}
	const path = defined.PATH ?? "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
	return {
		...defined,
		CONDUCTED_BIN_DIR: dirs.binDir,
		CONDUCTED_AGENT_BINARIES_DIR: dirs.agentBinariesDir,
		CONDUCTED_OUTBOX_ROOT: dirs.outboxRoot,
		CONDUCTED_COMPLETIONS_DIR: dirs.completionsDir,
		CONDUCTED_CURSOR_STORE_DIR: dirs.cursorStoreDir,
		CONDUCTED_LOG_DIR: dirs.logDir,
		CONDUCTED_APP_VERSION: defined.CONDUCTED_APP_VERSION ?? IMAGE.appVersion,
		CONDUCTED_LOG_LEVEL: defined.CONDUCTED_LOG_LEVEL ?? "info",
		CLAUDE_CODE_SANDBOXED: "1",
		PATH: `${dirs.binDir}:${path}`,
	};
}

/** The socket path from a sidecar handshake line, or null for any other line. */
export function sidecarHandshake(line: string): string | null {
	const match = /^SOCKET_PATH=(.+?)\r?\n?$/.exec(line);
	return match?.[1] === undefined || match[1] === "" ? null : match[1];
}

/** The port name a test or a local run overrides; the image uses `IMAGE.port`. */
export function parseSandboxPort(value: string | undefined): number | null {
	const port = Number(value ?? IMAGE.port);
	return Number.isInteger(port) && port >= 0 && port <= 65_535 ? port : null;
}

if (import.meta.main) {
	run();
}

function run(): void {
	const dirs = sandboxDirs(process.env);
	const port = parseSandboxPort(process.env.CONDUCTED_SANDBOX_PORT);
	if (port === null) {
		process.stderr.write(`CONDUCTED_SANDBOX_PORT is not a port number.\n`);
		process.exit(64);
	}
	for (const folder of [dirs.outboxRoot, dirs.completionsDir, dirs.cursorStoreDir, dirs.logDir]) {
		mkdirSync(folder, { recursive: true });
	}

	const bootedAt = Date.now();
	const program = process.env.CONDUCTED_SIDECAR_BIN ?? IMAGE.sidecarProgram;
	const workspace = process.env.CONDUCTED_WORKSPACE ?? IMAGE.workspace;
	const sidecar = Bun.spawn([program, "sidecar"], {
		cwd: workspace,
		env: sandboxEnvironment(process.env, dirs),
		stdout: "pipe",
		stderr: "inherit",
	});

	let socketPath: string | null = null;
	let sidecarReadyAt: number | null = null;
	let stopping = false;

	readHandshake().catch((cause: unknown) => {
		console.error(`entry: could not read the sidecar's handshake: ${String(cause)}`);
	});
	sidecar.exited
		.then((code) => {
			if (stopping) return;
			console.error(`entry: the sidecar exited with ${code}`);
			process.exit(1);
		})
		.catch((cause: unknown) => {
			console.error(`entry: could not wait for the sidecar: ${String(cause)}`);
			process.exit(1);
		});

	async function readHandshake(): Promise<void> {
		const decoder = new TextDecoder();
		let buffered = "";
		for await (const chunk of sidecar.stdout) {
			buffered += decoder.decode(chunk, { stream: true });
			const lines = buffered.split("\n");
			buffered = lines.pop() ?? "";
			for (const line of lines) {
				const path = sidecarHandshake(line);
				if (path === null) continue;
				socketPath = path;
				sidecarReadyAt = Date.now();
				console.log(`entry: the sidecar is ready at ${path}`);
			}
		}
	}

	interface Link {
		socket: import("bun").Socket<undefined> | null;
		/** Bytes not yet accepted by the socket, written on "drain". */
		pending: Uint8Array[];
	}

	function flush(link: Link): void {
		const socket = link.socket;
		if (socket === null) return;
		while (link.pending.length > 0) {
			const chunk = link.pending[0] as Uint8Array;
			const written = socket.write(chunk);
			if (written < chunk.byteLength) {
				link.pending[0] = chunk.subarray(Math.max(written, 0));
				return;
			}
			link.pending.shift();
		}
	}

	const server = Bun.serve<Link>({
		hostname: "0.0.0.0",
		port,
		fetch(request, upgradeServer) {
			const url = new URL(request.url);
			if (url.pathname === "/health") {
				return socketPath === null
					? Response.json({ sidecar: "starting" }, { status: 503 })
					: Response.json({
							bootedAt,
							sidecarReadyAt,
							sidecarMs: (sidecarReadyAt ?? 0) - bootedAt,
						});
			}
			if (url.pathname === "/rpc") {
				if (socketPath === null) return new Response("sidecar not ready", { status: 503 });
				if (upgradeServer.upgrade(request, { data: { socket: null, pending: [] } })) {
					return undefined;
				}
				return new Response("expected a WebSocket", { status: 426 });
			}
			return new Response("not found", { status: 404 });
		},
		websocket: {
			async open(ws) {
				const link = ws.data;
				const path = socketPath;
				if (path === null) {
					ws.close(1011, "sidecar not ready");
					return;
				}
				try {
					link.socket = await Bun.connect({
						unix: path,
						socket: {
							data(_socket, data) {
								ws.sendBinary(data);
							},
							close() {
								ws.close(1011, "sidecar socket closed");
							},
							error(_socket, error) {
								console.error(`entry: sidecar socket error: ${String(error)}`);
							},
							drain() {
								flush(link);
							},
						},
					});
					flush(link);
				} catch (cause) {
					console.error(`entry: could not connect to the sidecar: ${String(cause)}`);
					ws.close(1011, "sidecar unreachable");
				}
			},
			message(ws, message) {
				const bytes = typeof message === "string" ? new TextEncoder().encode(message) : message;
				ws.data.pending.push(bytes);
				flush(ws.data);
			},
			close(ws) {
				ws.data.socket?.end();
			},
		},
	});
	console.log(`LISTENING=${server.port}`);

	const shutdown = async (): Promise<void> => {
		if (stopping) return;
		stopping = true;
		if (sidecar.exitCode === null) sidecar.kill("SIGTERM");
		await sidecar.exited;
		server.stop(true);
		process.exit(0);
	};
	process.on("SIGTERM", () => {
		void shutdown();
	});
	process.on("SIGINT", () => {
		void shutdown();
	});
}
