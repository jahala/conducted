/**
 * Guard: the parity map's owners are what `scripts/parity/owners.ts` derives. A pull request that
 * changes a checklist item, a map entry or the spec without rerunning it leaves the map behind, and
 * the next run rewrites entries that pull request never touched (issue #671). The script reads only
 * committed files, so this runs everywhere, CI included.
 */
import { join } from "node:path";
import { readExcluded, readItems, readMaps, readSpec } from "../parity/lib.ts";
import { ownerDrift, rowSites } from "../parity/owners.ts";
import type { Problem } from "./lib.ts";

export function checkParityOwners(root: string): Problem[] {
	const specDir = join(root, "tests/parity/spec");
	const specs = readSpec(specDir);
	const drift = ownerDrift(
		specs,
		readMaps(join(root, "tests/parity/map")),
		readItems(root),
		rowSites(specs, readExcluded(specDir)),
	);
	return drift.map(({ inventory, id, committed, derived }) => ({
		guard: "parity-owners",
		message: `tests/parity/map/${inventory}.json: ${id} is ${JSON.stringify(committed)}, but owners.ts derives ${JSON.stringify(derived)}; run bun scripts/parity/owners.ts`,
	}));
}
