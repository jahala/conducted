/**
 * @feature CLOUD-04 Sandbox image with git, gh, the agent programs and our sidecar
 * @feature CLOUD-06 Keep work across sandbox restarts
 * @feature CLOUD-10 Port forwarding from a cloud workspace to the Mac
 * @feature CLOUD-12 SSH into a cloud workspace and open it in a local editor
 * Owns: the container's main process. It sets the sidecar's folders and the sandbox flag, starts
 * the compiled sidecar, reads its `SOCKET_PATH=` handshake, and relays each WebSocket on the
 * sandbox port to that Unix socket. It also starts sshd on loopback and gives the Worker's
 * authenticated `/ssh` WebSocket to the sandbox's SSH port (D119). `GET /health` answers once the
 * sidecar listens. It also reads each relayed sidecar line for the turn end and asks the Worker to
 * save the workspace (D105).
 * Behaviour: cloud-and-remote.md Part 1 ("The sidecar runs inside the sandbox unchanged") and the
 * CLOUD-02 spike's bridge, which showed the same relay working in a Cloudflare sandbox
 * (cloud-spike-2026-11-06.md); claude-runner.md 1.3 says a cloud sandbox adds
 * `CLAUDE_CODE_SANDBOXED=1`. The backup is taken at each turn end, as the spike's "Keeping work"
 * says it must be.
 * Must handle: the sidecar exiting (the container exits 1, never runs without an agent host); a
 * WebSocket that arrives before the handshake (503, not a made-up socket); a socket that closes
 * (the WebSocket closes with it); a port that is not a number (exit 64 with a message); a
 * termination signal (forward SIGTERM to the sidecar and wait for it, so its socket is removed); a
 * turn-end backup that fails (logged, and the next turn end tries again); a tunnel request that
 * names a bad or reserved port (refused); a tunnel whose target refuses (the WebSocket closes);
 * sshd failing to start (logged, the sidecar and the rest of the container still run).
 * Our design choice: the same three handshake lines the Rust shell uses locally, with the port
 * fixed by the image (`IMAGE.port`, overridable for a test or a local run). The relay carries bytes
 * unchanged and reads them only to find the `liveState: idle` line. A container started without
 * `CONDUCTED_TURN_END_URL`, as in a local run, relays but saves no backup.
 * Test first: `sandboxEnvironment` puts `CONDUCTED_BIN_DIR` first on PATH and sets
 * `CLAUDE_CODE_SANDBOXED=1`.
 */
import { mkdirSync, readdirSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { turnChangeOf } from "../src/relay.ts";
import { IMAGE } from "./image.ts";
import {
	detectedPorts,
	type ProcessSockets,
	parseProcTcp,
	processName,
	socketInode,
} from "./ports.ts";
import { SSH_PORT, SSHD_CONFIG, SSHD_CONFIG_PATH, sshdArguments } from "./ssh.ts";
import { TurnEndTracker } from "./turn-end.ts";

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

/**
 * Starts sshd in the foreground with the loopback-only, key-only config. A container that cannot
 * start it still runs the sidecar; the Worker's `/ssh` route then closes its WebSocket.
 */
function startSshd(): ReturnType<typeof Bun.spawn> | null {
	try {
		mkdirSync("/run/sshd", { recursive: true });
		writeFileSync(SSHD_CONFIG_PATH, SSHD_CONFIG);
		const child = Bun.spawn(sshdArguments(), { stdout: "inherit", stderr: "inherit" });
		console.log(`entry: sshd is listening on 127.0.0.1:${SSH_PORT}`);
		return child;
	} catch (cause) {
		console.error(`entry: sshd did not start: ${String(cause)}`);
		return null;
	}
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
	const sshd = startSshd();

	const bootedAt = Date.now();
	const program = process.env.CONDUCTED_SIDECAR_BIN ?? IMAGE.sidecarProgram;
	const workspace = process.env.CONDUCTED_WORKSPACE ?? IMAGE.workspace;
	const turnEndUrl = process.env.CONDUCTED_TURN_END_URL ?? "";
	if (turnEndUrl === "") {
		console.log("entry: CONDUCTED_TURN_END_URL is not set; turn-end backups are off");
	}
	const turnEnds = new TurnEndTracker();
	let saving = false;
	let again = false;

	/**
	 * Asks the Worker to save the workspace, once the last running chat has gone idle. A turn end
	 * that arrives while a save runs asks for one more save afterwards, so it is never dropped.
	 */
	async function requestTurnEnd(): Promise<void> {
		if (turnEndUrl === "") return;
		if (saving) {
			again = true;
			return;
		}
		saving = true;
		try {
			const response = await fetch(turnEndUrl, { method: "POST" });
			await response.body?.cancel();
			if (!response.ok) {
				console.error(`entry: the turn-end backup answered ${response.status}`);
			}
		} catch (cause) {
			console.error(`entry: the turn-end backup failed: ${String(cause)}`);
		} finally {
			saving = false;
		}
		if (again) {
			again = false;
			void requestTurnEnd();
		}
	}

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
		kind: "rpc";
		socket: import("bun").Socket<undefined> | null;
		/** Bytes not yet accepted by the socket, written on "drain". */
		pending: Uint8Array[];
		/** The sidecar's text not yet split into lines, for the turn-end hook. */
		line: string;
		decoder: TextDecoder;
	}

	/** One port-forward connection: a WebSocket paired with a loopback TCP socket (CLOUD-10). */
	interface TunnelLink {
		kind: "tunnel";
		port: number;
		socket: import("bun").Socket<undefined> | null;
		pending: Uint8Array[];
	}

	type Connection = Link | TunnelLink;

	/** Reads a /proc file, or an empty text when the process may not see it. */
	function readProc(file: string): string {
		try {
			return readFileSync(file, "utf8");
		} catch {
			return "";
		}
	}

	/** Every process whose descriptors link a socket, with its kernel name. */
	function scanProcesses(): ProcessSockets[] {
		const processes: ProcessSockets[] = [];
		let entries: import("node:fs").Dirent<string>[];
		try {
			entries = readdirSync("/proc", { withFileTypes: true, encoding: "utf8" });
		} catch {
			return processes;
		}
		for (const entry of entries) {
			if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
			const pid = Number(entry.name);
			const inodes: number[] = [];
			let descriptors: string[];
			try {
				descriptors = readdirSync(`/proc/${pid}/fd`, { encoding: "utf8" });
			} catch {
				continue;
			}
			for (const descriptor of descriptors) {
				let link: string;
				try {
					link = readlinkSync(`/proc/${pid}/fd/${descriptor}`);
				} catch {
					continue;
				}
				const inode = socketInode(link);
				if (inode !== null) inodes.push(inode);
			}
			if (inodes.length === 0) continue;
			// Conductor names a port's process from its command line, not the kernel's `comm`
			// (Node's main thread is "MainThread"). The empty case is a process with no argv.
			const argv = readProc(`/proc/${pid}/cmdline`)
				.split("\u0000")
				.filter((part) => part !== "");
			const name = argv.length === 0 ? readProc(`/proc/${pid}/comm`).trim() : processName(argv);
			processes.push({ pid, name, inodes });
		}
		return processes;
	}

	/**
	 * The TCP ports listening inside the container and the process behind each, from /proc.
	 * Read-only, so it starts nothing.
	 */
	function listeningPorts() {
		const listeners = [
			...parseProcTcp(readProc("/proc/net/tcp")),
			...parseProcTcp(readProc("/proc/net/tcp6")),
		];
		return detectedPorts(listeners, scanProcesses());
	}

	/** The port a tunnel asks for, or null when it is not one a forward may use. */
	function tunnelPort(raw: string | null): number | null {
		if (raw === null || !/^\d{1,5}$/.test(raw)) return null;
		const port = Number(raw);
		return port >= 1 && port <= 65_535 && port !== 22 ? port : null;
	}

	function flushTunnel(link: TunnelLink): void {
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

	/** Reads the sidecar's lines for a turn end; the bytes go on to the app unchanged. */
	function noteSidecarOutput(link: Link, chunk: Uint8Array): void {
		link.line += link.decoder.decode(chunk, { stream: true });
		let newline = link.line.indexOf("\n");
		while (newline !== -1) {
			const line = link.line.slice(0, newline);
			link.line = link.line.slice(newline + 1);
			if (turnEnds.note(turnChangeOf(line))) void requestTurnEnd();
			newline = link.line.indexOf("\n");
		}
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

	const server = Bun.serve<Connection>({
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
			if (url.pathname === "/ports") {
				return Response.json({ ports: listeningPorts() });
			}
			if (url.pathname === "/tunnel") {
				const port = tunnelPort(url.searchParams.get("port"));
				if (port === null) return new Response("Bad tunnel port", { status: 400 });
				if (
					upgradeServer.upgrade(request, {
						data: { kind: "tunnel", port, socket: null, pending: [] },
					})
				) {
					return undefined;
				}
				return new Response("expected a WebSocket", { status: 426 });
			}
			// The SSH door (CLOUD-12). The Worker authenticates the tunnel and only this entry
			// route reaches port 22, so no public forward can name it.
			if (url.pathname === "/ssh") {
				if (
					upgradeServer.upgrade(request, {
						data: { kind: "tunnel", port: SSH_PORT, socket: null, pending: [] },
					})
				) {
					return undefined;
				}
				return new Response("expected a WebSocket", { status: 426 });
			}
			if (url.pathname === "/rpc") {
				if (socketPath === null) return new Response("sidecar not ready", { status: 503 });
				if (
					upgradeServer.upgrade(request, {
						data: {
							kind: "rpc",
							socket: null,
							pending: [],
							line: "",
							decoder: new TextDecoder(),
						},
					})
				) {
					return undefined;
				}
				return new Response("expected a WebSocket", { status: 426 });
			}
			return new Response("not found", { status: 404 });
		},
		websocket: {
			async open(ws) {
				const link = ws.data;
				if (link.kind === "tunnel") {
					try {
						link.socket = await Bun.connect({
							hostname: "127.0.0.1",
							port: link.port,
							socket: {
								data(_socket, data) {
									ws.sendBinary(data);
								},
								close() {
									ws.close(1011, "the forwarded port closed");
								},
								error(_socket, error) {
									console.error(`entry: tunnel socket error: ${String(error)}`);
								},
								drain() {
									flushTunnel(link);
								},
							},
						});
						flushTunnel(link);
					} catch (cause) {
						console.error(`entry: could not reach port ${link.port}: ${String(cause)}`);
						ws.close(1011, "the forwarded port is not running");
					}
					return;
				}
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
								noteSidecarOutput(link, data);
								ws.sendBinary(data);
							},
							close() {
								turnEnds.reset();
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
				if (ws.data.kind === "tunnel") {
					ws.data.pending.push(bytes);
					flushTunnel(ws.data);
					return;
				}
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
		if (sshd !== null && sshd.exitCode === null) sshd.kill("SIGTERM");
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
