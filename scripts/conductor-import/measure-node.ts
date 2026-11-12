/**
 * @feature APP-18 Timing the Conductor import at full size: the Node child
 * Owns: `node scripts/conductor-import/measure-node.ts <folder> <bun> <socket-folder>`, which
 * measure.ts starts.
 * It loads measure-import.ts through Vite's module runner, as Vitest loads the desktop's tests,
 * because the Node stand-in reads SQLite with node:sqlite, which Bun lacks, and Node alone cannot
 * read the app's TypeScript. It sends measure.ts one JSON line per message on file descriptor 3:
 * the sidecar's pid, the moment the dry run begins, the dry run's counts, the moment the import
 * ends, then the numbers or the stage that failed.
 * Behaviour: docs/plans/migrate-from-conductor.md ("Chat history"); issue #556.
 * Must handle: only numbers and fixed words cross to the parent; an error's message is never sent,
 * because it could quote a row; Vite writes its cache inside the run's folder.
 * Written in the TypeScript Node runs without a build step: types only, no enums or parameter
 * properties.
 * Test first: scripts/conductor-import/measure.test.ts, "prints only lines from the fixed list".
 */
import { writeSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import type { Measured, Stage } from "./measure-import.ts";

export type ChildMessage =
	| { kind: "sidecar"; pid: number }
	| { kind: "started" }
	| { kind: "dryRun"; dryRun: Measured["dryRun"] }
	| { kind: "imported" }
	| { kind: "measured"; measured: Measured }
	| { kind: "failed"; stage: Stage | "load" };

const REPO = resolve(import.meta.dirname, "../..");
const DESKTOP = join(REPO, "apps/desktop");

const send = (message: ChildMessage): void => {
	writeSync(3, `${JSON.stringify(message)}\n`);
};

async function main(folder: string, bunPath: string, socketFolder: string): Promise<number> {
	const vite = (await import(
		createRequire(join(DESKTOP, "package.json")).resolve("vite")
	)) as typeof import("../../apps/desktop/node_modules/vite/dist/node/index.js");
	const config = await vite.resolveConfig(
		{
			configFile: false,
			envDir: false,
			root: DESKTOP,
			cacheDir: join(folder, "vite-cache"),
			logLevel: "silent",
			environments: {
				measure: {
					consumer: "server",
					dev: { moduleRunnerTransform: true },
					resolve: { external: true, mainFields: [], conditions: ["node"] },
				},
			},
		},
		"serve",
	);
	const environment = vite.createRunnableDevEnvironment("measure", config, {
		runnerOptions: { hmr: { logger: false } },
		hot: false,
	});
	await environment.init();
	try {
		let module: typeof import("./measure-import.ts");
		try {
			module = await environment.runner.import(join(import.meta.dirname, "measure-import.ts"));
		} catch {
			send({ kind: "failed", stage: "load" });
			return 1;
		}
		try {
			const measured = await module.measureImport({
				folder,
				bunPath,
				socketFolder,
				onSidecar: (pid) => send({ kind: "sidecar", pid }),
				onStarted: () => send({ kind: "started" }),
				onDryRun: (dryRun) => send({ kind: "dryRun", dryRun }),
				onImported: () => send({ kind: "imported" }),
			});
			send({ kind: "measured", measured });
			return 0;
		} catch (error) {
			send({
				kind: "failed",
				stage: error instanceof module.StageFailure ? error.stage : "import",
			});
			return 1;
		}
	} finally {
		await environment.close();
	}
}

// It exits when the run ends, so a handle the app left open cannot keep the child alive.
const [folder, bunPath, socketFolder] = process.argv.slice(2);
process.exit(
	folder === undefined || bunPath === undefined || socketFolder === undefined
		? 2
		: await main(folder, bunPath, socketFolder),
);
