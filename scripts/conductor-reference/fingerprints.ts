/**
 * Writes the data the conductor-code guard checks against (scripts/guards/conductor-fingerprints.json),
 * from the bundle and its call inventory. Only hashes are written.
 *
 * - names: every hashed chunk file name under `assets/`;
 * - contents: the bytes of every JavaScript, CSS and HTML file of the bundle;
 * - windows: 64 characters of code at every call site of a custom command, sidecar method, event and SQL
 *   statement in the inventory, and 512 characters before and after each. Those sites are the bundle's
 *   own code, not a library's. A window with fewer than 24 distinct characters is skipped, so no window
 *   is mostly padding.
 *
 * It then runs the guard on the repository. A window found in a file we already have would make the
 * guard fail on the repository; it is listed and the run exits 1, so a person decides.
 *
 * Usage: bun scripts/conductor-reference/fingerprints.ts [--bundle <dir>] [--inventory <file>]
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import {
	CHUNK_NAME,
	FINGERPRINTS,
	type Fingerprints,
	findConductorCode,
	repositoryFiles,
	rollingHash,
	sha256,
	WINDOW,
} from "../guards/conductor-code.ts";
import { ROOT } from "./catalogue.ts";
import type { Inventory } from "./inventory.ts";
import { defaultPaths } from "./paths.ts";
import { flag } from "./server.ts";

const CODE_FILES = new Set([".js", ".mjs", ".css", ".html"]);
const MIN_DISTINCT = 24;
/** Where windows are taken around each call site. */
const AROUND = [-512, 0, 512];

/** The fingerprints of a bundle folder, given its call inventory. */
export function fingerprintsOf(
	bundleDir: string,
	inventory: Inventory,
	source: string,
): Fingerprints {
	const assets = join(bundleDir, "assets");
	const files = [
		...readdirSync(bundleDir).map((name) => join(bundleDir, name)),
		...readdirSync(assets).map((name) => join(assets, name)),
	];
	const names = new Set<string>();
	const contents = new Set<string>();
	for (const path of files) {
		const name = path.slice(path.lastIndexOf("/") + 1);
		if (path.startsWith(assets) && CHUNK_NAME.test(name)) names.add(sha256(name));
		if (CODE_FILES.has(extname(name))) contents.add(sha256(readFileSync(path)));
	}

	const texts = new Map<string, string>();
	const textOf = (file: string): string => {
		let text = texts.get(file);
		if (text === undefined) {
			text = readFileSync(join(assets, file), "utf8");
			texts.set(file, text);
		}
		return text;
	};
	const sites = [
		...inventory.commands.flatMap((entry) => entry.sites),
		...inventory.sidecar.flatMap((entry) => entry.sites),
		...inventory.events.flatMap((entry) => entry.sites),
		...inventory.sql.flatMap((entry) => entry.sites),
	];
	const windows = new Map<string, { rolling: number; sha256: string }>();
	for (const site of sites) {
		const text = textOf(site.file);
		for (const shift of AROUND) {
			const start = site.offset + shift;
			if (start < 0) continue;
			const window = text.slice(start, start + WINDOW);
			if (window.length < WINDOW || new Set(window).size < MIN_DISTINCT) continue;
			windows.set(window, { rolling: rollingHash(window), sha256: sha256(window) });
		}
	}
	return {
		source,
		names: [...names].sort(),
		contents: [...contents].sort(),
		windows: [...windows.values()].sort((a, b) => a.sha256.localeCompare(b.sha256)),
	};
}

if (import.meta.main) {
	const args = process.argv.slice(2);
	const paths = defaultPaths();
	const bundle = flag(args, "bundle") ?? paths.bundle;
	const inventory = JSON.parse(
		readFileSync(flag(args, "inventory") ?? paths.inventory, "utf8"),
	) as Inventory;
	const fingerprints = fingerprintsOf(bundle, inventory, "Conductor 0.92.1 frontend bundle");
	writeFileSync(join(ROOT, FINGERPRINTS), `${JSON.stringify(fingerprints, null, "\t")}\n`);
	console.log(
		`${fingerprints.names.length} chunk names, ${fingerprints.contents.length} code files, ${fingerprints.windows.length} code windows`,
	);
	const problems = findConductorCode(ROOT, repositoryFiles(ROOT), fingerprints);
	for (const found of problems) console.log(`FAIL ${found.message}`);
	if (problems.length > 0) process.exit(1);
	console.log(`The repository passes: ${repositoryFiles(ROOT).length} files checked.`);
}
