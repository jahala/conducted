/**
 * @feature CHAT-22 Codex visualizations in the chat
 * Owns: the browser check that a Codex visualization's inline scripts run under the app's
 * production content security policy, and that its frame stays shut off from the app and the
 * network.
 * Behaviour: issue #466. The app's policy (`app.security.csp` in tauri.conf.json) has
 * `script-src 'self'`, which a `srcdoc` frame inherits. The app serves each visualization from the
 * `visualization` scheme instead (visualization.rs), with the page's own policy as a header.
 * Must handle: the app's policy comes from tauri.conf.json, and the page's policy and the scheme's
 * name from visualization.rs, unchanged; the frame is built with the app's own document and
 * sandbox (visualization-frame.ts); "the script ran" is read inside the frame after its load
 * event, so the answer does not depend on a timer; the instrument is checked on a known case
 * first.
 * Our design choice: Chromium cannot serve an app's custom scheme, so a local server stands in for
 * it at `http://visualization.localhost:<port>`, and that origin takes the scheme's place in the
 * app policy's `frame-src`. The policy's other frame sources (`http://localhost:*`,
 * `http://127.0.0.1:*`) do not match that host, so the frame loads only through the scheme's slot.
 * Test first: the visualization's inline script runs in the app's frame under the production
 * policy.
 *
 * Usage: bun scripts/visualization/frame-policy.browser.ts
 * It uses the Chromium already in Playwright's cache, downloads nothing, and exits 1 when a case
 * fails.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { type Browser, chromium } from "playwright-core";
import {
	FRAME_SANDBOX,
	frameDocument,
	HEIGHT_MESSAGE,
} from "../../apps/desktop/src/features/chat/visualization-frame.ts";

const ROOT = resolve(import.meta.dir, "../..");
const CONFIG = join(ROOT, "apps/desktop/src-tauri/tauri.conf.json");
const RUST = join(ROOT, "apps/desktop/src-tauri/src/visualization.rs");
/** Catches a page that hangs. It is not a way to wait. */
const HANG_MS = 15_000;

/** One `pub const NAME: &str = "...";` of visualization.rs. */
function rustString(source: string, name: string): string {
	const found = new RegExp(`pub const ${name}: &str = "([^"]*)";`).exec(source);
	if (found?.[1] === undefined) throw new Error(`visualization.rs has no ${name}.`);
	return found[1];
}

const RUST_SOURCE = readFileSync(RUST, "utf8");
const SCHEME = rustString(RUST_SOURCE, "SCHEME");
const FRAME_POLICY = rustString(RUST_SOURCE, "FRAME_POLICY");
const FRAME_HOST = `${SCHEME}.localhost`;

function productionPolicy(): string {
	const config = JSON.parse(readFileSync(CONFIG, "utf8")) as {
		app: { security: { csp: string } };
	};
	return config.app.security.csp;
}

/** The policy's `frame-src` with the scheme's source swapped for `replacement`, or null. */
function withFrameSlot(policy: string, replacement: string | null): string | null {
	const directives = policy.split(";").map((directive) => directive.trim());
	const index = directives.findIndex((directive) => directive.startsWith("frame-src "));
	const sources = directives[index]?.split(/\s+/) ?? [];
	if (!sources.includes(`${SCHEME}:`)) return null;
	directives[index] = sources
		.flatMap((source) =>
			source === `${SCHEME}:` ? (replacement === null ? [] : [replacement]) : [source],
		)
		.join(" ");
	return directives.join("; ");
}

function escapeAttribute(text: string): string {
	return text.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}

/**
 * A visualization that marks its frame, posts to the app, tries to read the app and the other
 * frame, and tries to reach the network with a picture and a fetch.
 */
function probe(label: string, origin: string): string {
	return `<!doctype html><html><head><title>${label}</title></head><body><h1>${label}</h1><img src="${origin}/network-probe/img"><script>
window.__visualizationRan = true;
var report = { type: "probe", label: "${label}", parentReadable: true, siblingReadable: true };
try { void parent.document.title; } catch (error) { report.parentReadable = false; }
try {
  var sibling = parent.frames[0] === window ? parent.frames[1] : parent.frames[0];
  void sibling.document.title;
} catch (error) { report.siblingReadable = false; }
parent.postMessage(report, "*");
fetch("${origin}/network-probe/fetch").then(
  function () { parent.postMessage({ type: "fetch", label: "${label}", blocked: false }, "*"); },
  function () { parent.postMessage({ type: "fetch", label: "${label}", blocked: true }, "*"); }
);
</script></body></html>`;
}

/** Records every message the page hears, as the app's listener would. */
const LISTENER = `window.__messages = []; addEventListener("message", (event) => { window.__messages.push(event.data); });`;

interface Server {
	origin: string;
	frameOrigin: string;
	/** Stores a frame document as the scheme would, and answers its address. */
	store(document: string): string;
	/** Sets the app page: its policy and its frames' markup. */
	setPage(policy: string, frames: string): void;
	/** Every path requested from the app origin, and every page id requested from the frame host. */
	readonly requests: string[];
	stop(): void;
}

function startServer(): Server {
	const pages = new Map<string, string>();
	const requests: string[] = [];
	let page = { policy: "default-src 'none'", frames: "" };
	let counter = 0;
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch(request) {
			const url = new URL(request.url);
			requests.push(`${url.hostname}${url.pathname}`);
			if (url.hostname === FRAME_HOST) {
				// The stand-in for visualization.rs: a stored page with its own policy, or 404.
				const stored = pages.get(url.pathname.slice(1));
				return stored === undefined
					? new Response("No such visualization.", { status: 404 })
					: new Response(stored, {
							headers: {
								"content-type": "text/html; charset=utf-8",
								"content-security-policy": FRAME_POLICY,
							},
						});
			}
			if (url.pathname === "/listener.js") {
				return new Response(LISTENER, { headers: { "content-type": "text/javascript" } });
			}
			if (url.pathname === "/") {
				const html = `<!doctype html><html><head><script src="/listener.js"></script></head><body>${page.frames}</body></html>`;
				return new Response(html, {
					headers: { "content-type": "text/html", "content-security-policy": page.policy },
				});
			}
			return new Response("not found", { status: 404 });
		},
	});
	return {
		origin: `http://127.0.0.1:${server.port}`,
		frameOrigin: `http://${FRAME_HOST}:${server.port}`,
		store: (document) => {
			counter += 1;
			const id = `page${counter}`;
			pages.set(id, document);
			return `http://${FRAME_HOST}:${server.port}/${id}`;
		},
		setPage: (policy, frames) => {
			page = { policy, frames };
		},
		requests,
		stop: () => server.stop(true),
	};
}

/** The frame as the app renders it: its sandbox, no referrer, and the scheme's address. */
function appFrame(server: Server, html: string): string {
	const src = server.store(frameDocument(html));
	return `<iframe title="Visualization" sandbox="${FRAME_SANDBOX}" referrerpolicy="no-referrer" src="${src}"></iframe>`;
}

/** The frame as the app rendered it before #466: the same document inline, as `srcdoc`. */
function srcdocFrame(html: string): string {
	return `<iframe title="Visualization" sandbox="${FRAME_SANDBOX}" referrerpolicy="no-referrer" srcdoc="${escapeAttribute(frameDocument(html))}"></iframe>`;
}

type Message = Readonly<Record<string, unknown>>;

interface Opened {
	/** Per frame, in page order: whether its inline script ran. */
	ran: boolean[];
	/** Waits until a message with these fields has arrived, or the hang limit passes. */
	message(match: Readonly<Record<string, string>>): Promise<Message | null>;
	close(): Promise<void>;
}

/** Opens the app page, waits for each frame's load event, and reads whether its script ran. */
async function open(
	browser: Browser,
	server: Server,
	policy: string,
	frames: string,
): Promise<Opened> {
	server.setPage(policy, frames);
	const page = await browser.newPage();
	await page.goto(`${server.origin}/`, { timeout: HANG_MS });
	const ran: boolean[] = [];
	for (const element of await page.$$("iframe")) {
		const content = await element.contentFrame();
		if (content === null) throw new Error("A frame has no document.");
		await content.waitForLoadState("load", { timeout: HANG_MS });
		ran.push(
			await content.evaluate(
				() => (window as unknown as { __visualizationRan?: boolean }).__visualizationRan === true,
			),
		);
	}
	return {
		ran,
		message: async (match) => {
			const handle = await page
				.waitForFunction(
					(fields) => {
						const messages = (window as unknown as { __messages: Record<string, unknown>[] })
							.__messages;
						return (
							messages.find(
								(message) =>
									message !== null &&
									typeof message === "object" &&
									Object.entries(fields).every(([key, value]) => message[key] === value),
							) ?? null
						);
					},
					match,
					{ timeout: HANG_MS },
				)
				.catch(() => null);
			return handle === null ? null : ((await handle.jsonValue()) as Message);
		},
		close: () => page.close(),
	};
}

async function main(): Promise<number> {
	const production = productionPolicy();
	let failed = 0;
	const check = (name: string, pass: boolean, detail: string): void => {
		if (!pass) failed += 1;
		console.log(`${pass ? "ok  " : "FAIL"} ${name}${pass ? "" : `: ${detail}`}`);
	};
	const scriptSrc = production
		.split(";")
		.map((directive) => directive.trim())
		.find((directive) => directive.startsWith("script-src "));
	check(
		"the app's own script-src is 'self' only",
		scriptSrc === "script-src 'self'",
		String(scriptSrc),
	);

	const server = startServer();
	const framed = withFrameSlot(production, server.frameOrigin);
	const unframed = withFrameSlot(production, null);
	if (framed === null || unframed === null) {
		check(`the app policy's frame-src names ${SCHEME}:`, false, production);
		server.stop();
		return 1;
	}
	const browser = await chromium.launch({
		args: [`--host-resolver-rules=MAP ${FRAME_HOST} 127.0.0.1`],
	});
	try {
		// The instrument on a known case: a frame that inherits a policy allowing inline scripts
		// must read as "ran", and the same frame under the production policy must not.
		const allowed = production.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'");
		const known = await open(browser, server, allowed, srcdocFrame(probe("known", server.origin)));
		check(
			"the instrument reads a script that ran (inline scripts allowed)",
			known.ran[0] === true,
			`ran=${known.ran}`,
		);
		await known.close();
		const before = await open(
			browser,
			server,
			production,
			srcdocFrame(probe("srcdoc", server.origin)),
		);
		check(
			"the srcdoc frame of before #466 stays blocked under the production policy",
			before.ran[0] === false,
			`ran=${before.ran}`,
		);
		await before.close();

		// The deciding case: two visualizations, framed the way the app frames them. The srcdoc
		// frames above inherit the app's `img-src 'self'`, so only requests from here on count.
		const appStart = server.requests.length;
		const app = await open(
			browser,
			server,
			framed,
			appFrame(server, probe("first", server.origin)) +
				appFrame(server, probe("second", server.origin)),
		);
		check(
			"the visualization's inline script runs in the app's frame under the production policy",
			app.ran.length === 2 && app.ran.every(Boolean),
			`ran=${app.ran}`,
		);
		const height = await app.message({ type: HEIGHT_MESSAGE });
		check(
			"the frame posts its height to the app",
			typeof height?.height === "number",
			JSON.stringify(height),
		);
		for (const label of ["first", "second"]) {
			const report = await app.message({ type: "probe", label });
			check(
				`the ${label} frame cannot read the app or the other frame`,
				report !== null && report.parentReadable === false && report.siblingReadable === false,
				JSON.stringify(report),
			);
			const fetched = await app.message({ type: "fetch", label });
			check(
				`the ${label} frame's fetch is refused`,
				fetched?.blocked === true,
				JSON.stringify(fetched),
			);
		}
		const probes = server.requests
			.slice(appStart)
			.filter((path) => path.includes("/network-probe"));
		check("no frame reached the network", probes.length === 0, probes.join(", "));
		await app.close();

		// Without the scheme in frame-src, the app's frame does not load at all.
		const asked = server.requests.length;
		const shut = await open(
			browser,
			server,
			unframed,
			appFrame(server, probe("shut", server.origin)),
		);
		const pageAsked = server.requests.slice(asked).filter((path) => path.startsWith(FRAME_HOST));
		check(
			"without the scheme in frame-src the frame is refused before it loads",
			shut.ran[0] === false && pageAsked.length === 0,
			`ran=${shut.ran}, asked=${pageAsked.join(", ")}`,
		);
		await shut.close();
	} finally {
		await browser.close();
		server.stop();
	}
	return failed === 0 ? 0 : 1;
}

if (import.meta.main) {
	main().then(
		(code) => process.exit(code),
		(error: unknown) => {
			console.error(error);
			process.exit(1);
		},
	);
}
