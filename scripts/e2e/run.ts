/**
 * @feature End-to-end tests in the real app (issue #564)
 * Owns: `pnpm test:e2e`: builds the test app, runs each check over its own fresh folder, prints
 * each check's failures, and on every ending stops the app and removes the folders.
 * Behaviour: issue #564, part 1: the driver and the round trips.
 * Must handle: Ctrl+C or a kill signal mid-check (the app is stopped by its pid and the folders
 * removed before the run exits); a check that throws (reported as its failure, the next check
 * still runs); anything left behind (a process that outlived its app, a folder not removed), which
 * fails the run even when every check passed.
 * Usage: pnpm test:e2e [check ...]   (names: round-trip, drag, overflow; default: all)
 * Test first: fails the run when a folder of this run is left on disk.
 */
import { sidebarDrag } from "./drag.ts";
import {
	buildTestApp,
	type Check,
	cleanUp,
	newTracker,
	removeAbandonedFolders,
} from "./harness.ts";
import { settingsOverflow } from "./settings-overflow.ts";
import { settingsRoundTrip } from "./settings-round-trip.ts";

const CHECKS: Readonly<Record<string, Check>> = {
	"round-trip": settingsRoundTrip,
	drag: sidebarDrag,
	overflow: settingsOverflow,
};

async function main(names: readonly string[]): Promise<number> {
	const unknown = names.filter((name) => !(name in CHECKS));
	if (unknown.length > 0) {
		console.error(
			`Unknown check: ${unknown.join(", ")}. Known: ${Object.keys(CHECKS).join(", ")}.`,
		);
		return 64;
	}
	const chosen = names.length === 0 ? Object.keys(CHECKS) : [...names];
	const tracker = newTracker();
	let stopping = false;
	const onSignal = (signal: NodeJS.Signals): void => {
		if (stopping) return;
		stopping = true;
		console.error(`\n${signal}: stopping the app and removing the folders.`);
		void cleanUp(tracker).finally(() => process.exit(signal === "SIGINT" ? 130 : 143));
	};
	process.on("SIGINT", onSignal);
	process.on("SIGTERM", onSignal);

	const abandoned = removeAbandonedFolders();
	if (abandoned > 0) console.log(`Removed ${abandoned} folder(s) left by runs that were killed.`);
	const started = Date.now();
	const bundle = await buildTestApp();
	console.log(`Test app ready in ${((Date.now() - started) / 1000).toFixed(1)} s: ${bundle}`);

	let failed = 0;
	try {
		for (const name of chosen) {
			const check = CHECKS[name];
			if (check === undefined) continue;
			const began = Date.now();
			console.log(`\n${name}: ${check.name}`);
			let failures: string[];
			try {
				failures = await check.run({ bundle, tracker, log: (line) => console.log(line) });
			} catch (cause) {
				failures = [cause instanceof Error ? cause.message : String(cause)];
			}
			const left = await cleanUp(tracker);
			failures.push(...left);
			const seconds = ((Date.now() - began) / 1000).toFixed(1);
			if (failures.length === 0) {
				console.log(`ok   ${name} (${seconds} s)`);
			} else {
				failed += 1;
				for (const line of failures) console.log(`  FAIL ${line}`);
				console.log(`FAIL ${name} (${seconds} s, ${failures.length} failure(s))`);
			}
		}
	} finally {
		const left = await cleanUp(tracker);
		if (left.length > 0) {
			failed += 1;
			for (const line of left) console.log(`FAIL left behind: ${line}`);
		}
	}
	console.log(
		`\n${chosen.length - failed} of ${chosen.length} checks passed in ${((Date.now() - started) / 1000).toFixed(1)} s.`,
	);
	return failed === 0 ? 0 : 1;
}

if (import.meta.main) {
	main(process.argv.slice(2))
		.then((code) => process.exit(code))
		.catch((cause: unknown) => {
			console.error(cause instanceof Error ? cause.message : cause);
			process.exit(1);
		});
}
