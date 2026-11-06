/**
 * sql.js for the reference tools. sql.js and its types are apps/desktop's dependencies, so the module is
 * loaded from there and the types are sql.js's own (@types/sql.js), not a copy.
 */
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import type initSqlJs from "../../apps/desktop/node_modules/@types/sql.js/index.d.ts";

export type SqlJsStatic = initSqlJs.SqlJsStatic;
export type Database = initSqlJs.Database;
export type SqlValue = initSqlJs.SqlValue;

const DESKTOP = resolve(import.meta.dir, "../../apps/desktop");

/** Loads sql.js's Node build (it finds its WebAssembly file beside itself). */
export async function loadSqlJs(): Promise<SqlJsStatic> {
	const init = createRequire(join(DESKTOP, "package.json"))("sql.js") as typeof initSqlJs;
	return await init();
}
