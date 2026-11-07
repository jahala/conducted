/**
 * @feature CLOUD-03 The user's Worker and one Durable Object per workspace: routes, state, keep-alive, relay
 * Owns: one workspace's Durable Object: the sandbox's lifecycle, the commands and file operations
 * the host seam runs, the WebSocket relay to the sidecar, and the alarm that keeps a running turn
 * alive while it lets an idle sandbox sleep.
 * Behaviour: docs/plans/cloud-and-remote.md Part 1 (one Durable Object per workspace holds state,
 * keep-alive and the relay) and its spike result (warm 2.3 to 8.8 s, cold 14.5 s, about 0.02 US
 * dollars an active hour on `basic`; work in a running sandbox keeps going while the desktop is
 * away). Method and numbers: docs/research/cloud-spike-2026-11-06.md.
 * Must handle: starting the container on the first call that needs it; a sandbox that is already
 * running is reused; commands run one at a time per workspace through a serial queue; a turn that
 * outlives the desktop's connection keeps the container awake through an alarm that touches its
 * health endpoint, and an idle sandbox is left to the inactivity timeout; a stopped sandbox is
 * never started just to answer a read (the spike's backup bug).
 * Our design choice: turn state comes from the relay itself, not a second signalling channel: a
 * `sendMessage` request starts a turn and the sidecar's `liveState` notification ends it. The
 * spike named this gap and left it open.
 * Our design choice: a cloud "trash" removes the file, because a sandbox has no macOS Trash.
 * Test first: an idle turn leaves no alarm, a working turn sets one, and the alarm clears itself
 * when the turn is over.
 */

import { DurableObject } from "cloudflare:workers";
import { Files } from "@cloudflare/sandbox";
import type { ExecBody, FileBody } from "./args.ts";
import type { Env } from "./env.ts";
import { textOf, turnSignalOf } from "./relay.ts";

/** The port the sandbox image's bridge listens on. */
export const SIDECAR_PORT = 8080;
/** How long the sidecar has to answer its health check after the container starts. */
export const READY_DEADLINE_MS = 150_000;
/** How long a completely idle sandbox stays awake. */
export const INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000;
/** How often the alarm touches a sandbox that is running a turn. */
export const ALARM_INTERVAL_MS = 60_000;
/** The CA the Worker's outbound handler terminates TLS with, so clients in the sandbox trust it. */
export const CA_PATH = "/etc/cloudflare/certs/cloudflare-containers-ca.crt";

/**
 * The environment the bridge and the sidecar start with. No secret is in it: the Worker swaps the
 * real model key in at its outbound handler (the plan, "Secrets never enter the sandbox").
 */
export const CONTAINER_ENV: Readonly<Record<string, string>> = Object.freeze({
	HOME: "/root",
	SHELL: "/bin/bash",
	PATH: "/usr/local/bin:/usr/bin:/bin",
	CONDUCTED_BIN_DIR: "/opt/conducted/bin",
	CONDUCTED_OUTBOX_ROOT: "/var/conducted/outbox",
	CONDUCTED_COMPLETIONS_DIR: "/var/conducted/completions",
	CONDUCTED_CURSOR_STORE_DIR: "/var/conducted/cursor",
	CONDUCTED_LOG_DIR: "/var/conducted/log",
	CONDUCTED_APP_VERSION: "0.0.0-cloud",
	CONDUCTED_LOG_LEVEL: "info",
	NODE_EXTRA_CA_CERTS: CA_PATH,
	SSL_CERT_FILE: CA_PATH,
	GIT_SSL_CAINFO: CA_PATH,
	CURL_CA_BUNDLE: CA_PATH,
	CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
	IS_SANDBOX: "1",
});

/** A command's output, in the shape the desktop's Platform Shell uses. */
export interface CommandResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

/** What a client can learn about one workspace without touching its sandbox. */
export interface WorkspaceState {
	/** True while the container process is up. */
	running: boolean;
	/** True between the start of a turn and its end. */
	turnActive: boolean;
	/** When the next keep-alive alarm runs, or null when none is set. */
	alarmAt: number | null;
	/** The container size this workspace asks for. */
	instance: string;
}

interface StartReport {
	/** True when this call started a stopped container. */
	started: boolean;
	/** Milliseconds from the call to the sidecar's health answer. */
	readyMs: number;
	/** The bridge's boot report, when it answered. */
	health: unknown;
	instance: string;
}

/** A loopback binding to a Worker export, as `ctx.exports` gives it. */
type LoopbackExport = (options: { props: Record<string, unknown> }) => Fetcher;

/** A stat in the desktop's Platform FileStat shape. */
export interface CloudFileStat {
	path: string;
	isDirectory: boolean;
	isSymlink: boolean;
	size: number;
	modifiedAt: number;
}

const STORAGE_TURN_ACTIVE = "turnActive";
const STORAGE_STARTED_AT = "startedAt";

export class Workspace extends DurableObject<Env> {
	private readonly container: Container | undefined;
	/** One sandbox operation at a time, so a file write never races a command. */
	private queue: Promise<unknown> = Promise.resolve();
	/** The in-flight setup, shared by every call that needs the container. */
	private setup: Promise<void> | null = null;
	private files: Files | null = null;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.container = ctx.container;
	}

	/** Runs sandbox work one at a time per workspace. */
	private exclusive<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.queue.then(operation);
		this.queue = result.catch(() => {});
		return result;
	}

	/** The container binding, which the Worker's configuration always supplies. */
	private requireContainer(): Container {
		if (this.container === undefined) throw new Error("This workspace has no sandbox configured");
		return this.container;
	}

	/**
	 * Starts a stopped sandbox and installs the outbound handler once. A call that arrives while
	 * setup runs waits for it; a failed setup is forgotten so the next call tries again.
	 */
	private ensureSetUp(): Promise<void> {
		if (this.setup === null || !this.requireContainer().running) {
			this.setup = this.setUp().catch((error: unknown) => {
				this.setup = null;
				throw error;
			});
		}
		return this.setup;
	}

	private async setUp(): Promise<void> {
		const container = this.requireContainer();
		if (!container.running) {
			container.start({
				image: container.images.sandbox,
				instance: this.env.INSTANCE_TYPE,
				enableInternet: false,
				env: { ...CONTAINER_ENV },
			});
			await this.ctx.storage.put(STORAGE_STARTED_AT, Date.now());
		}
		try {
			await container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS);
			const outbound = (this.ctx.exports as unknown as { Outbound: LoopbackExport }).Outbound({
				props: {},
			});
			await container.interceptAllOutboundHttp(outbound);
			await container.interceptOutboundHttps("*", outbound);
		} catch (error) {
			await container.destroy();
			throw error;
		}
	}

	/** The file operations helper, built once the sandbox is known. */
	private fileOperations(): Files {
		if (this.files === null) this.files = new Files(this.requireContainer());
		return this.files;
	}

	/** The workspace's stored and live state, without starting anything. */
	async state(): Promise<WorkspaceState> {
		const turnActive = (await this.ctx.storage.get<boolean>(STORAGE_TURN_ACTIVE)) ?? false;
		const alarmAt = await this.ctx.storage.getAlarm();
		return {
			running: this.container?.running ?? false,
			turnActive,
			alarmAt,
			instance: this.env.INSTANCE_TYPE,
		};
	}

	/**
	 * Starts the sandbox if it is stopped and waits for the sidecar's health answer. This is the
	 * call the host seam makes before a chat, and it is also the cold-start measurement.
	 */
	async start(): Promise<StartReport> {
		const began = Date.now();
		const started = !this.requireContainer().running;
		await this.ensureSetUp();
		const health = await this.waitForSidecar(began);
		return { started, readyMs: Date.now() - began, health, instance: this.env.INSTANCE_TYPE };
	}

	/** Polls the bridge's health endpoint until it answers or the deadline passes. */
	private async waitForSidecar(began: number): Promise<unknown> {
		const container = this.requireContainer();
		const deadline = began + READY_DEADLINE_MS;
		while (Date.now() < deadline) {
			try {
				const response = await container
					.getTcpPort(SIDECAR_PORT)
					.fetch("http://container/health", { signal: AbortSignal.timeout(2_000) });
				if (response.status === 200) return await response.json();
				await response.body?.cancel();
			} catch {
				// The port is not open yet.
			}
			await scheduler.wait(250);
		}
		throw new Error(`The sidecar did not answer within ${READY_DEADLINE_MS} ms`);
	}

	/**
	 * Runs one git command in a folder. A stopped sandbox is started, because a user asking for
	 * git state is asking the workspace to be there.
	 */
	async git(args: readonly string[], cwd: string): Promise<CommandResult> {
		return this.exec({ program: "git", args: [...args], cwd });
	}

	/**
	 * Runs one program with an argv, never a shell string. Commands in one workspace run one at a
	 * time so two writes cannot interleave on disk.
	 */
	async exec(body: ExecBody): Promise<CommandResult> {
		return this.exclusive(async () => {
			await this.ensureSetUp();
			const container = this.requireContainer();
			const controller = new AbortController();
			const timer =
				body.timeoutMs === undefined ? null : setTimeout(() => controller.abort(), body.timeoutMs);
			try {
				const stdin =
					body.stdin === undefined
						? undefined
						: new ReadableStream<Uint8Array>({
								start(stream) {
									stream.enqueue(new TextEncoder().encode(body.stdin));
									stream.close();
								},
							});
				const process = await container.exec([body.program, ...body.args], {
					cwd: body.cwd,
					env: { ...CONTAINER_ENV, ...body.env },
					...(stdin === undefined ? {} : { stdin }),
					signal: controller.signal,
				});
				const output = await process.output();
				const decoder = new TextDecoder();
				return {
					exitCode: output.exitCode,
					stdout: decoder.decode(output.stdout),
					stderr: decoder.decode(output.stderr),
				};
			} finally {
				if (timer !== null) clearTimeout(timer);
			}
		});
	}

	/**
	 * Reads and writes files and their metadata in the sandbox. A read never starts a stopped
	 * sandbox: a workspace that is asleep is a different state from one with no data.
	 */
	async filesOperation(body: FileBody): Promise<unknown> {
		return this.exclusive(async () => {
			const files = this.fileOperations();
			switch (body.operation) {
				case "read": {
					const response = await files.readFile(body.path);
					return { text: await response.text() };
				}
				case "write": {
					const slash = body.path.lastIndexOf("/");
					const directory = slash <= 0 ? "/" : body.path.slice(0, slash);
					const temporary = `${body.path}.conducted-${crypto.randomUUID()}`;
					await files.mkdir(directory, { recursive: true });
					await files.writeFile(temporary, body.text);
					await files.rename(temporary, body.path);
					return {};
				}
				case "exists": {
					try {
						await files.stat(body.path);
						return { exists: true };
					} catch {
						return { exists: false };
					}
				}
				case "stat": {
					const stat = await files.stat(body.path);
					return {
						stat: {
							path: body.path,
							isDirectory: stat.type === "directory",
							isSymlink: stat.type === "symlink",
							size: Number(stat.size),
							modifiedAt: stat.modifiedAt.getTime(),
						} satisfies CloudFileStat,
					};
				}
				case "readDir": {
					const entries = await files.readDirectory(body.path);
					const stats: CloudFileStat[] = [];
					for (const entry of entries) {
						const path = `${body.path.replace(/\/$/, "")}/${entry.name}`;
						try {
							const stat = await files.stat(path);
							stats.push({
								path,
								isDirectory: stat.type === "directory",
								isSymlink: stat.type === "symlink",
								size: Number(stat.size),
								modifiedAt: stat.modifiedAt.getTime(),
							});
						} catch {
							// An entry that vanished between listing and stat is left out.
						}
					}
					return { entries: stats };
				}
				case "mkdirp":
					await files.mkdir(body.path, { recursive: true });
					return {};
				case "trash":
					await files.remove(body.path, { recursive: true, force: true });
					return {};
			}
		});
	}

	/**
	 * The alarm that keeps a turn alive. While a turn runs it touches the sandbox's health endpoint,
	 * which resets the container's inactivity timer; once the turn is over the alarm stays off and
	 * the sandbox is free to sleep. A sandbox that stopped under a turn has lost the work since its
	 * last backup (CLOUD-06), so the alarm clears.
	 */
	override async alarm(): Promise<void> {
		const turnActive = (await this.ctx.storage.get<boolean>(STORAGE_TURN_ACTIVE)) ?? false;
		const container = this.container;
		if (!turnActive || container === undefined || !container.running) {
			await this.ctx.storage.put(STORAGE_TURN_ACTIVE, false);
			await this.ctx.storage.deleteAlarm();
			return;
		}
		try {
			const response = await container
				.getTcpPort(SIDECAR_PORT)
				.fetch("http://container/health", { signal: AbortSignal.timeout(2_000) });
			await response.body?.cancel();
		} catch (error) {
			console.error(`keep-alive touch failed: ${String(error)}`);
		}
		await this.ctx.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
	}

	/**
	 * Notes what a relayed frame says about a turn and starts or stops the keep-alive alarm.
	 * The relay calls this for frames in both directions; anything that is not a turn signal is
	 * ignored. It returns the state it left behind, which the state route also reads.
	 */
	async noteTurn(
		frame: string | ArrayBuffer,
	): Promise<{ turnActive: boolean; alarmAt: number | null }> {
		const text = textOf(frame);
		const signal = text === null ? null : turnSignalOf(text);
		if (signal === "working") {
			const wasActive = (await this.ctx.storage.get<boolean>(STORAGE_TURN_ACTIVE)) ?? false;
			if (!wasActive) {
				await this.ctx.storage.put(STORAGE_TURN_ACTIVE, true);
				await this.ctx.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
			}
		} else if (signal === "idle") {
			await this.ctx.storage.put(STORAGE_TURN_ACTIVE, false);
			await this.ctx.storage.deleteAlarm();
		}
		const turnActive = (await this.ctx.storage.get<boolean>(STORAGE_TURN_ACTIVE)) ?? false;
		return { turnActive, alarmAt: await this.ctx.storage.getAlarm() };
	}

	/**
	 * The sidecar relay. The client's WebSocket is paired with a WebSocket into the sandbox's bridge,
	 * byte for byte, and each text frame is read for turn state. Accepting both ends keeps the
	 * Durable Object and the container active while the desktop is connected.
	 */
	override async fetch(request: Request): Promise<Response> {
		if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
			return new Response("Expected a WebSocket", { status: 426 });
		}
		await this.start();
		const upstreamResponse = await this.requireContainer()
			.getTcpPort(SIDECAR_PORT)
			.fetch(new Request("http://container/rpc", request));
		const upstream = upstreamResponse.webSocket;
		if (upstream === null) {
			return new Response(`The sidecar refused the connection: ${upstreamResponse.status}`, {
				status: 502,
			});
		}
		const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
		upstream.binaryType = "arraybuffer";
		server.binaryType = "arraybuffer";
		upstream.accept();
		server.accept();
		this.pump(server, upstream);
		this.pump(upstream, server);
		return new Response(null, { status: 101, webSocket: client });
	}

	/** Copies frames from one side to the other, reading each for turn state. */
	private pump(from: WebSocket, to: WebSocket): void {
		from.addEventListener("message", (event: MessageEvent) => {
			void this.noteTurn(event.data as string | ArrayBuffer).catch(() => {});
			try {
				to.send(event.data);
			} catch {
				from.close(1011, "The other side closed");
			}
		});
		from.addEventListener("close", (event: CloseEvent) => {
			const code = event.code === 1005 || event.code === 1006 ? 1000 : event.code;
			try {
				to.close(code, event.reason);
			} catch {
				// The other side is already closed.
			}
		});
	}
}
