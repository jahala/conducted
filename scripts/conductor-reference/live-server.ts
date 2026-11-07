/**
 * The live reference server (stage 2): it joins a frontend in Playwright's Chromium to our real app.
 *
 * - It listens on our dev origin (live-config.ts `DEV_ORIGIN`), the one origin a dev build of our
 *   app keeps in its window. Our app's window loads the bridge page there (bridge.ts) and takes jobs:
 *   every call a frontend makes reaches our real commands, plugins, events and channels through it.
 * - A frontend page is opened at `/__reference/open/<state>?front=conductor|ours`. Conductor's bundle
 *   (from the main checkout's `.context/`) or our own built UI (`apps/desktop/dist`) is served with the
 *   stand-in (standin.ts) injected before its first module, under a policy that allows only this
 *   origin; the browser run (live.ts) also refuses every other origin.
 * - Each page load gets a translator session (translator.ts) with the front's mapping: Conductor's
 *   name-by-name mapping, or the identity mapping for our own UI. Our events and channel messages go
 *   to the session of the page that is open.
 * - The host refuses a few of our commands for every front, whatever the mapping says, because they
 *   would reach past the run's scratch folder: the owner's keychain and clipboard, dialogs and
 *   notifications on the owner's screen, opening apps, files or System Settings, the microphone, and
 *   quitting or relaunching the app mid-run. Each is answered with `REFUSED_CODE` and recorded.
 * - Every call is recorded per state and front with its outcome (`calls()`), for `live.json`.
 */
import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import type { Push } from "./backend.ts";
import { BRIDGE_PATH, BRIDGE_POLICY, DEV_ORIGIN } from "./live-config.ts";
import { CONTENT_POLICY, fileUnder, injectBefore, standinScript, TYPES } from "./server.ts";
import type { StandinBoot } from "./standin.ts";
import {
	type CallRecord,
	type LiveAnswer,
	type LiveMapping,
	type LiveSession,
	type Ours,
	openLiveSession,
	REFUSED_CODE,
} from "./translator.ts";

export const BASE = "/__reference";
const COOKIE = "reference-live";

export type Front = "conductor" | "ours";

/** Our commands the host never lets through, by name or prefix, with the reason. */
export const HOST_REFUSALS: readonly { match: RegExp; reason: string }[] = [
	{ match: /^keychain_/, reason: "the live run never reads or writes the owner's keychain" },
	{
		match: /^plugin:clipboard-manager\||^clipboard_/,
		reason: "the owner's clipboard stays untouched",
	},
	{ match: /^plugin:dialog\|/, reason: "no dialog opens on the owner's screen" },
	{
		match: /^notify$|^plugin:notification\|/,
		reason: "no notification shows on the owner's screen",
	},
	{
		match: /^plugin:opener\||^open_with$|^reveal_in_finder$|^full_disk_access_open_settings$/,
		reason: "nothing opens on the owner's screen",
	},
	{ match: /^speech_start$/, reason: "the microphone stays off" },
	{
		match: /^app_quit$|^updater_install$|^updater_relaunch$|^plugin:process\|/,
		reason: "the app keeps running for the run",
	},
	{ match: /^window_toggle_inspector$/, reason: "no inspector opens on the owner's screen" },
];

export function hostRefusal(command: string): string | null {
	return HOST_REFUSALS.find((rule) => rule.match.test(command))?.reason ?? null;
}

/** What one open page runs against: its state, its front's mapping and its boot data. */
export interface Opening<State> {
	state: string;
	front: Front;
	route: string;
	mapping: LiveMapping<State>;
	context: State;
	globals: Record<string, unknown>;
}

export interface CallTally {
	state: string;
	front: Front;
	kind: CallRecord["kind"];
	name: string;
	outcome: CallRecord["outcome"];
	count: number;
	via: string[];
	details: string[];
	decision?: string;
}

interface PageSession {
	session: LiveSession;
	queue: Push[];
	write?: (push: Push) => void;
}

export interface LiveServer {
	/** Where the server listens. */
	url: string;
	/** Resolves when our app's bridge page has asked for jobs. */
	bridged(): Promise<void>;
	/** Calls one of our commands directly, as the run does to seed the database. */
	ours: Ours;
	/** Makes the next page open run against this. */
	prepare<State>(opening: Opening<State>): void;
	calls(): CallTally[];
	/** Our commands asked and not answered yet, by name. */
	pending(): string[];
	/** Forgets the bridge, so the next app run connects afresh. */
	resetBridge(): void;
	stop(): Promise<void>;
}

/** The bridge page script: bridge.ts with its types stripped, then started. */
export function bridgeScript(): string {
	const source = readFileSync(join(import.meta.dir, "bridge.ts"), "utf8");
	const code = new Bun.Transpiler({ loader: "ts" })
		.transformSync(source)
		.replace(/^export\s+(?=function\b)/gm, "");
	if (/^\s*(export|import)\b/m.test(code)) throw new Error("bridge.ts must have no imports.");
	return `(() => {\n${code}\ninstallBridge(window, { base: ${JSON.stringify(BASE)} });\n})();\n`;
}

const BRIDGE_PAGE = `<!doctype html><meta charset="utf-8"><title>Conducted reference bridge</title><p>This window carries the live reference run's calls to the app.</p><script src="${BASE}/bridge.js"></script>`;

const cookieOf = (request: Request): { state: string; front: Front } | null => {
	const match = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(
		request.headers.get("cookie") ?? "",
	);
	if (match?.[1] === undefined) return null;
	const [state, front] = decodeURIComponent(match[1]).split("|");
	return state === undefined || (front !== "conductor" && front !== "ours")
		? null
		: { state, front };
};

export async function startLiveServer(options: {
	bundles: Record<Front, string>;
	/** Our dev origin's port unless given; a test passes 0 for a free one. */
	port?: number;
}): Promise<LiveServer> {
	for (const [front, dir] of Object.entries(options.bundles)) {
		if (!existsSync(join(dir, "index.html")))
			throw new Error(`The ${front} bundle at ${dir} has no index.html.`);
	}
	const standin = standinScript();
	const bridge = bridgeScript();
	const encoder = new TextEncoder();
	const tallies = new Map<string, CallTally>();
	const pages = new Map<string, PageSession>();
	let opening: Opening<unknown> | null = null;
	let current: PageSession | null = null;

	// The bridge: jobs out, answers, events and channel messages in.
	let nextJob = 1;
	const waiting = new Map<number, (answer: LiveAnswer) => void>();
	const waitingNames = new Map<number, string>();
	let writeJob: ((line: string) => void) | null = null;
	let jobQueue: string[] = [];
	let connected: () => void = () => {};
	let bridgedOnce = new Promise<void>((resolve) => {
		connected = resolve;
	});
	const sendJob = (job: unknown): void => {
		const line = `${JSON.stringify(job)}\n`;
		if (writeJob === null) jobQueue.push(line);
		else writeJob(line);
	};
	const ours: Ours = {
		invoke: (command, args, bytes) => {
			const refusal = hostRefusal(command);
			if (refusal !== null) {
				// The key a keychain call names says which secret was asked for; never its value.
				const key = (args as { key?: unknown } | null)?.key;
				const message = typeof key === "string" ? `${refusal} (key ${key})` : refusal;
				return Promise.resolve({ ok: false, error: { code: REFUSED_CODE, message } });
			}
			const job = nextJob++;
			const answer = new Promise<LiveAnswer>((resolve) => waiting.set(job, resolve));
			waitingNames.set(job, command);
			sendJob({ job, command, args, ...(bytes === true ? { bytes } : {}) });
			return answer;
		},
	};
	const listened = new Set<string>();
	const listenOurs = (event: string): void => {
		if (listened.has(event)) return;
		listened.add(event);
		sendJob({ listen: event });
	};

	const tally = (state: string, front: Front, record: CallRecord): void => {
		const key = `${state}|${front}|${record.kind}|${record.name}|${record.outcome}`;
		let entry = tallies.get(key);
		if (entry === undefined) {
			entry = {
				state,
				front,
				kind: record.kind,
				name: record.name,
				outcome: record.outcome,
				count: 0,
				via: [],
				details: [],
			};
			tallies.set(key, entry);
		}
		entry.count += 1;
		for (const name of record.via) if (!entry.via.includes(name)) entry.via.push(name);
		if (
			record.detail !== undefined &&
			!entry.details.includes(record.detail) &&
			entry.details.length < 20
		) {
			entry.details.push(record.detail);
		}
		if (record.decision !== undefined) entry.decision = record.decision;
	};

	const page = (dir: string, prepared: Opening<unknown>): Response => {
		const id = crypto.randomUUID();
		const pageSession: PageSession = {
			queue: [],
			session: undefined as unknown as LiveSession,
		};
		pageSession.session = openLiveSession({
			mapping: prepared.mapping,
			state: prepared.context,
			ours,
			push: (push) =>
				pageSession.write === undefined ? pageSession.queue.push(push) : pageSession.write(push),
			record: (record) => tally(prepared.state, prepared.front, record),
		});
		pages.set(id, pageSession);
		current = pageSession;
		const boot: StandinBoot = {
			session: id,
			base: BASE,
			windowLabel: "main",
			webviewLabel: "main",
			globals: prepared.globals,
		};
		const inject = `<script>window.__REFERENCE_BOOT__=${JSON.stringify(boot).replace(/</g, "\\u003c")};</script><script src="${BASE}/standin.js"></script>`;
		const html = injectBefore(readFileSync(join(dir, "index.html"), "utf8"), inject);
		return new Response(html, {
			headers: {
				"content-type": TYPES[".html"] as string,
				"content-security-policy": CONTENT_POLICY,
			},
		});
	};

	const reference = async (request: Request, route: string, url: URL): Promise<Response> => {
		if (route === "/bridge.js")
			return new Response(bridge, { headers: { "content-type": TYPES[".js"] as string } });
		if (route === "/standin.js")
			return new Response(standin, { headers: { "content-type": TYPES[".js"] as string } });
		if (route === "/bridge/jobs") {
			let mine: ((line: string) => void) | null = null;
			const stream = new ReadableStream<Uint8Array>({
				start(controller) {
					const write = (line: string): void => controller.enqueue(encoder.encode(line));
					writeJob = write;
					for (const line of jobQueue.splice(0)) write(line);
					connected();
					// A stream that ends after the next app connected must not take its writer away.
					mine = write;
				},
				cancel() {
					if (writeJob === mine) writeJob = null;
				},
			});
			return new Response(stream, { headers: { "content-type": "application/x-ndjson" } });
		}
		if (route === "/bridge/done" && request.method === "POST") {
			const answer = (await request.json()) as {
				job: number;
				ok: boolean;
				value?: unknown;
				error?: unknown;
			};
			const resolve = waiting.get(answer.job);
			waiting.delete(answer.job);
			waitingNames.delete(answer.job);
			resolve?.(
				answer.ok ? { ok: true, value: answer.value ?? null } : { ok: false, error: answer.error },
			);
			return new Response(null, { status: 204 });
		}
		if (route === "/bridge/push" && request.method === "POST") {
			const push = (await request.json()) as Push;
			if (push.kind === "event") current?.session.ourEvent(push.event, push.payload);
			else current?.session.ourChannel(push.channel, push.message);
			return new Response(null, { status: 204 });
		}
		if (route.startsWith("/open/")) {
			const state = decodeURIComponent(route.slice("/open/".length));
			const front = url.searchParams.get("front");
			if (opening === null || opening.state !== state || opening.front !== front) {
				return new Response(`The run has not prepared ${state} for ${String(front)}.`, {
					status: 409,
				});
			}
			return new Response(null, {
				status: 302,
				headers: {
					location: opening.route,
					"set-cookie": `${COOKIE}=${encodeURIComponent(`${state}|${front}`)}; Path=/; SameSite=Strict`,
				},
			});
		}
		const pageSession = pages.get(request.headers.get("x-reference-session") ?? "");
		if (pageSession === undefined) return new Response("Unknown page session.", { status: 400 });
		if (route === "/invoke" && request.method === "POST") {
			const body = (await request.json()) as { command?: unknown; args?: unknown; bytes?: unknown };
			const args = typeof body.args === "object" && body.args !== null ? body.args : {};
			return Response.json(
				await pageSession.session.invoke(
					String(body.command),
					args as Record<string, unknown>,
					body.bytes === true,
				),
			);
		}
		if (route === "/listen" && request.method === "POST") {
			const body = (await request.json()) as { event?: unknown };
			pageSession.session.listen(String(body.event));
			return new Response(null, { status: 204 });
		}
		if (route === "/events") {
			const stream = new ReadableStream<Uint8Array>({
				start(controller) {
					pageSession.write = (push) =>
						controller.enqueue(encoder.encode(`${JSON.stringify(push)}\n`));
					for (const push of pageSession.queue.splice(0)) pageSession.write(push);
				},
				cancel() {
					pageSession.write = undefined;
				},
			});
			return new Response(stream, { headers: { "content-type": "application/x-ndjson" } });
		}
		return new Response("Not found.", { status: 404 });
	};

	const port = options.port ?? Number(new URL(DEV_ORIGIN).port);
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port,
		idleTimeout: 0,
		fetch: async (request) => {
			const url = new URL(request.url);
			try {
				if (url.pathname === BRIDGE_PATH) {
					return new Response(BRIDGE_PAGE, {
						headers: {
							"content-type": TYPES[".html"] as string,
							"content-security-policy": BRIDGE_POLICY,
						},
					});
				}
				if (url.pathname.startsWith(`${BASE}/`))
					return await reference(request, url.pathname.slice(BASE.length), url);
				if (request.method !== "GET") return new Response("Not found.", { status: 404 });
				const chosen = cookieOf(request);
				if (
					chosen === null ||
					opening === null ||
					opening.state !== chosen.state ||
					opening.front !== chosen.front
				) {
					return new Response("Open a state through /__reference/open/<state>?front=<front>.", {
						status: 404,
					});
				}
				const dir = options.bundles[chosen.front];
				const file = url.pathname === "/" ? null : fileUnder(dir, url.pathname);
				if (file !== null) {
					return new Response(Bun.file(file), {
						headers: { "content-type": TYPES[extname(file)] ?? "application/octet-stream" },
					});
				}
				if (extname(url.pathname) !== "") return new Response("Not found.", { status: 404 });
				return page(dir, opening);
			} catch (cause) {
				const message = cause instanceof Error ? cause.message : String(cause);
				console.error(`[live] ${url.pathname}: ${message}`);
				return new Response(message, { status: 500 });
			}
		},
	});

	return {
		url: `http://127.0.0.1:${server.port}`,
		bridged: () => bridgedOnce,
		ours,
		prepare: (next) => {
			opening = next as Opening<unknown>;
			pages.clear();
			current = null;
			// A mapping that passes other events on hears every event of ours.
			const events =
				next.mapping.otherEvent === undefined ? Object.keys(next.mapping.events) : OUR_EVENTS;
			for (const event of events) listenOurs(event);
		},
		calls: () => [...tallies.values()],
		pending: () => [...waitingNames.values()],
		resetBridge: () => {
			writeJob = null;
			jobQueue = [];
			listened.clear();
			for (const resolve of waiting.values()) resolve({ ok: false, error: "the app stopped" });
			waiting.clear();
			waitingNames.clear();
			bridgedOnce = new Promise<void>((resolve) => {
				connected = resolve;
			});
		},
		stop: async () => {
			await server.stop(true);
		},
	};
}

/** Every event our app emits (platform/tauri.ts `EVENTS`), so the identity front hears them all. */
export const OUR_EVENTS = [
	"tauri://focus",
	"tauri://blur",
	"app://quit-requested",
	"app://deep-link",
	"app://deep-link-rejected",
	"shell://done",
	"pty://exit",
	"sidecar://line",
	"sidecar://restart",
	"notification://clicked",
	"updater://status",
	"menu://command",
	"network://changed",
	"programs://status",
	"programs://verification-errors",
] as const;
