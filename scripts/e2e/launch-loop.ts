/**
 * Temporary measure for #632, removed before the pull request: launches the test app over fresh
 * folders and prints each launch's time to the first screen, the seeding's open database files and
 * what is alive right after each quit.
 * Usage: bun scripts/e2e/launch-loop.ts <pairs>
 */
import { spawnSync } from "node:child_process";
import {
	buildTestApp,
	cleanUp,
	launch,
	makeFreshFolder,
	newTracker,
	proveFreshPageStorage,
	quit,
	type RunningApp,
	removeAbandonedFolders,
	type Tracker,
} from "./harness.ts";
import { seedWorld } from "./world.ts";

const pairs = Number(process.argv[2] ?? "30");
const times: number[] = [];
let seedingOpen = 0;
const outlivedLines: string[] = [];

function snapshot(tracker: Tracker, roots: string[], label: string): void {
	for (const id of tracker.seen) {
		let alive = true;
		try {
			process.kill(id, 0);
		} catch {
			alive = false;
		}
		if (!alive) continue;
		const ps = spawnSync("/bin/ps", ["-o", "pid=,ppid=,pgid=,stat=,comm=", "-p", String(id)], {
			encoding: "utf8",
		}).stdout.trim();
		const files = spawnSync("/usr/sbin/lsof", ["-a", "-p", String(id), "-Fftn"], {
			encoding: "utf8",
		})
			.stdout.split("\n")
			.filter((line) => line.startsWith("n") && roots.some((root) => line.startsWith(`n${root}/`)))
			.slice(0, 3)
			.map((line) => line.slice(1).replace(/^.*\/(Conducted\.app|home)\//, "$1/"));
		const line = `${label} alive ${id}: ${ps || "(ps: none)"} | ${files.join(", ") || "(no run files)"}`;
		console.log(`    ${line}`);
		if (files.length > 0) outlivedLines.push(line);
	}
}

function seedingFiles(): number {
	const out = spawnSync("/usr/sbin/lsof", ["-p", String(process.pid), "-Fn"], { encoding: "utf8" });
	return out.stdout.split("\n").filter((line) => /conducted\.db/.test(line)).length;
}

async function timed(run: () => Promise<RunningApp>): Promise<RunningApp> {
	const start = Date.now();
	const app = await run();
	times.push(Date.now() - start);
	return app;
}

removeAbandonedFolders();
const bundle = await buildTestApp();
let errors = 0;
for (let i = 0; i < pairs; i++) {
	const tracker = newTracker();
	try {
		const folder = makeFreshFolder(bundle, tracker);
		const roots = [folder.root];
		const first = await timed(() => launch(folder, tracker));
		await proveFreshPageStorage(first);
		await quit(first, tracker);
		snapshot(tracker, roots, "after first quit");
		await seedWorld(folder);
		const open = seedingFiles();
		seedingOpen = Math.max(seedingOpen, open);
		const second = await timed(() => launch(folder, tracker));
		await quit(second, tracker);
		snapshot(tracker, roots, "after second quit");
		console.log(`${i} first ${times.at(-2)} ms, second ${times.at(-1)} ms, seeding files open ${open}`);
	} catch (cause) {
		errors += 1;
		console.log(`${i} ERROR ${cause instanceof Error ? cause.message.slice(0, 400) : String(cause)}`);
	} finally {
		const left = await cleanUp(tracker);
		if (left.length > 0) console.log(`  cleanUp: ${left.join("; ")}`);
	}
}
const sorted = [...times].sort((a, b) => a - b);
const over = (ms: number): number => times.filter((t) => t > ms).length;
console.log(
	`\n${times.length} launches, ${errors} errors. Over 10 s: ${over(10_000)}, over 20 s: ${over(20_000)}. Median ${sorted[Math.floor(sorted.length / 2)]} ms, max ${sorted.at(-1)} ms. Most seeding files open at once: ${seedingOpen}. Alive with run files after a quit: ${outlivedLines.length}.`,
);
console.log(`Sorted: ${sorted.join(" ")}`);
