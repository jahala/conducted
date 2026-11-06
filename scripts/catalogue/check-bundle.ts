/**
 * Fails when the web UI build contains the states catalogue, a development tool that must never ship.
 *
 * It looks for three signs in the build folder: a `catalogue.html` page, a sql.js WebAssembly file
 * (only the catalogue uses sql.js), and the text the catalogue writes on every page
 * (`CATALOGUE_MARKER` in apps/desktop/src/catalogue/marker.ts) inside any built file.
 * `pnpm build` in apps/desktop runs it after `vite build`, so CI's build step and the release build
 * (scripts/release.ts, through Tauri's beforeBuildCommand) both stop on a catalogue in the bundle.
 *
 * Usage: bun scripts/catalogue/check-bundle.ts <build folder>
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { CATALOGUE_MARKER } from "../../apps/desktop/src/catalogue/marker.ts";

/** Every file under a folder, as paths relative to it. */
function filesUnder(dir: string): string[] {
	const found: string[] = [];
	const walk = (current: string): void => {
		for (const name of readdirSync(current)) {
			const path = join(current, name);
			if (statSync(path).isDirectory()) walk(path);
			else found.push(relative(dir, path));
		}
	};
	walk(dir);
	return found;
}

/** What in a build folder shows the catalogue was bundled. Empty when the build is clean. */
export function catalogueTraces(dir: string): string[] {
	const traces: string[] = [];
	for (const file of filesUnder(dir)) {
		const name = file.slice(file.lastIndexOf("/") + 1);
		if (name === "catalogue.html") traces.push(`${file}: the catalogue page`);
		if (name.includes("sql-wasm")) traces.push(`${file}: sql.js, which only the catalogue uses`);
		if (readFileSync(join(dir, file)).includes(CATALOGUE_MARKER)) {
			traces.push(`${file}: contains the catalogue marker "${CATALOGUE_MARKER}"`);
		}
	}
	return traces;
}

if (import.meta.main) {
	const dir = process.argv[2];
	if (dir === undefined) {
		console.error("Usage: bun scripts/catalogue/check-bundle.ts <build folder>");
		process.exit(1);
	}
	const files = filesUnder(dir);
	if (files.length === 0) {
		console.error(`${dir} is empty; there is no build to check.`);
		process.exit(1);
	}
	const traces = catalogueTraces(dir);
	if (traces.length > 0) {
		console.error("The build contains the states catalogue, which must never ship:");
		for (const trace of traces) console.error(`  ${trace}`);
		process.exit(1);
	}
	console.log(`No states catalogue in ${files.length} built files.`);
}
