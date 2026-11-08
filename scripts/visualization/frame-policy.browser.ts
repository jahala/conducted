/**
 * @feature CHAT-22 Codex visualizations in the chat
 * Owns: the browser check that a Codex visualization's inline scripts run under the app's
 * production content security policy.
 * Behaviour: issue #466. The app's policy (`app.security.csp` in tauri.conf.json) has
 * `script-src 'self'`; a frame must still run the visualization's own inline scripts.
 * Must handle: the policy comes from tauri.conf.json, unchanged; the frame is built with the
 * app's own document and sandbox (visualization-frame.ts); "the script ran" is read inside the
 * frame after its load event, so the answer does not depend on a timer.
 * Test first: the visualization's inline script runs in the app's frame under the production
 * policy.
 *
 * Usage: bun scripts/visualization/frame-policy.browser.ts
 * It uses the Chromium already in Playwright's cache and exits 1 when a case fails.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { type Browser, chromium } from "playwright-core";
import {
	FRAME_SANDBOX,
	frameDocument,
} from "../../apps/desktop/src/features/chat/visualization-frame.ts";

const ROOT = resolve(import.meta.dir, "../..");
const CONFIG = join(ROOT, "apps/desktop/src-tauri/tauri.conf.json");
/** Catches a page that hangs. It is not a way to wait. */
const HANG_MS = 15_000;

/** A visualization whose inline script marks the frame and posts to the app. */
const VISUALIZATION = `<!doctype html><html><head><title>Chart</title></head><body><h1>Chart</h1><script>window.__visualizationRan = true; parent.postMessage({ type: "probe" }, "*");</script></body></html>`;

function productionPolicy(): string {
	const config = JSON.parse(readFileSync(CONFIG, "utf8")) as {
		app: { security: { csp: string } };
	};
	return config.app.security.csp;
}

function escapeAttribute(text: string): string {
	return text.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}

/** The frame as the app renders it. */
function appFrame(html: string): string {
	return `<iframe title="Visualization" sandbox="${FRAME_SANDBOX}" referrerpolicy="no-referrer" srcdoc="${escapeAttribute(frameDocument(html))}"></iframe>`;
}

/** Records every message the page hears, as the app's listener would. */
const LISTENER = `window.__messages = []; addEventListener("message", (event) => { window.__messages.push(event.data); });`;

interface Served {
	origin: string;
	stop: () => void;
}

/** Serves the app page under `policy`, with the listener as an external script. */
function serve(policy: string, frame: string): Served {
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch(request) {
			const url = new URL(request.url);
			if (url.pathname === "/listener.js") {
				return new Response(LISTENER, { headers: { "content-type": "text/javascript" } });
			}
			if (url.pathname === "/") {
				const page = `<!doctype html><html><head><script src="/listener.js"></script></head><body>${frame}</body></html>`;
				return new Response(page, {
					headers: { "content-type": "text/html", "content-security-policy": policy },
				});
			}
			return new Response("not found", { status: 404 });
		},
	});
	return { origin: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) };
}

interface Outcome {
	ran: boolean;
	posted: boolean;
}

/** Opens the page, waits for the frame's load event, and reads whether its script ran. */
async function open(browser: Browser, policy: string, frame: string): Promise<Outcome> {
	const served = serve(policy, frame);
	const page = await browser.newPage();
	try {
		await page.goto(`${served.origin}/`, { timeout: HANG_MS });
		const element = await page.waitForSelector("iframe", { timeout: HANG_MS });
		const content = await element.contentFrame();
		if (content === null) throw new Error("The frame has no document.");
		await content.waitForLoadState("load", { timeout: HANG_MS });
		const ran = await content.evaluate(
			() => (window as unknown as { __visualizationRan?: boolean }).__visualizationRan === true,
		);
		const posted = ran
			? await page
					.waitForFunction(
						() =>
							(window as unknown as { __messages: { type?: string }[] }).__messages.some(
								(message) => message?.type === "probe",
							),
						undefined,
						{ timeout: HANG_MS },
					)
					.then(() => true)
			: false;
		return { ran, posted };
	} finally {
		await page.close();
		served.stop();
	}
}

async function main(): Promise<number> {
	const policy = productionPolicy();
	const browser = await chromium.launch();
	let failed = 0;
	const check = (name: string, pass: boolean, detail: string): void => {
		if (!pass) failed += 1;
		console.log(`${pass ? "ok  " : "FAIL"} ${name}${pass ? "" : `: ${detail}`}`);
	};
	try {
		// The instrument on a known case: a page frame inherits a policy that allows inline
		// scripts, so the same reading must say the script ran.
		const known = await open(
			browser,
			policy.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'"),
			`<iframe sandbox="allow-scripts" srcdoc="${escapeAttribute(VISUALIZATION)}"></iframe>`,
		);
		check(
			"the instrument reads a script that ran (inline scripts allowed)",
			known.ran && known.posted,
			`ran=${known.ran}, posted=${known.posted}`,
		);
		const app = await open(browser, policy, appFrame(VISUALIZATION));
		check(
			"the visualization's inline script runs in the app's frame under the production policy",
			app.ran && app.posted,
			`ran=${app.ran}, posted=${app.posted}`,
		);
	} finally {
		await browser.close();
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
