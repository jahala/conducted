/**
 * The reference screenshot run: Conductor's own frontend, on the stand-in, one picture per catalogue
 * state. It is a browser run, so on this Mac it waits for the morning (the owner's ruling: "Browser and
 * screenshot runs on this Mac wait for 08:00").
 *
 * - Starts the reference server (server.ts) on a free port, with the bundle and the mapping from the
 *   main checkout's `.context/` (paths.ts).
 * - Opens each state that has a route in Playwright's Chromium, the build already in Playwright's cache
 *   (nothing is downloaded), at 1440 by 900 in dark mode with reduced motion and `Date` fixed to the
 *   catalogue's moment. Every request to any other origin is aborted and listed.
 * - Waits for the screen to settle: no call to the backend waiting, no new calls and no change to the
 *   page for sixty animation frames (about a second) in a row. The wait is bounded by frames; a page
 *   that never settles is still captured, and listed with that reason.
 * - Writes `<shots>/<state>-dark.png`, `<shots>/index.json` (route, settle result, page errors, refused
 *   requests per state) and `<shots>/unanswered.json` (every call nobody answered, per state).
 *
 * Usage: bun scripts/conductor-reference/run.ts [state-id ...] [--bundle <dir>] [--mapping <file>]
 *        [--out <dir>]
 * It exits 1 when a page fails to load; unanswered calls are findings, not failures.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Browser, chromium } from "playwright-core";
import { CATALOGUE_NOW } from "../../apps/desktop/src/catalogue/time.ts";
import { loadCatalogue } from "./catalogue.ts";
import { defaultPaths } from "./paths.ts";
import { flag, loadMapping, startReferenceServer } from "./server.ts";

export const VIEWPORT = { width: 1440, height: 900 };
/** Frames the page must stay quiet to count as settled: long enough for a short timer or debounce. */
const QUIET_FRAMES = 60;
/** The longest the settle wait may take, by time: a busy machine draws frames slowly or late. */
const SETTLE_MS = 30_000;
/** Catches a page that never loads. It is not a way to wait. */
const HANG_MS = 60_000;

export interface Capture {
	id: string;
	title: string;
	route: string | null;
	file: string | null;
	settled: boolean | null;
	errors: string[];
	refused: string[];
}

/** The page globals `settle` uses, typed here because scripts are checked without the DOM library. */
interface PageGlobals {
	__REFERENCE_ACTIVITY__?: { calls: number; pending: number };
	document: unknown;
	requestAnimationFrame(callback: () => void): number;
	performance: { now(): number };
	MutationObserver: new (
		callback: (records: unknown[]) => void,
	) => { observe(target: unknown, options: object): void; disconnect(): void };
}

/**
 * Runs in the page (Playwright sends its source): waits until it is quiet for `quiet` frames in a row,
 * or `maxMs` milliseconds pass. Quiet means no backend call waiting, no new call and no change to the page.
 */
async function settle(limits: { quiet: number; maxMs: number }): Promise<boolean> {
	const page = globalThis as unknown as PageGlobals;
	const activity = page.__REFERENCE_ACTIVITY__;
	let changes = 0;
	const observer = new page.MutationObserver((records) => {
		changes += records.length;
	});
	observer.observe(page.document, {
		subtree: true,
		childList: true,
		attributes: true,
		characterData: true,
	});
	const frame = (): Promise<void> =>
		new Promise((done) => page.requestAnimationFrame(() => done()));
	try {
		let quiet = 0;
		let seen = { calls: activity?.calls ?? 0, changes };
		const deadline = page.performance.now() + limits.maxMs;
		while (page.performance.now() < deadline) {
			await frame();
			const now = { calls: activity?.calls ?? 0, changes };
			const still =
				(activity?.pending ?? 0) === 0 && now.calls === seen.calls && now.changes === seen.changes;
			quiet = still ? quiet + 1 : 0;
			seen = now;
			if (quiet >= limits.quiet) return true;
		}
		return false;
	} finally {
		observer.disconnect();
	}
}

/**
 * One picture of one state: a fresh dark-mode context that refuses every other origin, the page
 * opened at `open` (by default the reference server's route for the state), the settle wait, and the
 * picture written as `file` under `out`. The live run (live.ts) uses it for both of its fronts.
 */
export async function capture(
	browser: Browser,
	origin: string,
	out: string,
	state: { id: string; title: string; route: string | null },
	open: { path: string; file: string } = {
		path: `/__reference/open/${encodeURIComponent(state.id)}`,
		file: `${state.id}-dark.png`,
	},
): Promise<Capture> {
	const result: Capture = { ...state, file: null, settled: null, errors: [], refused: [] };
	if (state.route === null) return result;
	const context = await browser.newContext({
		viewport: VIEWPORT,
		deviceScaleFactor: 1,
		colorScheme: "dark",
		reducedMotion: "reduce",
		serviceWorkers: "block",
	});
	await context.route("**/*", (route) => {
		const url = route.request().url();
		if (new URL(url).origin === origin) return route.continue();
		result.refused.push(url);
		return route.abort("blockedbyclient");
	});
	const page = await context.newPage();
	await page.clock.setFixedTime(CATALOGUE_NOW);
	page.on("pageerror", (error) => result.errors.push(`page error: ${error.message}`));
	page.on("console", (message) => {
		if (message.type() === "error") result.errors.push(`console: ${message.text()}`);
	});
	try {
		await page.goto(`${origin}${open.path}`, { timeout: HANG_MS });
		result.settled = await page.evaluate(settle, { quiet: QUIET_FRAMES, maxMs: SETTLE_MS });
		await page.screenshot({ path: join(out, open.file), animations: "disabled" });
		result.file = open.file;
	} catch (cause) {
		result.errors.push(`run: ${cause instanceof Error ? cause.message : String(cause)}`);
	} finally {
		await context.close();
	}
	return result;
}

async function main(args: string[]): Promise<number> {
	const paths = defaultPaths();
	const out = flag(args, "out") ?? paths.shots;
	const only = args.filter(
		(arg, index) => !arg.startsWith("--") && !args[index - 1]?.startsWith("--"),
	);
	mkdirSync(out, { recursive: true });
	const catalogue = await loadCatalogue();
	const unknown = only.filter((id) => !catalogue.states.some((state) => state.id === id));
	if (unknown.length > 0) throw new Error(`Unknown state ids: ${unknown.join(", ")}`);
	const server = await startReferenceServer({
		bundleDir: flag(args, "bundle") ?? paths.bundle,
		mapping: await loadMapping(flag(args, "mapping") ?? paths.mapping),
		catalogue,
	});
	const origin = server.url.replace(/\/$/, "");
	console.log(`Conductor reference: ${server.url}`);
	let browser: Browser | null = null;
	try {
		browser = await chromium.launch();
		const states = (await (await fetch(`${origin}/__reference/states`)).json()) as {
			id: string;
			title: string;
			route: string | null;
		}[];
		const chosen = only.length === 0 ? states : states.filter((state) => only.includes(state.id));
		const captures: Capture[] = [];
		let failed = 0;
		for (const state of chosen) {
			const shot = await capture(browser, origin, out, state);
			captures.push(shot);
			if (shot.route === null) console.log(`none ${state.id}: the reference has no screen for it`);
			else if (shot.file === null) {
				failed += 1;
				console.log(`FAIL ${state.id}: ${shot.errors.at(-1) ?? "no picture"}`);
			} else {
				const notes = [
					shot.settled ? null : "never settled",
					shot.errors.length > 0 ? `${shot.errors.length} errors` : null,
					shot.refused.length > 0 ? `${shot.refused.length} refused requests` : null,
				].filter((note) => note !== null);
				console.log(`ok   ${state.id}${notes.length > 0 ? ` (${notes.join(", ")})` : ""}`);
			}
		}
		const log = await (await fetch(`${origin}/__reference/log`)).json();
		writeFileSync(join(out, "unanswered.json"), `${JSON.stringify(log, null, "\t")}\n`);
		writeFileSync(
			join(out, "index.json"),
			`${JSON.stringify({ viewport: VIEWPORT, states: captures }, null, "\t")}\n`,
		);
		console.log(`${captures.length} states, ${failed} failed. Written to ${out}`);
		return failed === 0 ? 0 : 1;
	} finally {
		if (browser !== null) await browser.close();
		await server.stop();
	}
}

if (import.meta.main) {
	main(process.argv.slice(2))
		.then((code) => process.exit(code))
		.catch((cause: unknown) => {
			console.error(cause instanceof Error ? cause.message : cause);
			process.exit(1);
		});
}
