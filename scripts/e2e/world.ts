/**
 * @feature End-to-end tests in the real app (issue #564)
 * Owns: the data a check starts from, written into the fresh folder after the app's first launch
 * applied its migrations: two projects (one with a name longer than any sidebar row), three
 * workspaces on this Mac and one cloud workspace, the local ones real git repositories on disk,
 * and an SSH key pair for the SSH key setting.
 * Behaviour: issue #564 asks for the cloud workspace the Sync files switch needs (#549, #561); the
 * drag and the overflow checks need workspaces in the sidebar and a long project name.
 * Must handle: the app is not running while the rows are written, so no statement races its own
 * queue; the rows go through the app's own repositories (core/db), so they are the rows the app
 * would write itself; the repositories pass through the app's statement queue
 * (platform/queued-database.ts), as in the app.
 * Our design choice: the database is opened with `bun:sqlite`, through a small handle shaped like
 * tauri-plugin-sql's (`SqlDatabase`). The tests' node:sqlite handle (src/test/node-sql.ts) cannot
 * run here: Bun has no node:sqlite.
 * Our design choice: git repositories come from the reference run's disk planter
 * (conductor-reference/world-disk.ts), so the project's one fixture builds them.
 */
import { Database as BunDatabase } from "bun:sqlite";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ScriptedRepo } from "../../apps/desktop/src/catalogue/git-repo.ts";
import { createRepositories } from "../../apps/desktop/src/core/db/repositories.ts";
import type { Workspace } from "../../apps/desktop/src/core/model.ts";
import type { PairingView } from "../../apps/desktop/src/core/organization.ts";
import { getSettingDef } from "../../apps/desktop/src/core/registries/settings.ts";
import {
	createQueuedDatabase,
	type SqlDatabase,
} from "../../apps/desktop/src/platform/queued-database.ts";
import { cryptoIds, type RepoId, systemClock } from "../../packages/shared/src/index.ts";
import { plantOnDisk } from "../conductor-reference/world-disk.ts";
import {
	type CheckContext,
	type FreshFolder,
	launch,
	makeFreshFolder,
	proveFreshPageStorage,
	quit,
	type RunningApp,
} from "./harness.ts";

/** A project name longer than any sidebar row, as the settings sidebar met it (#488). */
export const LONG_PROJECT_NAME =
	"an-extremely-long-project-name-that-would-push-a-sidebar-row-wider-than-its-column";

const AUTHOR = { name: "E2e Tester", email: "e2e@example.invalid" };

/** What the checks find in the app after `seedWorld`. */
export interface World {
	projects: { id: RepoId; name: string; rootPath: string }[];
	/** The three workspaces on this Mac, in creation order. */
	local: Workspace[];
	cloud: Workspace;
	/** A private key with its `.pub` beside it, for the SSH key setting. */
	sshKey: string;
	/**
	 * The organisation switcher's inputs: the folder's own Keychain holds no pairing, and the
	 * stored choice is the setting's default, so the active entry is this Mac.
	 */
	organization: { pairing: PairingView; choice: string };
}

/**
 * `bun:sqlite` shaped like tauri-plugin-sql's handle; `$1..$n` bind by name, as Bun needs. The
 * statements come from `db.query`, which caches them and finalizes them on `close()`. One from
 * `db.prepare` stays unfinalized, so `close()` would leave the connection and its files open until
 * the garbage collector got to it.
 */
function bunSqlDatabase(db: BunDatabase): SqlDatabase {
	const bind = (params: readonly unknown[] = []): Record<string, never> =>
		Object.fromEntries(params.map((value, index) => [`$${index + 1}`, value])) as never;
	return {
		execute: async (sql, params) => {
			const result = db.query(sql).run(bind(params));
			return { rowsAffected: result.changes, lastInsertId: Number(result.lastInsertRowid) };
		},
		select: async <Rows>(sql: string, params?: unknown[]) =>
			db.query(sql).all(bind(params)) as Rows,
	};
}

const must = <T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): T => {
	if (!result.ok) throw new Error(result.error.message);
	return result.value;
};

/** Writes the world into the folder's database and plants its repositories. The app must be stopped. */
export async function seedWorld(folder: FreshFolder): Promise<World> {
	const file = new BunDatabase(join(folder.appData, "conducted.db"));
	try {
		file.run("PRAGMA foreign_keys = ON");
		const db = createQueuedDatabase(bunSqlDatabase(file));
		const repositories = createRepositories(db, { clock: systemClock, ids: cryptoIds });
		const code = join(folder.home, "code");
		const workspacesRoot = join(folder.home, "conductor/workspaces");
		const projects = [];
		for (const name of ["atlas", LONG_PROJECT_NAME]) {
			const repo = must(
				await repositories.repos.create({
					name,
					rootPath: join(code, name),
					remoteUrl: null,
					defaultBranch: "main",
					icon: null,
				}),
			);
			projects.push({ id: repo.id, name, rootPath: repo.rootPath });
		}
		const atlas = projects[0];
		if (atlas === undefined) throw new Error("The first project was not created.");
		const local: Workspace[] = [];
		for (const [index, name] of ["first", "second", "third"].entries()) {
			const created = must(
				await repositories.workspaces.create({
					repoId: atlas.id,
					directoryName: name,
					path: join(workspacesRoot, "atlas", name),
					branch: `e2e/${name}`,
					branchIsPlaceholder: false,
					targetBranch: "main",
					port: 55_000 + index * 10,
					linkedPaths: [],
					setupLogPath: null,
					host: { kind: "local" },
					remoteFileSyncEnabled: false,
				}),
			);
			must(await repositories.workspaces.transitionState(created.id, "initializing", "ready"));
			local.push({ ...created, state: "ready" });
		}
		// The Advanced setting's default (on) is the first value a new cloud workspace takes (D111).
		const cloudCreated = must(
			await repositories.workspaces.create({
				repoId: atlas.id,
				directoryName: "cloud",
				path: join(workspacesRoot, "atlas", "cloud"),
				branch: "e2e/cloud",
				branchIsPlaceholder: false,
				targetBranch: "main",
				port: 55_100,
				linkedPaths: [],
				setupLogPath: null,
				host: { kind: "cloud", url: "https://worker.e2e.invalid", vmId: "e2e-sandbox" },
				remoteFileSyncEnabled: true,
			}),
		);
		must(await repositories.workspaces.transitionState(cloudCreated.id, "initializing", "ready"));
		const cloud: Workspace = { ...cloudCreated, state: "ready" };

		const scripted = (workspace: Workspace): ScriptedRepo => ({
			path: workspace.path,
			branch: workspace.branch,
			target: "origin/main",
			files: [],
			commits: [],
			upstream: null,
			behindTarget: 0,
		});
		plantOnDisk({
			root: folder.root,
			home: folder.home,
			repos: local.map(scripted),
			files: new Map(),
			projects: projects.map((project) => ({ path: project.rootPath, defaultBranch: "main" })),
			workspaces: local.map((workspace) => ({ path: workspace.path, projectPath: atlas.rootPath })),
			author: AUTHOR,
		});
		const sshKey = join(folder.home, ".ssh/id_e2e");
		mkdirSync(dirname(sshKey), { recursive: true, mode: 0o700 });
		const keygen = spawnSync(
			"/usr/bin/ssh-keygen",
			["-q", "-t", "ed25519", "-N", "", "-C", "e2e", "-f", sshKey],
			{ encoding: "utf8" },
		);
		if (keygen.status !== 0) throw new Error(`ssh-keygen failed: ${keygen.stderr}`);
		const choice = getSettingDef("active_organization")?.default;
		const organization = {
			pairing: { paired: false, url: null },
			choice: typeof choice === "string" ? choice : "local",
		};
		return { projects, local, cloud, sshKey, organization };
	} finally {
		file.close();
	}
}

/**
 * A fresh folder with the world in it, and the app running over it: the first launch applies the
 * migrations and proves the page's storage is the folder's, then the world is written while the
 * app is stopped, then the app starts again and reads it.
 */
export async function startInWorld(
	context: CheckContext,
): Promise<{ app: RunningApp; world: World }> {
	const folder = makeFreshFolder(context.bundle, context.tracker);
	const first = await launch(folder, context.tracker);
	await proveFreshPageStorage(first);
	await quit(first, context.tracker);
	const world = await seedWorld(folder);
	return { app: await launch(folder, context.tracker), world };
}
