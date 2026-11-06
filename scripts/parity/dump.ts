/**
 * The parity dump: opens every catalogue state in Chromium and writes what it shows (every visible
 * string and control name, and the layout readings `tests/parity/layout.json` asks for) to
 * `<out>/dump.json`. It is a browser run, so it runs on GitHub (`.github/workflows/parity.yml`), never
 * on the owner's Mac.
 * Behaviour: docs/plans/parity-harness.md section 3. The server start and the state list are the
 * screenshot run's (scripts/catalogue/shots.ts); `--app` points them at another checkout's desktop
 * app, which is how the instrument check reads the commit before #345.
 * Must handle: a state that fails or never settles is recorded with its reason and the run goes on,
 * so the check can report it; the server's process group is stopped on every ending.
 *
 * Usage: bun scripts/parity/dump.ts [--app <apps/desktop dir>] [--out <dir>] [--commit <label>] [state-id ...]
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { type Browser, chromium } from "playwright-core";
import { CATALOGUE_NOW } from "../../apps/desktop/src/catalogue/time.ts";
import { listStates, startServer, stopServer } from "../catalogue/shots.ts";
import { collectState, type LayoutProbe } from "./collect.ts";
import { DATA, type Dump, type DumpState, normalise, ROOT, readJson } from "./lib.ts";
import { sourceStrings } from "./spec.ts";

const VIEWPORT = { width: 1440, height: 900 };
/** Catches a page that hangs. It is not a way to wait. */
const HANG_MS = 60_000;

export interface LayoutSpecEntry {
	id: string;
	what: string;
	evidence: string;
	state: string;
	locator: LayoutProbe["locator"];
	expect: Record<string, number>;
	/** For a value ui-dimensions.md marks INFERRED: what in the bundle confirmed it. */
	checked?: string;
}

export interface LayoutSpec {
	tolerance: { style: number; box: number; weight: number };
	entries: LayoutSpecEntry[];
}

export const BOX_KEYS = new Set(["height", "width"]);

/** The string literals of a catalogue folder's source files: what its seeds write. */
export function sampleStrings(dir: string): string[] {
	const found = new Set<string>();
	const read = (folder: string): void => {
		for (const entry of readdirSync(folder, { withFileTypes: true })) {
			const path = join(folder, entry.name);
			if (entry.isDirectory()) read(path);
			else if (/\.tsx?$/.test(entry.name)) {
				for (const text of sourceStrings(readFileSync(path, "utf8"))) {
					const clean = normalise(text);
					if (/\p{L}/u.test(clean)) found.add(clean);
				}
			}
		}
	};
	read(dir);
	return [...found].sort();
}

export function probesFor(state: string, layout: LayoutSpec): LayoutProbe[] {
	return layout.entries
		.filter((entry) => entry.state === state)
		.map((entry) => ({ id: entry.id, locator: entry.locator, read: Object.keys(entry.expect) }));
}

async function readState(
	browser: Browser,
	url: string,
	id: string,
	group: string,
	probes: LayoutProbe[],
): Promise<DumpState> {
	const context = await browser.newContext({
		viewport: VIEWPORT,
		deviceScaleFactor: 1,
		colorScheme: "light",
		reducedMotion: "reduce",
	});
	const page = await context.newPage();
	await page.clock.setFixedTime(CATALOGUE_NOW);
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	try {
		await page.goto(`${url}?${new URLSearchParams({ state: id, theme: "light" }).toString()}`);
		await page.locator("html[data-catalogue]").waitFor({ state: "attached", timeout: HANG_MS });
		const html = page.locator("html");
		const status = await html.getAttribute("data-catalogue");
		const route = await html.getAttribute("data-catalogue-route");
		const failure = await html.getAttribute("data-catalogue-error");
		const collected = await page.evaluate(collectState, probes);
		const error =
			status === "ready" ? null : (failure ?? (errors.length > 0 ? errors.join("\n") : "failed"));
		return { id, group, route, error, ...collected };
	} catch (cause) {
		const message = cause instanceof Error ? cause.message : String(cause);
		return {
			id,
			group,
			route: null,
			error: [message, ...errors].join("\n"),
			names: [],
			layout: [],
		};
	} finally {
		await context.close();
	}
}

interface Options {
	app: string;
	out: string;
	commit: string;
	only: string[];
}

export function parseArgs(argv: string[]): Options {
	const options: Options = {
		app: join(ROOT, "apps/desktop"),
		out: join(ROOT, ".context/parity"),
		commit: "HEAD",
		only: [],
	};
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index] ?? "";
		const value = (): string => {
			const next = argv[++index];
			if (next === undefined) throw new Error(`${arg} needs a value.`);
			return next;
		};
		if (arg === "--app") options.app = resolve(value());
		else if (arg === "--out") options.out = resolve(value());
		else if (arg === "--commit") options.commit = value();
		else if (arg.startsWith("--")) throw new Error(`Unknown option ${arg}.`);
		else options.only.push(arg);
	}
	return options;
}

async function main(options: Options): Promise<number> {
	const layout = readJson<LayoutSpec>(join(DATA, "layout.json"));
	mkdirSync(options.out, { recursive: true });
	const server = startServer(options.app);
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
		const states = options.only.length === 0 ? all : all.filter((s) => options.only.includes(s.id));
		const dumped: DumpState[] = [];
		for (const state of states) {
			const probes = probesFor(state.id, layout);
			const read = await readState(browser, url, state.id, state.group, probes);
			console.log(
				`${read.error === null ? "ok  " : "FAIL"} ${state.id} (${read.names.length} names)`,
			);
			dumped.push(read);
		}
		const dump: Dump = {
			commit: options.commit,
			viewport: VIEWPORT,
			sample: sampleStrings(join(options.app, "src/catalogue")),
			states: dumped,
		};
		writeFileSync(join(options.out, "dump.json"), `${JSON.stringify(dump, null, "\t")}\n`);
		console.log(`${dumped.length} states written to ${join(options.out, "dump.json")}`);
		return 0;
	} finally {
		if (browser !== null) await browser.close();
		await stopServer(server.child);
	}
}

if (import.meta.main) {
	main(parseArgs(process.argv.slice(2)))
		.then((code) => process.exit(code))
		.catch((cause: unknown) => {
			console.error(cause instanceof Error ? cause.message : cause);
			process.exit(1);
		});
}
