/**
 * The bundle check must flag each sign of the catalogue in a build folder, and pass a clean one.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CATALOGUE_MARKER } from "../../apps/desktop/src/catalogue/marker.ts";
import { catalogueTraces } from "./check-bundle.ts";

let dist: string;

const put = (file: string, text: string): void => {
	mkdirSync(dirname(join(dist, file)), { recursive: true });
	writeFileSync(join(dist, file), text);
};

beforeEach(() => {
	dist = mkdtempSync(join(tmpdir(), "bundle-"));
	put("index.html", '<div id="root"></div><script src="/assets/index-a1.js"></script>');
	put("assets/index-a1.js", "export const app = 1;");
});

afterEach(() => {
	rmSync(dist, { recursive: true, force: true });
});

test("a build without the catalogue passes", () => {
	expect(catalogueTraces(dist)).toEqual([]);
});

test("a bundled catalogue page is flagged", () => {
	put("catalogue.html", "<div></div>");
	expect(catalogueTraces(dist)).toEqual(["catalogue.html: the catalogue page"]);
});

test("the sql.js WebAssembly file is flagged", () => {
	put("assets/sql-wasm-browser-b2.wasm", "\0asm");
	expect(catalogueTraces(dist)).toEqual([
		"assets/sql-wasm-browser-b2.wasm: sql.js, which only the catalogue uses",
	]);
});

test("catalogue code inside an app chunk is flagged by its marker", () => {
	put("assets/index-a1.js", `const m="${CATALOGUE_MARKER}";export const app = 1;`);
	expect(catalogueTraces(dist)).toEqual([
		`assets/index-a1.js: contains the catalogue marker "${CATALOGUE_MARKER}"`,
	]);
});
