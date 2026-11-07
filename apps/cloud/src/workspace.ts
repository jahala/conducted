/**
 * @feature CLOUD-03 The user's Worker and one Durable Object per workspace: routes, state, keep-alive, relay
 * @feature CLOUD-06 Keep work across sandbox restarts
 * @feature CLOUD-09 Cloud terminals, run scripts and previews
 * Owns: one workspace's Durable Object: the sandbox's lifecycle, the commands and file operations
 * the host seam runs, the WebSocket relay to the sidecar, the alarm that keeps a running turn alive
 * while it lets an idle sandbox sleep, and the R2 backups of the work and the agents' transcripts.
 * Behaviour: docs/plans/cloud-and-remote.md Part 1 (one Durable Object per workspace holds state,
 * keep-alive and the relay) and its spike result (warm 2.3 to 8.8 s, cold 14.5 s, about 0.02 US
 * dollars an active hour on `basic`; work in a running sandbox keeps going while the desktop is
 * away; a restart with an R2 backup of `/workspace` and `/root/.claude` got the uncommitted work
 * and the resumable transcript back). Method and numbers:
 * docs/research/cloud-spike-2026-11-06.md, with the CLOUD-06 follow-up.
 * Must handle: starting the container on the first call that needs it; a sandbox that is already
 * running is reused; commands run one at a time per workspace through a serial queue; a turn that
 * outlives the desktop's connection keeps the container awake through an alarm that touches its
 * health endpoint, and an idle sandbox is left to the inactivity timeout; a stopped sandbox is
 * never started just to answer a read or save a backup (the spike's backup bug); a start restores
 * the latest backups only when it started a stopped container.
 * Our design choice: turn state comes from the relay itself, not a second signalling channel: a
 * `sendMessage` request starts a turn and the sidecar's `liveState` notification ends it. The
 * spike named this gap and left it open. The sandbox entry sees the same notification and asks for
 * the backup over an internal hostname (D105).
 * Our design choice: a cloud "trash" removes the file, because a sandbox has no macOS Trash.
 * Test first: an idle turn leaves no alarm, a working turn sets one, and the alarm clears itself
 * when the turn is over.
 * @feature CLOUD-05 Secrets stay outside the sandbox: the container environment carries the
 * scrubbed git settings and the GH_TOKEN placeholder from sandbox-git-env.ts; no model key is in
 * it. The Worker's outbound handler swaps the real credentials in (D104).
 * CLOUD-06: a stopped sandbox saves no backup and is not started.
 */

import { DurableObject } from "cloudflare:workers";
import {
	DirectoryBackup,
	type DirectoryBackupGatewayBinding,
	type DirectoryBackupRecord,
	Files,
} from "@cloudflare/sandbox";
import type { ExecBody, FileBody } from "./args.ts";
import {
	BACKUP_BINDING,
	BACKUP_PREFIX,
	type BackupLedger,
	type BackupSummary,
	restoreWorkspace,
	saveWorkspace,
	turnEndUrl,
} from "./backup.ts";
import type { Env } from "./env.ts";
import { type TurnSignal, textOf, turnSignalOf } from "./relay.ts";
import { SANDBOX_GIT_ENV } from "./sandbox-git-env.ts";
import { type ServerMessage, TerminalSession } from "./terminal.ts";

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
 * real model key in at its outbound handler (the plan, "Secrets never enter the sandbox"), and
 * `GH_TOKEN` is only the placeholder the handler replaces. The git scrub is CLOUD-05's
 * (sandbox-git-env.ts).
 */
export const CONTAINER_ENV: Readonly<Record<string, string>> = Object.freeze({
	...SANDBOX_GIT_ENV,
	HOME: "/root",
	SHELL: "/bin/bash",
	PATH: "/opt/conducted/bin:/usr/local/bin:/usr/bin:/bin",
	CONDUCTED_BIN_DIR: "/opt/conducted/bin",
	// The managed-program layout the sidecar's finder reads (PLAT-28, D088); the image installs it.
	CONDUCTED_AGENT_BINARIES_DIR: "/opt/conducted/agent-binaries",
	CONDUCTED_OUTBOX_ROOT: "/var/conducted/outbox",
	CONDUCTED_COMPLETIONS_DIR: "/var/conducted/completions",
	CONDUCTED_CURSOR_STORE_DIR: "/var/conducted/cursor-sdk-store",
	CONDUCTED_LOG_DIR: "/var/conducted/log",
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
	/** The latest saved backup of each directory. */
	backups: BackupSummary[];
}

/** What a turn-end backup did. */
export interface BackupReport {
	/** False when the sandbox was stopped, so nothing was saved and nothing started. */
	ran: boolean;
	saved: BackupSummary[];
	skipped: string[];
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

/** The preview path inside a Worker route: `/w/<name>/preview/<token>/<port>/<rest>`. */
const PREVIEW_IN_WORKSPACE = /\/preview\/[^/]+\/(\d{1,5})(\/.*)?$/;

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
const STORAGE_BACKUPS = "backups";

export class Workspace extends DurableObject<Env> {
	private readonly container: Container | undefined;
	/** One sandbox operation at a time, so a file write never races a command. */
	private queue: Promise<unknown> = Promise.resolve();
	/** The in-flight setup, shared by every call that needs the container. */
	private setup: Promise<void> | null = null;
	private files: Files | null = null;
	/** The R2 directory backup, built once the sandbox is known. */
	private backup: DirectoryBackup | null = null;
	/** The in-flight restore of a sandbox this workspace started. */
	private restore: Promise<void> | null = null;

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
			const env: Record<string, string> = { ...CONTAINER_ENV };
			const name = this.ctx.id.name;
			// The callback the entry calls when the last running chat goes idle (D105).
			if (name !== undefined) env.CONDUCTED_TURN_END_URL = turnEndUrl(name);
			container.start({
				image: container.images.sandbox,
				instance: this.env.INSTANCE_TYPE,
				enableInternet: false,
				env,
			});
			this.restore = null;
			await this.ctx.storage.put(STORAGE_STARTED_AT, Date.now());
		}
		try {
			await container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS);
			// The backup route must be registered before the catch-all takes every hostname.
			await this.backupStore().intercept();
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

	/** The R2 directory backup helper, built once the sandbox is known. */
	private backupStore(): DirectoryBackup {
		if (this.backup === null) {
			const gateway = (
				this.ctx.exports as unknown as { DirectoryBackupGateway: DirectoryBackupGatewayBinding }
			).DirectoryBackupGateway;
			this.backup = new DirectoryBackup(this.requireContainer(), gateway, {
				binding: BACKUP_BINDING,
				prefix: BACKUP_PREFIX,
			});
		}
		return this.backup;
	}

	/** The stored backup records, as the backup module reads and writes them. */
	private backupLedger(): BackupLedger {
		return {
			read: async () =>
				(await this.ctx.storage.get<DirectoryBackupRecord[]>(STORAGE_BACKUPS)) ?? [],
			write: async (records) => {
				await this.ctx.storage.put(STORAGE_BACKUPS, [...records]);
			},
		};
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
		const records = (await this.ctx.storage.get<DirectoryBackupRecord[]>(STORAGE_BACKUPS)) ?? [];
		return {
			running: this.container?.running ?? false,
			turnActive,
			alarmAt,
			instance: this.env.INSTANCE_TYPE,
			backups: records.map((record) => ({
				id: record.id,
				dir: record.dir,
				size: record.size,
			})),
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
		if (this.restore !== null) {
			await this.restore;
		} else if (started) {
			await this.ensureRestored();
		}
		const health = await this.waitForSidecar(began);
		return { started, readyMs: Date.now() - began, health, instance: this.env.INSTANCE_TYPE };
	}

	/**
	 * Puts the latest saved backup of every directory back into the sandbox this call started. A
	 * failure is handed to the caller: the work did not come back, and the user must not be told it
	 * did. Running it again settles a restore that was cut off.
	 */
	private ensureRestored(): Promise<void> {
		if (this.restore === null) {
			this.restore = this.exclusive(async () => {
				if (this.container === undefined || !this.container.running) return;
				await restoreWorkspace(this.backupStore(), this.backupLedger());
			}).catch((error: unknown) => {
				this.restore = null;
				throw error;
			});
		}
		return this.restore;
	}

	/**
	 * Saves the workspace and the agents' transcripts after a turn ends. The sandbox entry calls
	 * this through the outbound handler. A stopped sandbox is left stopped: starting it here would
	 * save the bare image and bill a container nobody asked for (the spike's backup bug).
	 */
	async backupAtTurnEnd(): Promise<BackupReport> {
		return this.exclusive(async () => {
			if (this.container === undefined || !this.container.running) {
				return { ran: false, saved: [], skipped: [] };
			}
			if (this.setup === null) await this.setUp();
			const result = await saveWorkspace(this.backupStore(), this.backupLedger());
			return { ran: true, saved: result.saved, skipped: result.skipped };
		});
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
	 * ignored. A frame may hold several newline-separated messages (the sidecar writes NDJSON and
	 * the socket may coalesce writes), so every line is read in order. It returns the state it left
	 * behind, which the state route also reads.
	 */
	async noteTurn(
		frame: string | ArrayBuffer,
	): Promise<{ turnActive: boolean; alarmAt: number | null }> {
		const text = textOf(frame);
		if (text !== null) {
			for (const line of text.split("\n")) {
				if (line.trim() === "") continue;
				await this.applyTurnSignal(turnSignalOf(line));
			}
		}
		const turnActive = (await this.ctx.storage.get<boolean>(STORAGE_TURN_ACTIVE)) ?? false;
		return { turnActive, alarmAt: await this.ctx.storage.getAlarm() };
	}

	private async applyTurnSignal(signal: TurnSignal | null): Promise<void> {
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
	}

	/**
	 * The sidecar relay. The client's WebSocket is paired with a WebSocket into the sandbox's bridge,
	 * byte for byte, and each text frame is read for turn state. Accepting both ends keeps the
	 * Durable Object and the container active while the desktop is connected.
	 */
	override async fetch(request: Request): Promise<Response> {
		// A WebSocket and a proxied preview must be answered by this Durable Object's own `fetch`,
		// because their Response holds a WebSocket or a stream that RPC cannot serialize.
		const path = new URL(request.url).pathname;
		if (path.endsWith("/terminal")) return this.terminal(request);
		const preview = PREVIEW_IN_WORKSPACE.exec(path);
		if (preview !== null) {
			return this.preview(request, Number(preview[1]), preview[2] ?? "/");
		}
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

	/**
	 * The terminal WebSocket. The client's first message names the folder, size and command; the
	 * process runs in the container with a PTY, and its bytes travel as base64 JSON. The connection
	 * keeps the Durable Object and the container active, as the relay does.
	 */
	async terminal(request: Request): Promise<Response> {
		if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
			return new Response("Expected a WebSocket", { status: 426 });
		}
		const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
		server.accept();
		const send = (message: ServerMessage): void => {
			try {
				server.send(JSON.stringify(message));
			} catch {
				// The connection is already gone; its close event ends the session.
			}
		};
		const session = new TerminalSession(
			send,
			async (input) => {
				await this.ensureSetUp();
				const container = this.requireContainer();
				const process = await container.exec(input.command, {
					cwd: input.cwd,
					env: { ...CONTAINER_ENV, ...(input.env ?? {}) },
					pty: { cols: input.cols, rows: input.rows },
					stdin: "pipe",
					stdout: "pipe",
					stderr: "combined",
				});
				// The SDK process and the protocol share stdin, stdout and exit; the cast is the one
				// seam between them.
				return process as unknown as {
					stdin: WritableStream<Uint8Array> | null;
					stdout: ReadableStream<Uint8Array> | null;
					exitCode: Promise<number>;
					kill(signal?: number): void;
					resize(cols: number, rows: number): void;
				};
			},
			() => {
				try {
					server.close(1000, "The terminal ended.");
				} catch {
					// Already closed.
				}
			},
		);
		server.addEventListener("message", (event: MessageEvent) => {
			const text = typeof event.data === "string" ? event.data : textOf(event.data as ArrayBuffer);
			if (text === null) {
				send({ type: "error", message: "A terminal message must be text." });
				return;
			}
			void session.receive(text);
		});
		server.addEventListener("close", () => {
			session.disconnect();
		});
		return new Response(null, { status: 101, webSocket: client });
	}

	/**
	 * Proxies a browser's request to a port inside the sandbox. The preview token was checked by
	 * the Worker's front door, so nothing here needs the pairing token.
	 */
	async preview(request: Request, port: number, rest: string): Promise<Response> {
		if (this.container === undefined) {
			return new Response("This workspace has no sandbox configured", { status: 503 });
		}
		await this.ensureSetUp();
		const target = new URL(`http://container${rest.startsWith("/") ? rest : `/${rest}`}`);
		target.search = new URL(request.url).search;
		return this.requireContainer().getTcpPort(port).fetch(new Request(target, request));
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
