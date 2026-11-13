/**
 * The live reference run (stage 2): Conductor's own frontend on our real backend, and our own UI on
 * the same backend and data, one picture each per catalogue state.
 *
 * For each state and front it
 * 1. seeds the state with our catalogue's own seeds (catalogue.ts), and moves its made-up Mac's
 *    folders under a fresh sealed scratch folder (sidecar-diff/seal.ts: its own home and temp, no IP
 *    traffic beyond loopback, no writes in the owner's home, fake agent programs only);
 * 2. builds the state's repositories and files on that disk with real git (world-disk.ts);
 * 3. starts the end-to-end test app (e2e/harness.ts `buildTestApp`: a debug `.app` bundle with its
 *    resources and bundled sidecar, which opens behind the owner's work), sealed, with that home: its
 *    data folder is the scratch folder's. The build carries the config override (live-config.ts),
 *    so its hidden window opens the bridge page of the live server (live-server.ts) on our dev
 *    origin (D145);
 * 4. writes the seeded rows into the app's own database through its database commands, after
 *    `db_open` ran the migrations;
 * 5. opens the front in Playwright's Chromium (nothing downloaded; every other origin refused):
 *    Conductor's bundle through the live mapping (`.context/day/conductor-ref/live-mapping.ts`), or our
 *    built UI through the identity mapping, and takes the picture once the page settles (run.ts);
 * 6. stops the app and every process under it by the pids it recorded, and removes the scratch folder.
 *
 * Output, in `<out>` (default `.context/shots/conductor-live/` of the main checkout):
 * `<state>-dark.png` (Conductor's frontend), `ours/<state>-dark.png` (our UI), `index.json` and
 * `live.json` (every call, by state, front, name and outcome, the totals check e reads, and how long
 * our app took to answer each command).
 *
 * Usage: bun scripts/conductor-reference/live.ts [state-id ...] [--out <dir>] [--fronts conductor,ours]
 *        [--target <cargo target dir>]
 * The app build goes into `--target` when given (kept), else into a run-owned folder that is removed.
 * Never the e2e run's own target folder: the override would replace the bundle its checks clone.
 * It needs our dev origin's port (1420) free. It is a browser run; our app's window stays hidden. It
 * exits 1 when a page fails to load. A picture taken while our app left calls unanswered is taken
 * again once, and the first attempt's report is kept with it.
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type Browser, chromium } from "playwright-core";
import type { ScriptedRepo } from "../../apps/desktop/src/catalogue/git-repo.ts";
import { stopApp } from "../app-process.ts";
import { buildTestApp, e2eTarget, freePort } from "../e2e/harness.ts";
import { loadCatalogue, ROOT, type SeededState } from "./catalogue.ts";
import { checkOverride, DEV_ORIGIN, referenceOverride } from "./live-config.ts";
import { type CallTally, type Front, type LiveServer, startLiveServer } from "./live-server.ts";
import { defaultPaths } from "./paths.ts";
import { type Capture, capture, VIEWPORT } from "./run.ts";
import { flag } from "./server.ts";
import {
	assertNoRealAgents,
	makeSeal,
	proveSealed,
	removeSeal,
	type Seal,
} from "./sidecar-diff/seal.ts";
import { identityMapping, type LiveMapping } from "./translator.ts";
import { type Move, plantOnDisk, relocate } from "./world-disk.ts";

const DESKTOP = join(ROOT, "apps/desktop");
const SRC_TAURI = join(DESKTOP, "src-tauri");
/** The catalogue's made-up Mac (catalogue/world.ts) and the folders our app uses for the same jobs. */
const CATALOGUE_HOME = "/Users/sam";
const CATALOGUE_APP_DATA = `${CATALOGUE_HOME}/Library/Application Support/Conducted`;
const CATALOGUE_TEMP = "/tmp/conducted";
const APP_IDENTIFIER = "build.conducted.app";
const AUTHOR = { name: "Sam Rivera", email: "sam@example.com" };
/** Catches an app that never connects or never stops. It is not a way to wait. */
const HANG_MS = 60_000;

type Row = Record<string, unknown>;

interface LiveMappingModule {
	liveMapping(): LiveMapping<unknown>;
	liveRoute(state: { scene: { route: string } }): string | null;
	liveGlobals(
		invoke: (command: string, args?: unknown) => Promise<unknown>,
	): Promise<Record<string, unknown>>;
	GAPS: string[];
}

interface World {
	repos: readonly ScriptedRepo[];
	memory: { controls: { files: Map<string, string> } };
}

interface Shot extends Capture {
	front: Front;
	problems: string[];
	/**
	 * Processes the app started that were still running when it had stopped, stopped by the run by
	 * their recorded ids: the sidecar outlives a signalled app until its parent watchdog notices.
	 */
	stopped: string[];
	/** The app left calls unanswered when the page was pictured; the run takes the picture again once. */
	stalled?: boolean;
	/** What the first attempt reported, when this picture is the second. */
	firstAttempt?: string[];
}

/**
 * Builds the test app with the override into `target`, and returns its executable. The test build
 * also builds the sidecar and our UI, which the `ours` front serves.
 */
async function build(target: string): Promise<string> {
	const windows = (
		JSON.parse(readFileSync(join(SRC_TAURI, "tauri.conf.json"), "utf8")) as {
			app: { windows: Record<string, unknown>[] };
		}
	).app.windows;
	const override = referenceOverride(windows);
	const problems = checkOverride(override, windows);
	if (problems.length > 0) throw new Error(`The config override is unsafe: ${problems.join("; ")}`);
	const bundle = await buildTestApp({
		target,
		config: override as unknown as Record<string, unknown>,
	});
	// Tauri refuses an executable whose path holds a symlink (/tmp is one).
	return realpathSync(join(bundle, "Contents/MacOS/conducted"));
}

async function launch(exe: string, seal: Seal, log: string): Promise<ChildProcess> {
	// `CFFIXED_USER_HOME` keeps WebKit's storage in the scratch home too, not the owner's
	// `~/Library/WebKit` (e2e/harness.ts `appEnvironment`). The test build's WebDriver server gets a
	// free port, so it never meets another run's.
	const env = {
		...seal.env,
		CFFIXED_USER_HOME: seal.home,
		TAURI_WEBDRIVER_PORT: String(await freePort()),
	};
	// A window that is never shown lets macOS put the app to sleep (App Nap), which stalls its calls.
	// The setting given on the command line holds for this process only; nothing is stored.
	const args = [
		"-n",
		"10",
		"/usr/bin/sandbox-exec",
		"-f",
		seal.profile,
		exe,
		"-NSAppSleepDisabled",
		"YES",
	];
	const child = spawn("nice", args, {
		cwd: seal.root,
		env,
		stdio: ["ignore", "pipe", "pipe"],
	});
	const lines: string[] = [];
	child.stdout?.on("data", (chunk: Buffer) => lines.push(chunk.toString()));
	child.stderr?.on("data", (chunk: Buffer) => lines.push(chunk.toString()));
	child.once("exit", () => writeFileSync(log, lines.join("")));
	return child;
}

async function bounded<T>(promise: Promise<T>, what: string): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const hang = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(
			() => reject(new Error(`${what} did not happen within ${HANG_MS / 1000} s`)),
			HANG_MS,
		);
	});
	try {
		return await Promise.race([promise, hang]);
	} finally {
		clearTimeout(timer);
	}
}

/** A value as an SQLite literal: text quoted, numbers as they are, bytes as a blob. */
export function sqlLiteral(value: unknown): string {
	if (value === null || value === undefined) return "NULL";
	if (typeof value === "number" || typeof value === "bigint") return String(value);
	if (typeof value === "boolean") return value ? "1" : "0";
	if (value instanceof Uint8Array) return `X'${Buffer.from(value).toString("hex")}'`;
	return `'${String(value).replaceAll("'", "''")}'`;
}

/** Our app's database, opened through its own commands, with the seeded rows written in. */
async function seedDatabase(server: LiveServer, tables: Record<string, Row[]>): Promise<string[]> {
	const call = async (command: string, args: unknown): Promise<unknown> => {
		const answer = await server.ours.invoke(command, args);
		if (!answer.ok) throw new Error(`${command}: ${JSON.stringify(answer.error)}`);
		return answer.value;
	};
	await call("db_open", {});
	const master = (await call("db_select", {
		query: "SELECT type, name, sql FROM sqlite_master WHERE type = 'table'",
		values: [],
	})) as { name: string; sql: string | null }[];
	const virtual = master
		.filter((table) => /^CREATE VIRTUAL TABLE/i.test(table.sql ?? ""))
		.map((table) => table.name);
	const writable = new Set(
		master
			.map((table) => table.name)
			.filter(
				(name) =>
					!name.startsWith("sqlite_") &&
					!name.startsWith("_sqlx") &&
					!virtual.some((table) => name === table || name.startsWith(`${table}_`)),
			),
	);
	// Parents before children, so every foreign key finds its row.
	const parents = new Map<string, string[]>();
	for (const name of writable) {
		const keys = (await call("db_select", {
			query: `SELECT "table" FROM pragma_foreign_key_list('${name}')`,
			values: [],
		})) as { table: string }[];
		parents.set(
			name,
			keys.map((key) => key.table).filter((table) => table !== name),
		);
	}
	const order: string[] = [];
	const visit = (name: string, path: string[]): void => {
		if (order.includes(name) || path.includes(name)) return;
		for (const parent of parents.get(name) ?? []) visit(parent, [...path, name]);
		order.push(name);
	};
	for (const name of writable) visit(name, []);
	// One script: the foreign keys are checked at the commit, so rows that point at each other (a
	// workspace's active chat, a chat's workspace) go in together.
	const statements = ["BEGIN", "PRAGMA defer_foreign_keys = ON"];
	for (const name of order) {
		for (const row of tables[name] ?? []) {
			const columns = Object.keys(row);
			statements.push(
				`INSERT OR REPLACE INTO "${name}" (${columns.map((column) => `"${column}"`).join(", ")}) VALUES (${columns.map((column) => sqlLiteral(row[column])).join(", ")})`,
			);
		}
	}
	statements.push("COMMIT");
	await call("db_execute", { query: `${statements.join(";\n")};`, values: [] });
	// The page's own `db_open` finds this connection open and keeps it (D137).
	return Object.keys(tables).filter(
		(name) => !writable.has(name) && (tables[name]?.length ?? 0) > 0,
	);
}

/** The seeded state moved onto the scratch disk: rows, route, repositories and files. */
function moveOnto(seeded: SeededState, seal: Seal) {
	const moves: Move[] = [
		{
			from: CATALOGUE_APP_DATA,
			to: join(seal.home, "Library/Application Support", APP_IDENTIFIER),
		},
		{ from: CATALOGUE_HOME, to: seal.home },
		{ from: CATALOGUE_TEMP, to: seal.tmp },
	];
	const world = seeded.world as World;
	const tables = relocate(seeded.tables, moves);
	const repoRows = tables.repos ?? [];
	const live = (tables.workspaces ?? []).filter((workspace) => workspace.state !== "archived");
	// An archived workspace has no folder, so the repository the world scripts for it is not built.
	const archived = new Set(
		(tables.workspaces ?? [])
			.filter((workspace) => workspace.state === "archived")
			.map((workspace) => String(workspace.path)),
	);
	const repos = relocate([...world.repos], moves).filter((repo) => !archived.has(repo.path));
	const files = new Map(relocate([...world.memory.controls.files.entries()], moves));
	plantOnDisk({
		root: seal.root,
		home: seal.home,
		repos,
		files,
		projects: repoRows.map((repo) => ({
			path: String(repo.root_path),
			defaultBranch: String(repo.default_branch),
		})),
		workspaces: live.map((workspace) => ({
			path: String(workspace.path),
			projectPath: String(repoRows.find((repo) => repo.id === workspace.repo_id)?.root_path ?? ""),
		})),
		author: AUTHOR,
	});
	return { tables, route: relocate(seeded.scene.route, moves) };
}

async function shootOne(options: {
	browser: Browser;
	server: LiveServer;
	exe: string;
	out: string;
	front: Front;
	state: { id: string; title: string };
	seeded: SeededState;
	live: LiveMappingModule;
}): Promise<Shot> {
	const { server, front, state, seeded, live } = options;
	const seal = makeSeal(`live-${front}`, { execOutside: ["/bin/ps"] });
	const problems: string[] = [];
	const stopped: string[] = [];
	let child: ChildProcess | null = null;
	const base: Shot = {
		...state,
		front,
		route: null,
		file: null,
		settled: null,
		errors: [],
		refused: [],
		problems,
		stopped,
	};
	try {
		const moved = moveOnto(seeded, seal);
		const route =
			front === "conductor" ? live.liveRoute({ scene: { route: moved.route } }) : moved.route;
		if (route === null) return { ...base, problems: ["Conductor has no screen for this state"] };
		base.route = route;
		child = await launch(options.exe, seal, join(seal.root, "app.log"));
		await bounded(server.bridged(), "our app's bridge page connecting");
		const skipped = await seedDatabase(server, moved.tables);
		if (skipped.length > 0)
			problems.push(`rows not written (virtual tables): ${skipped.join(", ")}`);
		const invoke = async (command: string, args?: unknown): Promise<unknown> => {
			const answer = await server.ours.invoke(command, args ?? {});
			if (!answer.ok) throw new Error(`${command}: ${JSON.stringify(answer.error)}`);
			return answer.value;
		};
		server.prepare({
			state: state.id,
			front,
			route,
			mapping: front === "conductor" ? live.liveMapping() : identityMapping(),
			context:
				front === "conductor"
					? {
							id: state.id,
							scene: { route: moved.route },
							tables: moved.tables,
							views: new Map(),
							roots: new Set(),
						}
					: {},
			globals: front === "conductor" ? await live.liveGlobals(invoke) : { isTauri: true },
		});
		const out = front === "conductor" ? options.out : join(options.out, "ours");
		const shot = await capture(
			options.browser,
			DEV_ORIGIN,
			out,
			{ ...state, route },
			{
				path: `/__reference/open/${encodeURIComponent(state.id)}?front=${front}`,
				file: `${state.id}-dark.png`,
			},
		);
		const pending = server.pending();
		if (pending.length > 0) {
			// Whether the app still answers at all says if one call hung or the whole window stalled.
			const answers = await Promise.race([
				server.ours.invoke("health", {}).then((answer) => answer.ok),
				Bun.sleep(3_000).then(() => false),
			]);
			problems.push(
				`our app had not answered: ${[...new Set(pending)].join(", ")}; ${answers ? "it still answered a health check" : "it answered no health check within 3 s"}`,
			);
			return { ...shot, front, problems, stopped, stalled: true };
		}
		return { ...shot, front, problems, stopped };
	} catch (cause) {
		problems.push(cause instanceof Error ? cause.message : String(cause));
		return base;
	} finally {
		if (child !== null) {
			stopped.push(...(await stopApp(child)));
			// The app's own output, kept beside the pictures when something went wrong.
			const log = join(seal.root, "app.log");
			if (problems.length > 0 && existsSync(log)) {
				mkdirSync(join(options.out, "logs"), { recursive: true });
				copyFileSync(log, join(options.out, "logs", `${front}-${state.id}.log`));
			}
		}
		server.resetBridge();
		removeSeal(seal);
	}
}

/** The run's two logs, `live.json` (every call and the totals check e reads) and `index.json`. */
function writeLogs(out: string, server: LiveServer, live: LiveMappingModule, shots: Shot[]): void {
	const calls = server.calls();
	writeFileSync(
		join(out, "live.json"),
		`${JSON.stringify({ commit: gitHead(), gaps: live.GAPS, summary: liveSummary(calls), durations: server.durations(), calls }, null, "\t")}\n`,
	);
	writeFileSync(
		join(out, "index.json"),
		`${JSON.stringify({ viewport: VIEWPORT, states: shots }, null, "\t")}\n`,
	);
}

const inventoryOf = (
	tally: Pick<CallTally, "kind" | "name">,
): { inventory: string; name: string } => {
	const name = tally.name.split(": ")[0] as string;
	if (tally.kind === "sidecar") return { inventory: "sidecar_call", name };
	if (tally.kind === "event") return { inventory: "tauri_event", name };
	if (name.startsWith("plugin:"))
		return { inventory: "tauri_plugin_command", name: name.slice("plugin:".length) };
	return { inventory: "tauri_command", name };
};

/** Every name Conductor's frontend called, with how often ours answered, failed, refused or decided. */
export function liveSummary(calls: readonly CallTally[]) {
	const byName = new Map<
		string,
		Record<string, unknown> & {
			counts: Record<string, number>;
			details: string[];
			via: string[];
			decisions: string[];
		}
	>();
	for (const call of calls) {
		if (call.front !== "conductor") continue;
		const { inventory, name } = inventoryOf(call);
		const key = `${inventory}:${name}`;
		let entry = byName.get(key);
		if (entry === undefined) {
			entry = { inventory, name, counts: {}, details: [], via: [], decisions: [] };
			byName.set(key, entry);
		}
		entry.counts[call.outcome] = (entry.counts[call.outcome] ?? 0) + call.count;
		for (const detail of call.details)
			if (!entry.details.includes(detail) && entry.details.length < 10) entry.details.push(detail);
		for (const via of call.via) if (!entry.via.includes(via)) entry.via.push(via);
		if (call.decision !== undefined && !entry.decisions.includes(call.decision))
			entry.decisions.push(call.decision);
	}
	return [...byName.values()].sort(
		(a, b) =>
			String(a.inventory).localeCompare(String(b.inventory)) ||
			String(a.name).localeCompare(String(b.name)),
	);
}

async function main(args: string[]): Promise<number> {
	const paths = defaultPaths();
	const out = flag(args, "out") ?? join(paths.shots, "../conductor-live");
	const fronts = (flag(args, "fronts") ?? "conductor,ours").split(",") as Front[];
	const unknownFronts = fronts.filter((front) => front !== "conductor" && front !== "ours");
	if (unknownFronts.length > 0) throw new Error(`Unknown fronts: ${unknownFronts.join(", ")}`);
	const only = args.filter(
		(arg, index) => !arg.startsWith("--") && !args[index - 1]?.startsWith("--"),
	);
	const givenTarget = flag(args, "target");
	if (givenTarget !== undefined && resolve(givenTarget) === resolve(e2eTarget()))
		throw new Error(
			`--target ${givenTarget} is the e2e run's target folder; the override would replace the bundle its checks clone.`,
		);
	const target = givenTarget ?? realpathSync(mkdtempSync(join(tmpdir(), "conductor-live-target-")));
	mkdirSync(join(out, "ours"), { recursive: true });

	assertNoRealAgents();
	const probe = makeSeal("live-probe", { execOutside: ["/bin/ps"] });
	try {
		proveSealed(probe);
	} finally {
		removeSeal(probe);
	}
	const live = (await import(join(paths.reference, "live-mapping.ts"))) as LiveMappingModule;
	const catalogue = await loadCatalogue();
	const unknown = only.filter((id) => !catalogue.states.some((state) => state.id === id));
	if (unknown.length > 0) throw new Error(`Unknown state ids: ${unknown.join(", ")}`);

	let server: LiveServer | null = null;
	let browser: Browser | null = null;
	try {
		const exe = await build(target);
		server = await startLiveServer({
			bundles: { conductor: paths.bundle, ours: join(DESKTOP, "dist") },
		});
		browser = await chromium.launch();
		const opened = { browser, server };
		const shots: Shot[] = [];
		const states =
			only.length === 0
				? catalogue.states
				: catalogue.states.filter((state) => only.includes(state.id));
		for (const state of states) {
			for (const front of fronts) {
				const once = async (): Promise<Shot> =>
					await shootOne({
						...opened,
						exe,
						out,
						front,
						state: { id: state.id, title: state.title },
						seeded: await catalogue.seed(state.id),
						live,
					});
				const first = await once();
				const shot =
					first.stalled === true ? { ...(await once()), firstAttempt: first.problems } : first;
				shots.push(shot);
				const notes = [
					shot.settled === false ? "never settled" : null,
					shot.errors.length > 0 ? `${shot.errors.length} errors` : null,
					...shot.problems,
				].filter((note) => note !== null);
				console.log(
					`${shot.file === null ? "none" : "ok  "} ${front.padEnd(9)} ${state.id}${notes.length > 0 ? ` (${notes.join("; ")})` : ""}`,
				);
				// Written after every picture, so a run that is stopped part way keeps what it measured.
				writeLogs(out, server, live, shots);
			}
		}
		writeLogs(out, server, live, shots);
		const failed = shots.filter((shot) => shot.file === null && shot.route !== null).length;
		console.log(`${shots.length} pictures, ${failed} failed. Written to ${out}`);
		return failed === 0 ? 0 : 1;
	} finally {
		if (browser !== null) await browser.close();
		if (server !== null) await server.stop();
		if (givenTarget === undefined && existsSync(target))
			rmSync(target, { recursive: true, force: true });
	}
}

function gitHead(): string {
	return spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
}

if (import.meta.main) {
	main(process.argv.slice(2))
		.then((code) => process.exit(code))
		.catch((cause: unknown) => {
			console.error(cause instanceof Error ? cause.message : cause);
			process.exit(1);
		});
}
