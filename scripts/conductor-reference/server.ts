/**
 * The reference server: serves another app's built frontend from a folder, with the stand-in
 * (standin.ts) injected before its first module, and answers the page's native calls through the
 * reference backend (backend.ts), one page session at a time.
 *
 * - It binds 127.0.0.1 on a free port and prints the address. It serves only the bundle folder's own
 *   files and its own `/__reference/` routes; every other path gets the frontend's `index.html`, as a
 *   single-page app expects. The page is sent with a content security policy that allows only its own
 *   origin, so the browser refuses every other host; the screenshot run also blocks them.
 * - `/__reference/open/<state>` remembers the catalogue state in a cookie and sends the browser to the
 *   route the mapping gives for it. Each page load then gets its own session: fresh copies of the
 *   state's databases and its own event stream. Sessions are kept until the server stops.
 * - `/__reference/log` lists, per state, every call nobody answered and every asset request.
 *
 * Usage: bun scripts/conductor-reference/server.ts [--bundle <dir>] [--mapping <file>] [--port <n>]
 * The defaults are the git-ignored folders of the main checkout (paths.ts).
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import {
	type BackendSession,
	openSession,
	type Push,
	type ReferenceMapping,
	UnansweredLog,
} from "./backend.ts";
import { type Catalogue, loadCatalogue, type SeededState } from "./catalogue.ts";
import { defaultPaths } from "./paths.ts";
import { buildDatabase } from "./sql-plugin.ts";
import { loadSqlJs, type SqlJsStatic } from "./sqljs-types.ts";
import type { StandinBoot } from "./standin.ts";

export const BASE = "/__reference";
const STATE_COOKIE = "reference-state";

/** Only this origin, so the page can reach no other host. Inline and eval are the bundle's own. */
export const CONTENT_POLICY =
	"default-src 'self' data: blob: 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'";

export const TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
	".otf": "font/otf",
	".mp3": "audio/mpeg",
	".mp4": "video/mp4",
	".wasm": "application/wasm",
	".txt": "text/plain; charset=utf-8",
};

/** Puts `inject` before the page's first module script, or before `</head>` when it has none. */
export function injectBefore(html: string, inject: string): string {
	const module = /<script\b[^>]*type=["']module["']/i.exec(html);
	if (module !== null) return html.slice(0, module.index) + inject + html.slice(module.index);
	const head = html.search(/<\/head>/i);
	if (head === -1) throw new Error("The bundle's index.html has no module script and no </head>.");
	return html.slice(0, head) + inject + html.slice(head);
}

/** The stand-in as one classic script: its types stripped, then called with the page's boot data. */
export function standinScript(): string {
	const source = readFileSync(join(import.meta.dir, "standin.ts"), "utf8");
	const code = new Bun.Transpiler({ loader: "ts" })
		.transformSync(source)
		.replace(/^export\s+(?=function\b)/gm, "");
	if (/^\s*(export|import)\b/m.test(code)) {
		throw new Error("standin.ts must have no imports and export only functions.");
	}
	return `(() => {\n${code}\ninstallStandin(window, window.__REFERENCE_BOOT__);\n})();\n`;
}

/** The file under `dir` that `pathname` names, or null when it names none or leaves the folder. */
export function fileUnder(dir: string, pathname: string): string | null {
	let decoded: string;
	try {
		decoded = decodeURIComponent(pathname);
	} catch {
		return null;
	}
	const root = resolve(dir);
	const path = resolve(root, `.${decoded}`);
	if (path !== root && !path.startsWith(root + sep)) return null;
	return existsSync(path) && statSync(path).isFile() ? path : null;
}

interface Prepared {
	seeded: SeededState;
	route: string | null;
	databases: { name: string; bytes: Uint8Array }[];
}

interface Session {
	state: string;
	backend: BackendSession;
	queue: Push[];
	write?: (push: Push) => void;
}

export interface ReferenceServer {
	url: string;
	port: number;
	stop(): Promise<void>;
}

const escapeHtml = (text: string): string =>
	text.replace(/[&<>"]/g, (char) => `&#${char.charCodeAt(0)};`);

function indexPage(catalogue: Catalogue): string {
	const rows = catalogue.states
		.map(
			(state) =>
				`<li><a href="${BASE}/open/${encodeURIComponent(state.id)}">${escapeHtml(state.id)}</a> ${escapeHtml(state.title)}</li>`,
		)
		.join("\n");
	return `<!doctype html><meta charset="utf-8"><title>Reference states</title><h1>Reference states</h1><ul>${rows}</ul>`;
}

const cookieState = (request: Request): string | null => {
	const cookie = request.headers.get("cookie") ?? "";
	const match = new RegExp(`(?:^|;\\s*)${STATE_COOKIE}=([^;]+)`).exec(cookie);
	return match?.[1] === undefined ? null : decodeURIComponent(match[1]);
};

export async function startReferenceServer(options: {
	bundleDir: string;
	mapping: ReferenceMapping<SeededState>;
	catalogue: Catalogue;
	SQL?: SqlJsStatic;
	port?: number;
}): Promise<ReferenceServer> {
	const { bundleDir, mapping, catalogue } = options;
	const SQL = options.SQL ?? (await loadSqlJs());
	const indexFile = join(bundleDir, "index.html");
	if (!existsSync(indexFile)) throw new Error(`${bundleDir} has no index.html.`);
	const script = standinScript();
	const prepared = new Map<string, Promise<Prepared>>();
	const sessions = new Map<string, Session>();
	const logs = new Map<string, UnansweredLog>();
	const assets = new Map<string, string[]>();
	const encoder = new TextEncoder();

	const logFor = (state: string): UnansweredLog => {
		let log = logs.get(state);
		if (log === undefined) {
			log = new UnansweredLog();
			logs.set(state, log);
		}
		return log;
	};
	const prepare = (id: string): Promise<Prepared> => {
		let ready = prepared.get(id);
		if (ready === undefined) {
			ready = (async () => {
				const seeded = await catalogue.seed(id);
				const databases = mapping.databases(seeded).map((seed) => ({
					name: seed.name,
					bytes: buildDatabase(SQL, seed),
				}));
				return { seeded, route: mapping.route(seeded), databases };
			})();
			prepared.set(id, ready);
		}
		return ready;
	};

	const page = async (state: string): Promise<Response> => {
		const { seeded, databases } = await prepare(state);
		const id = crypto.randomUUID();
		const session: Session = { state, queue: [], backend: undefined as unknown as BackendSession };
		session.backend = openSession({
			SQL,
			mapping,
			state: seeded,
			databases,
			log: logFor(state),
			push: (push) =>
				session.write === undefined ? session.queue.push(push) : session.write(push),
		});
		sessions.set(id, session);
		const bootData = await mapping.boot(seeded);
		const boot: StandinBoot = {
			session: id,
			base: BASE,
			windowLabel: bootData.windowLabel,
			webviewLabel: bootData.webviewLabel,
			globals: bootData.globals,
		};
		const inject = `<script>window.__REFERENCE_BOOT__=${JSON.stringify(boot).replace(/</g, "\\u003c")};</script><script src="${BASE}/standin.js"></script>`;
		const html = injectBefore(readFileSync(indexFile, "utf8"), inject);
		return new Response(html, {
			headers: {
				"content-type": TYPES[".html"] as string,
				"content-security-policy": CONTENT_POLICY,
			},
		});
	};

	const sessionOf = (request: Request): Session | null =>
		sessions.get(request.headers.get("x-reference-session") ?? "") ?? null;

	const reference = async (request: Request, route: string, url: URL): Promise<Response> => {
		if (route.startsWith("/open/")) {
			const state = decodeURIComponent(route.slice("/open/".length));
			if (!catalogue.states.some((candidate) => candidate.id === state)) {
				return new Response(`Unknown state ${state}`, { status: 404 });
			}
			const { route: target } = await prepare(state);
			if (target === null)
				return new Response(`The reference has no screen for ${state}.`, { status: 404 });
			return new Response(null, {
				status: 302,
				headers: {
					location: target,
					"set-cookie": `${STATE_COOKIE}=${encodeURIComponent(state)}; Path=/; SameSite=Strict`,
				},
			});
		}
		if (route === "/states") {
			const states = await Promise.all(
				catalogue.states.map(async (state) => ({
					...state,
					route: (await prepare(state.id)).route,
				})),
			);
			return Response.json(states);
		}
		if (route === "/standin.js") {
			return new Response(script, { headers: { "content-type": TYPES[".js"] as string } });
		}
		if (route === "/log") {
			const states = [...new Set([...logs.keys(), ...assets.keys()])].sort();
			return Response.json(
				Object.fromEntries(
					states.map((state) => [
						state,
						{ unanswered: logs.get(state)?.list() ?? [], assets: assets.get(state) ?? [] },
					]),
				),
			);
		}
		if (route === "/asset") {
			const state = cookieState(request) ?? "(none)";
			const list = assets.get(state) ?? [];
			list.push(url.searchParams.get("path") ?? "");
			assets.set(state, list);
			return new Response("The reference serves no local files.", { status: 404 });
		}
		const session = sessionOf(request);
		if (session === null) return new Response("Unknown page session.", { status: 400 });
		if (route === "/invoke" && request.method === "POST") {
			const body = (await request.json()) as { command?: unknown; args?: unknown };
			const args = typeof body.args === "object" && body.args !== null ? body.args : {};
			return Response.json(
				await session.backend.invoke(String(body.command), args as Record<string, unknown>),
			);
		}
		if (route === "/events") {
			const stream = new ReadableStream<Uint8Array>({
				start(controller) {
					session.write = (push) => controller.enqueue(encoder.encode(`${JSON.stringify(push)}\n`));
					for (const push of session.queue.splice(0)) session.write(push);
				},
				cancel() {
					session.write = undefined;
				},
			});
			return new Response(stream, { headers: { "content-type": "application/x-ndjson" } });
		}
		return new Response("Not found.", { status: 404 });
	};

	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: options.port ?? 0,
		// Event streams stay open as long as the page does.
		idleTimeout: 0,
		fetch: async (request) => {
			const url = new URL(request.url);
			try {
				if (url.pathname.startsWith(`${BASE}/`)) {
					return await reference(request, url.pathname.slice(BASE.length), url);
				}
				if (request.method !== "GET") return new Response("Not found.", { status: 404 });
				const file = url.pathname === "/" ? null : fileUnder(bundleDir, url.pathname);
				if (file !== null) {
					return new Response(Bun.file(file), {
						headers: { "content-type": TYPES[extname(file)] ?? "application/octet-stream" },
					});
				}
				if (extname(url.pathname) !== "") return new Response("Not found.", { status: 404 });
				const state = cookieState(request);
				if (state === null || !catalogue.states.some((candidate) => candidate.id === state)) {
					return new Response(indexPage(catalogue), {
						headers: { "content-type": TYPES[".html"] as string },
					});
				}
				return await page(state);
			} catch (cause) {
				const message = cause instanceof Error ? cause.message : String(cause);
				console.error(`[reference] ${url.pathname}: ${message}`);
				return new Response(message, { status: 500 });
			}
		},
	});

	const port = server.port as number;
	return {
		url: `http://127.0.0.1:${port}/`,
		port,
		stop: async () => {
			for (const session of sessions.values()) session.backend.close();
			sessions.clear();
			await server.stop(true);
		},
	};
}

/** Loads the mapping module (its default export) and checks its shape. */
export async function loadMapping(path: string): Promise<ReferenceMapping<SeededState>> {
	const loaded = ((await import(resolve(path))) as { default?: unknown }).default;
	const mapping = loaded as Partial<ReferenceMapping<SeededState>> | undefined;
	const missing = (["route", "databases", "boot"] as const).filter(
		(name) => typeof mapping?.[name] !== "function",
	);
	if (mapping === undefined || missing.length > 0 || typeof mapping.commands !== "object") {
		throw new Error(`${path} must export default { route, databases, boot, commands, sidecar }.`);
	}
	return mapping as ReferenceMapping<SeededState>;
}

/** Reads `--name value` from the arguments. */
export const flag = (args: readonly string[], name: string): string | undefined => {
	const index = args.indexOf(`--${name}`);
	return index === -1 ? undefined : args[index + 1];
};

if (import.meta.main) {
	const args = process.argv.slice(2);
	const paths = defaultPaths();
	const port = flag(args, "port");
	const server = await startReferenceServer({
		bundleDir: flag(args, "bundle") ?? paths.bundle,
		mapping: await loadMapping(flag(args, "mapping") ?? paths.mapping),
		catalogue: await loadCatalogue(),
		port: port === undefined ? undefined : Number(port),
	});
	console.log(`Conductor reference: ${server.url}`);
	const stop = (): void => {
		void server.stop().finally(() => process.exit(0));
	};
	process.once("SIGINT", stop);
	process.once("SIGTERM", stop);
}
