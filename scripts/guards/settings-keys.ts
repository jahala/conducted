/**
 * Guard: the settings table's bookkeeping keys are named in docs/data-model.md. The registry holds
 * the user's settings; a module in `core/db` may also store its own key there (the data-lifetime
 * job stores when it last ran). This fails on a `_KEY` constant in `core/db` that the doc does not
 * name, so the "fixed set of keys" claim cannot quietly become false again.
 */
import { join } from "node:path";
import { type Problem, read, rel, walk } from "./lib.ts";

const DOC = "docs/data-model.md";
const KEY_CONSTANT = /^export const \w+_KEY = "([^"]+)"/;

export function checkSettingsKeys(root: string): Problem[] {
	const doc = read(join(root, DOC));
	const problems: Problem[] = [];
	for (const path of walk(root, join(root, "apps/desktop/src/core/db"), /\.ts$/)) {
		const file = rel(root, path);
		if (/\.test\.ts$/.test(file)) continue;
		for (const line of read(path).split("\n")) {
			const match = KEY_CONSTANT.exec(line);
			if (match === null) continue;
			const key = match[1] ?? "";
			if (!doc.includes(key)) {
				problems.push({
					guard: "settings-keys",
					message: `${file} stores the settings key ${key}; name it in ${DOC}`,
				});
			}
		}
	}
	return problems;
}
