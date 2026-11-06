/**
 * CLOUD-02 spike only. The user's Worker: authenticates the desktop with a pairing token, routes
 * each workspace to its Durable Object, and keeps the model key out of the sandbox.
 *
 * Routes (all need `Authorization: Bearer <PAIRING_TOKEN>`):
 *   POST /w/<name>/start    start the sandbox if it is stopped and wait for the sidecar; timings
 *   GET  /w/<name>/rpc      WebSocket to the sidecar (JSON-RPC, one message per line)
 *   POST /w/<name>/exec     run one command (argv) and return its output; spike measurements only
 *   POST /w/<name>/backup   save a directory to R2 (DirectoryBackup) and keep the record
 *   POST /w/<name>/restore  restore the saved directory into the running sandbox
 *   POST /w/<name>/destroy  stop the sandbox at once
 *   POST /w/<name>/forget   delete every saved backup object and the Durable Object's storage
 */

import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import { DirectoryBackup, type DirectoryBackupRecord } from "@cloudflare/sandbox";

export { DirectoryBackupGateway } from "@cloudflare/sandbox";

/** The bindings from wrangler.jsonc (generated `Env`) plus the two secrets set with `wrangler secret put`. */
type SpikeEnv = Env & { ANTHROPIC_API_KEY: string; PAIRING_TOKEN: string };

const PORT = 8080;
const INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000;
const READY_DEADLINE_MS = 150_000;
const CA_PATH = "/etc/cloudflare/certs/cloudflare-containers-ca.crt";

/** The environment the bridge and the sidecar start with. No secret is in it. */
const CONTAINER_ENV: Record<string, string> = {
	HOME: "/root",
	SHELL: "/bin/bash",
	PATH: "/usr/local/bin:/usr/bin:/bin",
	CONDUCTED_BIN_DIR: "/opt/conducted/bin",
	CONDUCTED_OUTBOX_ROOT: "/var/conducted/outbox",
	CONDUCTED_COMPLETIONS_DIR: "/var/conducted/completions",
	CONDUCTED_CURSOR_STORE_DIR: "/var/conducted/cursor",
	CONDUCTED_LOG_DIR: "/var/conducted/log",
	CONDUCTED_APP_VERSION: "0.0.0-spike",
	CONDUCTED_LOG_LEVEL: "info",
	// The Worker's outbound handler terminates TLS with this CA, so every client must trust it.
	NODE_EXTRA_CA_CERTS: CA_PATH,
	SSL_CERT_FILE: CA_PATH,
	GIT_SSL_CAINFO: CA_PATH,
	CURL_CA_BUNDLE: CA_PATH,
	CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
	// Claude Code refuses to skip permissions as root outside a declared sandbox.
	IS_SANDBOX: "1",
};

/**
 * Every HTTP and HTTPS request from the container comes here. Only the Anthropic API is reachable,
 * and the placeholder key the sandbox holds is replaced with the real one.
 */
export class Outbound extends WorkerEntrypoint<SpikeEnv> {
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		if (url.protocol === "https:" && url.hostname === "api.anthropic.com") {
			const headers = new Headers(request.headers);
			headers.delete("authorization");
			headers.set("x-api-key", this.env.ANTHROPIC_API_KEY);
			return fetch(new Request(request, { headers }));
		}
		console.log(`outbound refused: ${url.protocol}//${url.hostname}${url.pathname}`);
		return new Response(`${url.hostname} is not reachable from this sandbox\n`, { status: 403 });
	}
}

interface StartReport {
	/** True when this call started a stopped container. */
	started: boolean;
	/** Milliseconds from the call to the sidecar's health answer. */
	readyMs: number;
	/** The bridge's own boot report, when it answered. */
	health: unknown;
	instance: string;
}

export class ConductedSpikeWorkspace extends DurableObject<SpikeEnv> {
	private readonly container: Container;
	private readonly backups: DirectoryBackup;
	private setup: Promise<void> | null = null;
	private queue: Promise<unknown> = Promise.resolve();

	constructor(ctx: DurableObjectState, env: SpikeEnv) {
		super(ctx, env);
		const container = ctx.container;
		if (!container) throw new Error("No container is configured");
		this.container = container;
		this.backups = new DirectoryBackup(container, ctx.exports.DirectoryBackupGateway, {
			binding: "BACKUPS",
			prefix: "conducted-spike/",
		});
		if (container.running) {
			void ctx.blockConcurrencyWhile(() => container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS));
		}
	}

	/** Runs disk operations one at a time, so a backup never races a write. */
	private exclusive<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.queue.then(operation);
		this.queue = result.catch(() => {});
		return result;
	}

	private ensureSetUp(): Promise<void> {
		if (this.setup === null || !this.container.running) {
			this.setup = this.setUp().catch((error) => {
				this.setup = null;
				throw error;
			});
		}
		return this.setup;
	}

	private async setUp(): Promise<void> {
		if (!this.container.running) {
			this.container.start({
				image: this.container.images.sandbox,
				instance: this.env.INSTANCE_TYPE,
				enableInternet: false,
				env: CONTAINER_ENV,
			});
		}
		try {
			await this.container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS);
			// The backup route must be registered before the catch-all.
			await this.backups.intercept();
			const outbound = this.ctx.exports.Outbound({ props: {} });
			await this.container.interceptAllOutboundHttp(outbound);
			await this.container.interceptOutboundHttps("*", outbound);
		} catch (error) {
			await this.container.destroy();
			throw error;
		}
	}

	async start(): Promise<StartReport> {
		const began = Date.now();
		const started = !this.container.running;
		await this.ensureSetUp();
		const deadline = began + READY_DEADLINE_MS;
		while (Date.now() < deadline) {
			try {
				const response = await this.container
					.getTcpPort(PORT)
					.fetch("http://container/health", { signal: AbortSignal.timeout(2_000) });
				if (response.status === 200) {
					return {
						started,
						readyMs: Date.now() - began,
						health: await response.json(),
						instance: this.env.INSTANCE_TYPE,
					};
				}
				await response.body?.cancel();
			} catch {
				// The port is not open yet.
			}
			await scheduler.wait(250);
		}
		throw new Error(`The sidecar did not answer within ${READY_DEADLINE_MS} ms`);
	}

	async run(
		argv: string[],
		cwd = "/",
	): Promise<{ exitCode: number; stdout: string; stderr: string }> {
		return this.exclusive(async () => {
			if (!this.container.running) throw new Error("The sandbox is not running");
			await this.ensureSetUp();
			const process = await this.container.exec(argv, { cwd, env: CONTAINER_ENV });
			const output = await process.output();
			const decoder = new TextDecoder();
			return {
				exitCode: output.exitCode,
				stdout: decoder.decode(output.stdout),
				stderr: decoder.decode(output.stderr),
			};
		});
	}

	async backup(dir: string): Promise<DirectoryBackupRecord & { ms: number }> {
		return this.exclusive(async () => {
			// A stopped sandbox has nothing to save; starting it would back up the bare image.
			if (!this.container.running) throw new Error("The sandbox is not running");
			await this.ensureSetUp();
			const began = Date.now();
			const record = await this.backups.backup({ dir, name: `conducted-spike ${dir}` });
			const records = (await this.ctx.storage.get<DirectoryBackupRecord[]>("backups")) ?? [];
			await this.ctx.storage.put("backups", [...records.filter((r) => r.dir !== dir), record]);
			await this.ctx.storage.put("allBackups", [
				...((await this.ctx.storage.get<DirectoryBackupRecord[]>("allBackups")) ?? []),
				record,
			]);
			return { ...record, ms: Date.now() - began };
		});
	}

	async restore(dir: string, id?: string): Promise<{ ms: number; record: DirectoryBackupRecord }> {
		return this.exclusive(async () => {
			if (!this.container.running) throw new Error("The sandbox is not running");
			await this.ensureSetUp();
			const latest = (await this.ctx.storage.get<DirectoryBackupRecord[]>("backups")) ?? [];
			const all = (await this.ctx.storage.get<DirectoryBackupRecord[]>("allBackups")) ?? [];
			const record =
				id === undefined
					? latest.find((r) => r.dir === dir)
					: all.find((r) => r.id === id && r.dir === dir);
			if (record === undefined) throw new Error(`No backup of ${dir}`);
			const began = Date.now();
			await this.backups.restore(record);
			return { ms: Date.now() - began, record };
		});
	}

	async destroy(): Promise<{ wasRunning: boolean }> {
		const wasRunning = this.container.running;
		if (wasRunning) await this.container.destroy("conducted-spike destroy");
		this.setup = null;
		return { wasRunning };
	}

	async forget(): Promise<{ deleted: string[] }> {
		const records = (await this.ctx.storage.get<DirectoryBackupRecord[]>("allBackups")) ?? [];
		const deleted: string[] = [];
		for (const record of records) {
			await this.backups.delete(record);
			deleted.push(record.id);
		}
		await this.ctx.storage.deleteAll();
		return { deleted };
	}

	/** The WebSocket relay. Accepting both ends keeps the sandbox running while the desktop is connected. */
	async fetch(request: Request): Promise<Response> {
		await this.start();
		const upstreamResponse = await this.container
			.getTcpPort(PORT)
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
		const relay = (from: WebSocket, to: WebSocket): void => {
			from.addEventListener("message", (event) => {
				try {
					to.send(event.data);
				} catch {
					from.close(1011, "The other side closed");
				}
			});
			from.addEventListener("close", (event) => {
				const code = event.code === 1005 || event.code === 1006 ? 1000 : event.code;
				try {
					to.close(code, event.reason);
				} catch {}
			});
		};
		relay(server, upstream);
		relay(upstream, server);
		return new Response(null, { status: 101, webSocket: client });
	}
}

const NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Compares two strings in time that does not depend on where they differ. */
function sameToken(given: string, expected: string): boolean {
	const a = new TextEncoder().encode(given);
	const b = new TextEncoder().encode(expected);
	if (a.byteLength !== b.byteLength) return false;
	return crypto.subtle.timingSafeEqual(a, b);
}

export default {
	async fetch(request: Request, env: SpikeEnv): Promise<Response> {
		const auth = request.headers.get("authorization") ?? "";
		if (env.PAIRING_TOKEN === undefined || !sameToken(auth, `Bearer ${env.PAIRING_TOKEN}`)) {
			return new Response("Unauthorized", { status: 401 });
		}
		const url = new URL(request.url);
		const match = /^\/w\/([^/]+)\/(start|rpc|exec|backup|restore|destroy|forget)$/.exec(
			url.pathname,
		);
		if (!match) return new Response("Not found", { status: 404 });
		const [, name, action] = match as unknown as [string, string, string];
		if (!NAME.test(name)) return new Response("Bad workspace name", { status: 400 });
		const workspace = env.WORKSPACE.getByName(name);
		try {
			switch (action) {
				case "rpc":
					if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
						return new Response("Expected a WebSocket", { status: 426 });
					}
					return workspace.fetch(request);
				case "start":
					return Response.json(await workspace.start());
				case "exec": {
					const body = (await request.json()) as { argv: string[]; cwd?: string };
					return Response.json(await workspace.run(body.argv, body.cwd));
				}
				case "backup": {
					const body = (await request.json()) as { dir: string };
					return Response.json(await workspace.backup(body.dir));
				}
				case "restore": {
					const body = (await request.json()) as { dir: string; id?: string };
					return Response.json(await workspace.restore(body.dir, body.id));
				}
				case "destroy":
					return Response.json(await workspace.destroy());
				case "forget":
					return Response.json(await workspace.forget());
			}
			return new Response("Not found", { status: 404 });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error(`${action} failed: ${message}`);
			return Response.json({ error: message }, { status: 500 });
		}
	},
} satisfies ExportedHandler<SpikeEnv>;
