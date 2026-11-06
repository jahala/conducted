/**
 * Screenshots every state of the states catalogue, in light and dark, at 1440 x 900.
 *
 * - Starts the catalogue's dev server (apps/desktop/vite.catalogue.config.ts) on a free port and reads
 *   the address it prints. The server's process group is stopped on every ending: done, failed,
 *   Ctrl+C or SIGTERM.
 * - Reads the list of states from the catalogue's index page, so the list has one home
 *   (apps/desktop/src/catalogue/states/index.ts).
 * - Opens each state in Playwright's Chromium, the build already in Playwright's cache (nothing is
 *   downloaded), with reduced motion, and waits for the page to mark itself settled
 *   (`data-catalogue` on <html>; see apps/desktop/src/catalogue/main.tsx). A state that fails or never
 *   settles is listed with its reason, and the run exits 1.
 * - Writes `.context/shots/ours/<state-id>-<light|dark>.png` and `.context/shots/ours/index.json`.
 *   A PNG left from an earlier run whose state no longer exists is moved to the Trash.
 *
 * Usage: bun scripts/catalogue/shots.ts [state-id ...]
 * With state ids it captures only those, and index.json lists only those.
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { type Browser, chromium } from "playwright-core";

const ROOT = resolve(import.meta.dir, "../..");
const DESKTOP = join(ROOT, "apps/desktop");
const OUT = join(ROOT, ".context/shots/ours");
const VIEWPORT = { width: 1440, height: 900 };
const THEMES = ["light", "dark"] as const;
type Theme = (typeof THEMES)[number];
/** Catches a server that never starts or a page that hangs. It is not a way to wait. */
const HANG_MS = 60_000;

interface StateRow {
	id: string;
	group: string;
	title: string;
}

interface Capture {
	theme: Theme;
	file: string;
	route: string | null;
	error: string | null;
}

/** Starts the catalogue server in its own process group and resolves with the index address. */
function startServer(): { child: ChildProcess; url: Promise<string> } {
	const child = spawn(
		"node",
		[join(DESKTOP, "node_modules/vite/bin/vite.js"), "--config", "vite.catalogue.config.ts"],
		{ cwd: DESKTOP, detached: true, stdio: ["ignore", "pipe", "pipe"] },
	);
	const url = new Promise<string>((resolveUrl, reject) => {
		let printed = "";
		const timer = setTimeout(
			() => reject(new Error(`The catalogue server printed no address:\n${printed}`)),
			HANG_MS,
		);
		const read = (chunk: Buffer): void => {
			printed += chunk.toString();
			const match = /Catalogue: (\S+)/.exec(printed);
			if (match?.[1] !== undefined) {
				clearTimeout(timer);
				resolveUrl(match[1]);
			}
		};
		child.stdout?.on("data", read);
		child.stderr?.on("data", read);
		child.once("exit", (code) => {
			clearTimeout(timer);
			reject(new Error(`The catalogue server exited with ${code}:\n${printed}`));
		});
	});
	return { child, url };
}

/** Stops the server's whole process group and waits for it to exit. */
async function stopServer(child: ChildProcess): Promise<void> {
	if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
	const exited = new Promise<void>((done) => child.once("exit", () => done()));
	process.kill(-child.pid, "SIGTERM");
	const timer = setTimeout(() => {
		if (child.pid !== undefined && child.exitCode === null) process.kill(-child.pid, "SIGKILL");
	}, 5_000);
	await exited;
	clearTimeout(timer);
}

async function listStates(browser: Browser, url: string): Promise<StateRow[]> {
	const page = await browser.newPage();
	try {
		await page.goto(url);
		await page.locator("[data-state-id]").first().waitFor({ timeout: HANG_MS });
		return await page.$$eval("[data-state-id]", (rows) =>
			rows.map((row) => ({
				id: row.getAttribute("data-state-id") ?? "",
				group: row.getAttribute("data-state-group") ?? "",
				title: row.getAttribute("data-state-title") ?? "",
			})),
		);
	} finally {
		await page.close();
	}
}

async function capture(browser: Browser, url: string, id: string, theme: Theme): Promise<Capture> {
	const file = `${id}-${theme}.png`;
	const context = await browser.newContext({
		viewport: VIEWPORT,
		deviceScaleFactor: 1,
		colorScheme: theme,
		reducedMotion: "reduce",
	});
	const page = await context.newPage();
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	try {
		const address = `${url}?${new URLSearchParams({ state: id, theme }).toString()}`;
		await page.goto(address);
		await page.locator("html[data-catalogue]").waitFor({ state: "attached", timeout: HANG_MS });
		const html = page.locator("html");
		const marks = {
			status: await html.getAttribute("data-catalogue"),
			route: await html.getAttribute("data-catalogue-route"),
			error: await html.getAttribute("data-catalogue-error"),
		};
		await page.screenshot({ path: join(OUT, file), animations: "disabled" });
		const reason = marks.error ?? (errors.length > 0 ? errors.join("\n") : "failed");
		const error = marks.status === "ready" ? null : reason;
		return { theme, file, route: marks.route, error };
	} catch (cause) {
		const message = cause instanceof Error ? cause.message : String(cause);
		return { theme, file, route: null, error: [message, ...errors].join("\n") };
	} finally {
		await context.close();
	}
}

/** Moves PNGs from earlier runs whose state is gone to the Trash, one exact path at a time. */
function trashStale(written: Set<string>): string[] {
	const stale = readdirSync(OUT).filter((name) => name.endsWith(".png") && !written.has(name));
	for (const name of stale) {
		const moved = spawnSync("trash", [join(OUT, name)], { stdio: "inherit" });
		if (moved.status !== 0) throw new Error(`Could not move ${name} to the Trash.`);
	}
	return stale;
}

async function main(only: string[]): Promise<number> {
	mkdirSync(OUT, { recursive: true });
	const server = startServer();
	const stopOnSignal = (signal: NodeJS.Signals): void => {
		void stopServer(server.child).finally(() => process.exit(signal === "SIGINT" ? 130 : 143));
	};
	process.once("SIGINT", stopOnSignal);
	process.once("SIGTERM", stopOnSignal);
	let browser: Browser | null = null;
	try {
		const url = await server.url;
		console.log(`Catalogue at ${url}`);
		browser = await chromium.launch();
		const all = await listStates(browser, url);
		const unknown = only.filter((id) => !all.some((state) => state.id === id));
		if (unknown.length > 0) throw new Error(`Unknown state ids: ${unknown.join(", ")}`);
		const states = only.length === 0 ? all : all.filter((state) => only.includes(state.id));

		const entries = [];
		let failed = 0;
		for (const state of states) {
			const captures: Capture[] = [];
			for (const theme of THEMES) captures.push(await capture(browser, url, state.id, theme));
			const routes = new Set(captures.map((shot) => shot.route));
			for (const shot of captures) {
				if (shot.error !== null) {
					failed += 1;
					console.log(`FAIL ${state.id} (${shot.theme}): ${shot.error.split("\n")[0]}`);
				}
			}
			if (routes.size > 1) {
				failed += 1;
				console.log(`FAIL ${state.id}: light and dark opened different routes`);
			}
			if (captures.every((shot) => shot.error === null)) console.log(`ok   ${state.id}`);
			entries.push({
				id: state.id,
				group: state.group,
				title: state.title,
				route: captures[0]?.route ?? null,
				files: Object.fromEntries(captures.map((shot) => [shot.theme, shot.file])),
				errors: Object.fromEntries(
					captures.filter((shot) => shot.error !== null).map((shot) => [shot.theme, shot.error]),
				),
			});
		}
		writeFileSync(
			join(OUT, "index.json"),
			`${JSON.stringify({ viewport: VIEWPORT, states: entries }, null, "\t")}\n`,
		);
		if (only.length === 0) {
			const written = new Set(entries.flatMap((entry) => Object.values(entry.files)));
			const stale = trashStale(written);
			if (stale.length > 0) console.log(`Moved ${stale.length} old screenshots to the Trash.`);
		}
		console.log(`${entries.length} states, ${failed} failed captures. Written to ${OUT}`);
		return failed === 0 ? 0 : 1;
	} finally {
		if (browser !== null) await browser.close();
		await stopServer(server.child);
	}
}

if (import.meta.main) {
	if (!existsSync(join(DESKTOP, "node_modules/vite/bin/vite.js"))) {
		console.error("apps/desktop has no Vite. Run pnpm install first.");
		process.exit(1);
	}
	main(process.argv.slice(2))
		.then((code) => process.exit(code))
		.catch((cause: unknown) => {
			console.error(cause instanceof Error ? cause.message : cause);
			process.exit(1);
		});
}
