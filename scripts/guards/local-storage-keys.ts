/**
 * Guard: every `localStorage` key the desktop writes is listed in docs/data-model.md with its
 * lifetime. The browser storage outlives the database and has no schema, so the doc is the only
 * record of it. This fails on a `conducted.` key literal the doc does not name.
 */
import { join } from "node:path";
import { type Problem, read, rel, walk } from "./lib.ts";
import { codeOnly } from "./sidecar-edges.ts";

const DOC = "docs/data-model.md";
const STORAGE_KEY = /["'`](conducted\.[\w.:-]+)/g;

export function checkLocalStorageKeys(root: string): Problem[] {
	const doc = read(join(root, DOC));
	const problems: Problem[] = [];
	for (const path of walk(root, join(root, "apps/desktop/src"), /\.(ts|tsx)$/)) {
		const file = rel(root, path);
		if (/\.test\.tsx?$/.test(file)) continue;
		const code = codeOnly(read(path));
		for (const match of code.matchAll(STORAGE_KEY)) {
			const key = match[1] ?? "";
			if (!doc.includes(key)) {
				problems.push({
					guard: "local-storage-keys",
					message: `${file} uses the local storage key ${key}; name it in ${DOC}`,
				});
			}
		}
	}
	return problems;
}
