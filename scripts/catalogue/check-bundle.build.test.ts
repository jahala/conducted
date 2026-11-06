/**
 * The real web UI build leaves the states catalogue out, and the bundle check would catch it if a
 * change put it in: a build that adds the catalogue page as a second input is flagged.
 * Each case runs `vite build` with the app's own config into this run's temp folder.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { catalogueTraces } from "./check-bundle.ts";

const DESKTOP = resolve(import.meta.dir, "../../apps/desktop");
/** Catches a hung build. A build takes a few seconds. */
const HANG_MS = 120_000;

let work: string;

beforeEach(() => {
	work = mkdtempSync(join(tmpdir(), "bundle-build-"));
});

afterEach(() => {
	rmSync(work, { recursive: true, force: true });
});

/**
 * Builds with the app's own vite.config.ts through Vite's API, run by Node from apps/desktop so every
 * plugin resolves as in `pnpm build`. `withCatalogue` adds the catalogue page as a second input.
 */
function viteBuild(outDir: string, withCatalogue: boolean): void {
	const input = withCatalogue ? { index: "index.html", catalogue: "catalogue.html" } : undefined;
	const script = [
		'import { build } from "vite";',
		"const [outDir, input] = JSON.parse(process.argv[1]);",
		'await build({ configFile: "vite.config.ts", logLevel: "error",',
		"\tbuild: { outDir, emptyOutDir: true, ...(input ? { rolldownOptions: { input } } : {}) } });",
	].join("\n");
	const run = spawnSync(
		"node",
		["--input-type=module", "-e", script, JSON.stringify([outDir, input ?? null])],
		{ cwd: DESKTOP, encoding: "utf8" },
	);
	if (run.status !== 0) throw new Error(`vite build failed:\n${run.stdout}\n${run.stderr}`);
}

test(
	"the release build of the web UI contains no catalogue",
	() => {
		const out = join(work, "dist");
		viteBuild(out, false);
		expect(catalogueTraces(out)).toEqual([]);
	},
	HANG_MS,
);

test(
	"a build that bundles the catalogue page is flagged",
	() => {
		const out = join(work, "dist");
		viteBuild(out, true);
		const traces = catalogueTraces(out);
		expect(traces).toContain("catalogue.html: the catalogue page");
		expect(traces.some((trace) => trace.includes("contains the catalogue marker"))).toBe(true);
	},
	HANG_MS,
);
