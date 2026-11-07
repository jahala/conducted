/**
 * @feature CLOUD-03 The user's Worker and one Durable Object per workspace: routes, state, keep-alive, relay
 * Runs inside the sandbox as the container's main process: the cloud half of the sidecar relay.
 * Starts our sidecar unchanged ("sidecar" mode), waits for its SOCKET_PATH handshake, and relays
 * each WebSocket on port 8080 to the sidecar's Unix socket, byte for byte. The desktop's Rust
 * shell does the same relay locally between the WebKit view and the socket.
 * GET /health answers 200 once the sidecar listens, so the Durable Object knows when to connect.
 * This file came from the CLOUD-02 spike with its image (docs/research/cloud-spike-2026-11-06.md)
 * and stays until CLOUD-04 builds the product's image.
 */
import { mkdirSync } from "node:fs";

const SIDECAR = "/opt/conducted/conducted-sidecar";
const PORT = 8080;

for (const key of [
	"CONDUCTED_OUTBOX_ROOT",
	"CONDUCTED_COMPLETIONS_DIR",
	"CONDUCTED_CURSOR_STORE_DIR",
	"CONDUCTED_LOG_DIR",
	"CONDUCTED_AGENT_BINARIES_DIR",
]) {
	const dir = process.env[key];
	if (dir) mkdirSync(dir, { recursive: true });
}

const bootedAt = Date.now();
const logPath = `${process.env.CONDUCTED_LOG_DIR ?? "/tmp"}/sidecar.log`;
const sidecar = Bun.spawn([SIDECAR, "sidecar"], {
	env: { ...process.env, CONDUCTED_PARENT_PID: String(process.pid) },
	stdout: "pipe",
	stderr: Bun.file(logPath),
});

let socketPath: string | null = null;
let sidecarReadyAt: number | null = null;

async function readHandshake(): Promise<void> {
	const decoder = new TextDecoder();
	let buffered = "";
	for await (const chunk of sidecar.stdout) {
		buffered += decoder.decode(chunk, { stream: true });
		const lines = buffered.split("\n");
		buffered = lines.pop() ?? "";
		for (const line of lines) {
			if (line.startsWith("SOCKET_PATH=")) {
				socketPath = line.slice("SOCKET_PATH=".length);
				sidecarReadyAt = Date.now();
				console.log(`bridge: sidecar ready after ${sidecarReadyAt - bootedAt} ms at ${socketPath}`);
			}
		}
	}
}
void readHandshake();
void sidecar.exited.then((code) => {
	console.error(`bridge: sidecar exited with ${code}`);
	process.exit(1);
});

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

Bun.serve<Link>({
	hostname: "0.0.0.0",
	port: PORT,
	fetch(request, server) {
		const url = new URL(request.url);
		if (url.pathname === "/health") {
			return socketPath === null
				? new Response("starting", { status: 503 })
				: Response.json({ bootedAt, sidecarReadyAt, sidecarMs: (sidecarReadyAt ?? 0) - bootedAt });
		}
		if (url.pathname === "/rpc") {
			if (socketPath === null) return new Response("sidecar not ready", { status: 503 });
			if (server.upgrade(request, { data: { socket: null, pending: [] } })) return undefined;
			return new Response("expected a WebSocket", { status: 426 });
		}
		return new Response("not found", { status: 404 });
	},
	websocket: {
		async open(ws) {
			const link = ws.data;
			try {
				link.socket = await Bun.connect({
					unix: socketPath as string,
					socket: {
						data(_socket, data) {
							ws.sendBinary(data);
						},
						close() {
							ws.close(1011, "sidecar socket closed");
						},
						error(_socket, error) {
							console.error("bridge: socket error", error);
						},
						drain() {
							flush(link);
						},
					},
				});
				flush(link);
			} catch (error) {
				console.error("bridge: could not connect to the sidecar", error);
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
console.log(`bridge: listening on ${PORT}`);
