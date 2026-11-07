/**
 * Refreshes the product page's screenshots (issue #356): captures the catalogue states the page
 * shows (scripts/catalogue/shots.ts, light and dark at 1440 x 900) and copies them into
 * docs/site/images as `<state-id>-<light|dark>.png`. The screenshots are of Conducted itself, from
 * the states catalogue, never of Conductor (D002).
 *
 * Usage: bun scripts/site/screens.ts
 * The site guard (scripts/guards/site.ts) fails when a page links to an image that is not here, or
 * when an image here is used by no page, so this list and the pages stay in step.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");
const SHOTS = join(ROOT, ".context/shots/ours");
const IMAGES = join(ROOT, "docs/site/images");

/** The states the page shows, in page order. */
const PAGE_STATES = [
	"chat-tool-calls",
	"home",
	"chat-plan-review",
	"git-diff",
	"git-checks",
	"command-palette",
] as const;

function main(): number {
	const run = spawnSync("bun", [join(ROOT, "scripts/catalogue/shots.ts"), ...PAGE_STATES], {
		cwd: ROOT,
		stdio: "inherit",
	});
	if (run.status !== 0) return run.status ?? 1;
	for (const state of PAGE_STATES) {
		for (const theme of ["light", "dark"]) {
			const name = `${state}-${theme}.png`;
			copyFileSync(join(SHOTS, name), join(IMAGES, name));
		}
	}
	console.log(`Copied ${PAGE_STATES.length * 2} screenshots into docs/site/images.`);
	return 0;
}

if (import.meta.main) process.exit(main());
