/**
 * Every npm package the real builds put into what ships is in the third-party notices (issue
 * #577, D148). The notices list each part's runtime dependencies from pnpm's data; this test runs
 * the bundlers themselves and reads which packages they took, so a development dependency imported
 * by shipped code, or a platform package the collection leaves out, fails here.
 *
 * The four bundles: the web UI (Vite, with the app's own config), the sidecar and the cloud
 * sandbox's entry (Bun, the same resolution `bun build --compile` uses), and the cloud Worker
 * (wrangler's dry run, as `scripts/cloud/prepare-deploy.ts` bundles it). Each writes its module
 * graph into this run's temp folder.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { NOTICES_PATH } from "../../apps/desktop/src-tauri/release/bundle.ts";
import { bundlingConfig, readDeployFacts } from "../cloud/prepare-deploy.ts";
import { entriesIn } from "./notices.ts";

const ROOT = resolve(import.meta.dir, "../..");
const DESKTOP = join(ROOT, "apps/desktop");
const SIDECAR = join(ROOT, "packages/sidecar");
const CLOUD = join(ROOT, "apps/cloud");
/** Catches a hung build. Each build takes a few seconds. */
const HANG_MS = 180_000;

let work = "";

beforeAll(() => {
	work = mkdtempSync(join(tmpdir(), "notices-bundles-"));
});

afterAll(() => {
	// The run made this folder, so it removes it.
	rmSync(work, { recursive: true, force: true });
});

/** The npm packages the notices list, as `name@version`, and their names alone. */
function listed(): { packages: Set<string>; names: Set<string> } {
	const packages = new Set<string>();
	const names = new Set<string>();
	for (const key of entriesIn(readFileSync(NOTICES_PATH, "utf8")).keys()) {
		const [ecosystem, name, version] = key.split(" ");
		if (ecosystem !== "npm" || name === undefined) continue;
		packages.add(`${name}@${version}`);
		names.add(name);
	}
	return { packages, names };
}

/**
 * The packages a module graph reaches, as `name@version` from each module's package folder, and the
 * bundlers' own generated modules (`\0vite/preload-helper.js`), by the package they are named for.
 * A module outside any `node_modules` folder is this repository's own code.
 */
function packagesIn(modules: readonly string[]): {
	packages: Set<string>;
	generatedBy: Set<string>;
} {
	const packages = new Set<string>();
	const generatedBy = new Set<string>();
	for (const id of modules) {
		if (id.startsWith("\0")) {
			generatedBy.add(id.slice(1).split("/")[0] ?? id);
			continue;
		}
		const marker = id.lastIndexOf("/node_modules/");
		if (marker === -1) continue;
		const rest = id.slice(marker + "/node_modules/".length).split("/");
		const name = rest[0]?.startsWith("@") ? `${rest[0]}/${rest[1]}` : rest[0];
		if (name === undefined) continue;
		const folder = `${id.slice(0, marker)}/node_modules/${name}`;
		const { version } = JSON.parse(readFileSync(join(folder, "package.json"), "utf8")) as {
			version: string;
		};
		packages.add(`${name}@${version}`);
	}
	return { packages, generatedBy };
}

/** What a module graph carries that the notices do not list. Empty means every package is credited. */
function uncredited(modules: readonly string[]): string[] {
	const { packages, generatedBy } = packagesIn(modules);
	const known = listed();
	return [
		...[...packages].filter((pkg) => !known.packages.has(pkg)),
		...[...generatedBy]
			.filter((name) => !known.names.has(name))
			.map((name) => `${name} (generated code)`),
	].sort();
}

/**
 * Runs one bundler. Its temp folder is this test's own, so whatever it leaves there goes with the
 * folder. Wrangler's banner is off: behind it, wrangler asks npm for its latest version and caches
 * the answer in the temp folder.
 */
function run(argv: readonly string[], cwd: string): void {
	const [program, ...args] = argv;
	const env = { ...process.env, TMPDIR: `${work}/`, WRANGLER_HIDE_BANNER: "true" };
	const result = spawnSync(program ?? "", args, { cwd, encoding: "utf8", env });
	if (result.status !== 0) {
		throw new Error(`${argv.join(" ")} failed:\n${result.stdout}\n${result.stderr}`);
	}
}

/** The input files of an esbuild-style metafile, as absolute paths. */
function metafileInputs(path: string, from: string): string[] {
	const meta = JSON.parse(readFileSync(path, "utf8")) as { inputs: Record<string, unknown> };
	return Object.keys(meta.inputs).map((input) => resolve(from, input));
}

/** A Bun bundle's module graph, with the resolution `bun build --compile` uses. */
function bunGraph(entry: string, cwd: string, name: string): string[] {
	const meta = join(work, `${name}.meta.json`);
	run(
		["bun", "build", entry, "--target", "bun", "--outdir", join(work, name), `--metafile=${meta}`],
		cwd,
	);
	return metafileInputs(meta, cwd);
}

describe("every package the builds bundle is in the notices", () => {
	test(
		"the web UI",
		() => {
			const out = join(work, "web-ui.json");
			// Vite's API with the app's own config, run by Node from apps/desktop as `pnpm build` runs it.
			const script = [
				'import { writeFileSync } from "node:fs";',
				'import { build } from "vite";',
				"const ids = new Set();",
				'await build({ configFile: "vite.config.ts", logLevel: "error", build: { write: false },',
				'\tplugins: [{ name: "module-graph", generateBundle() {',
				"\t\tfor (const id of this.getModuleIds()) ids.add(id);",
				"\t} }] });",
				"writeFileSync(process.argv[1], JSON.stringify([...ids]));",
			].join("\n");
			run(["node", "--input-type=module", "-e", script, out], DESKTOP);
			const modules = JSON.parse(readFileSync(out, "utf8")) as string[];

			expect(packagesIn(modules).packages.size).toBeGreaterThan(100);
			expect(uncredited(modules)).toEqual([]);
		},
		HANG_MS,
	);

	test(
		"the sidecar",
		() => {
			const modules = bunGraph("src/main.ts", SIDECAR, "sidecar");

			expect(packagesIn(modules).packages.size).toBeGreaterThan(5);
			expect(uncredited(modules)).toEqual([]);
		},
		HANG_MS,
	);

	test(
		"the cloud sandbox's entry",
		() => {
			expect(uncredited(bunGraph("sandbox/entry.ts", CLOUD, "entry"))).toEqual([]);
		},
		HANG_MS,
	);

	test(
		"the cloud Worker",
		() => {
			const facts = readDeployFacts(readFileSync(join(CLOUD, "wrangler.jsonc"), "utf8"));
			const config = join(work, "worker-config.json");
			writeFileSync(config, JSON.stringify(bundlingConfig(facts, join(CLOUD, "src/index.ts"))));
			const meta = join(work, "worker.meta.json");
			run(
				[
					"pnpm",
					"exec",
					"wrangler",
					"deploy",
					"--dry-run",
					"--config",
					config,
					"--outdir",
					join(work, "worker"),
					"--metafile",
					meta,
				],
				CLOUD,
			);
			// wrangler's paths start from the config's folder, its project root.
			const modules = metafileInputs(meta, work);

			const packages = [...packagesIn(modules).packages];
			expect(packages.some((pkg) => pkg.startsWith("@cloudflare/sandbox@"))).toBe(true);
			expect(uncredited(modules)).toEqual([]);
		},
		HANG_MS,
	);

	test(
		"a bundle that takes a development dependency is caught",
		() => {
			// sql.js is a development dependency of the desktop: only the states catalogue uses it.
			const sqlJs = realpathSync(join(DESKTOP, "node_modules/sql.js"));
			const entry = join(work, "takes-dev-dependency.ts");
			writeFileSync(
				entry,
				`import initSqlJs from ${JSON.stringify(sqlJs)};\nconsole.log(initSqlJs);\n`,
			);
			const { version } = JSON.parse(readFileSync(join(sqlJs, "package.json"), "utf8")) as {
				version: string;
			};

			expect(uncredited(bunGraph(entry, work, "dev-dependency"))).toEqual([`sql.js@${version}`]);
		},
		HANG_MS,
	);
});
