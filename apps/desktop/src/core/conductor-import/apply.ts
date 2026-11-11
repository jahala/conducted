/**
 * @feature APP-17 Writing the import: all or nothing, checked after
 * Owns: `applyImportPlan`, which moves the plan's secrets into the Keychain, writes its new
 * settings files, writes every row in one transaction, counts the rows and reads one sample of
 * each kind back before it commits, and undoes the Keychain entries and files when any step fails.
 * Behaviour: docs/plans/migrate-from-conductor.md, safety rules 3 (all or nothing; Keychain entries
 * the import made are removed on rollback), 4 (counted and sampled after; a count that differs
 * fails the import) and 6 (values never in an error).
 * Must handle: a `.conducted` folder the import had to make goes back with its file; a row
 * Conducted gained since the dry run (a setting, a variable, a project) makes
 * its insert write nothing or clash, which the count check or the database turns into a failure,
 * and the whole import rolls back; a settings file that appeared since the dry run is never
 * overwritten; workspace ports are chosen inside the port service's queue, so a workspace created
 * meanwhile cannot take the same block; a failed undo is reported with the names it could not
 * remove, never a value.
 * Test first: a failure part-way leaves Conducted's database, Keychain and files as they were.
 */
import { appError, err, ok, type Result } from "@conducted/shared";
import type { ConductorImport, Database, FileSystem, Keychain } from "../../platform/platform.ts";
import { DIFF_COMMENTS_SQL, diffCommentToParams } from "../db/diff-comments.ts";
import { ENV_VARS_SQL, envVarToParams } from "../db/env-vars.ts";
import { FAVORITE_MODELS_SQL, favoriteModelToParams } from "../db/favorite-models.ts";
import { REPOS_SQL, repoToParams } from "../db/repos.ts";
import type { Repositories } from "../db/repositories.ts";
import { executeStatement, inTransaction, selectRows } from "../db/row-codec.ts";
import { SECTIONS_SQL, sectionToParams } from "../db/sections.ts";
import { SESSIONS_SQL, sessionToParams } from "../db/sessions.ts";
import { SETTINGS_SQL, settingToParams } from "../db/settings.ts";
import { WORKSPACES_SQL, workspaceToParams } from "../db/workspaces.ts";
import type { ImportPlan, ImportRows, SettingsFileWrite } from "./plan.ts";

export interface ApplyDeps {
	db: Database;
	repositoriesOn: (db: Database) => Repositories;
	conductorImport: Pick<ConductorImport, "moveSecrets">;
	keychain: Pick<Keychain, "delete">;
	fs: Pick<FileSystem, "exists" | "mkdirp" | "trash">;
	/** Writes one new settings file through the settings service, which owns the format. */
	writeSettingsFile: (file: SettingsFileWrite) => Promise<Result<void>>;
	/** Picks `count` workspace ports and runs `use` with them inside the port service's queue. */
	withPorts: <T>(count: number, use: (ports: number[]) => Promise<Result<T>>) => Promise<Result<T>>;
	copyPath: string;
	now: number;
}

export type ImportedCounts = Record<
	| "repos"
	| "workspaces"
	| "chats"
	| "reviewComments"
	| "sections"
	| "favoriteModels"
	| "settings"
	| "environmentVariables"
	| "files",
	number
>;

const IMPORT_FAILED = "import_failed";

/** Moves the secrets, writes the files, then the rows; any failure undoes all three. */
export async function applyImportPlan(
	plan: ImportPlan,
	deps: ApplyDeps,
): Promise<Result<ImportedCounts>> {
	const written: string[] = [];
	if (plan.secretMoves.length > 0) {
		const moved = await deps.conductorImport.moveSecrets(deps.copyPath, plan.secretMoves);
		if (!moved.ok) return err(moved.error);
		written.push(...moved.value);
	}
	/** Files and folders the import made, in the order it made them. */
	const files: string[] = [];
	const undo = async (cause: { code: string; message: string }): Promise<Result<never>> => {
		const failures: string[] = [];
		for (const path of [...files].reverse()) {
			const trashed = await deps.fs.trash(path);
			if (!trashed.ok) failures.push(path);
		}
		for (const key of written) {
			const deleted = await deps.keychain.delete(key);
			if (!deleted.ok) failures.push(`Keychain item ${key}`);
		}
		const message =
			failures.length === 0
				? `The import stopped and Conducted is as it was: ${cause.message}`
				: `The import stopped: ${cause.message} These could not be removed: ${failures.join(", ")}.`;
		return err(appError(IMPORT_FAILED, message, cause));
	};
	for (const file of plan.files) {
		if (await deps.fs.exists(file.path)) {
			return undo(appError("import_changed", `${file.path} appeared since the dry run.`));
		}
		const folder = file.path.slice(0, file.path.lastIndexOf("/"));
		if (!(await deps.fs.exists(folder))) {
			const madeFolder = await deps.fs.mkdirp(folder);
			if (!madeFolder.ok) return undo(madeFolder.error);
			files.push(folder);
		}
		const made = await deps.writeSettingsFile(file);
		// A write that failed after the file appeared still leaves a file to take back.
		if (await deps.fs.exists(file.path)) files.push(file.path);
		if (!made.ok) return undo(made.error);
	}
	const stored = await deps.withPorts(plan.rows.workspaces.length, (ports) =>
		inTransaction(deps.db, "Writing the import", async (tx) => {
			const rows = await writeRows(tx, plan.rows, ports, deps.now);
			if (!rows.ok) return rows;
			return checkRows(tx, deps.repositoriesOn(tx), plan.rows, ports);
		}),
	);
	if (!stored.ok) return undo(stored.error);
	return ok({
		repos: plan.rows.repos.length,
		workspaces: plan.rows.workspaces.length,
		chats: plan.rows.sessions.length,
		reviewComments: plan.rows.diffComments.length,
		sections: plan.rows.sections.length,
		favoriteModels: plan.rows.favoriteModels.length,
		settings: plan.rows.settings.length,
		environmentVariables: plan.rows.envVars.length,
		files: files.length,
	});
}

async function run(
	tx: Database,
	sql: string,
	params: Result<readonly unknown[]> | readonly unknown[],
	what: string,
): Promise<Result<number>> {
	const values = "ok" in params ? params : ok(params);
	if (!values.ok) return values;
	return executeStatement(tx, sql, values.value, what);
}

async function writeRows(
	tx: Database,
	rows: ImportRows,
	ports: readonly number[],
	now: number,
): Promise<Result<void>> {
	const steps: (() => Promise<Result<number>>)[] = [
		...rows.repos.map(
			(repo) => () => run(tx, REPOS_SQL.insert, repoToParams(repo), `Adding ${repo.name}`),
		),
		...rows.workspaces.map(
			(workspace, index) => () =>
				run(
					tx,
					WORKSPACES_SQL.insert,
					workspaceToParams({ ...workspace, port: ports[index] ?? 0 }),
					`Adding the workspace ${workspace.directoryName}`,
				),
		),
		...rows.sessions.map(
			(session) => () => run(tx, SESSIONS_SQL.insert, sessionToParams(session), "Adding a chat"),
		),
		...rows.activeSessions.map(
			(active) => () =>
				run(
					tx,
					WORKSPACES_SQL.setActiveSession,
					[active.sessionId, active.workspaceId],
					"Setting a workspace's open chat",
				),
		),
		...rows.diffComments.map(
			(comment) => () =>
				run(tx, DIFF_COMMENTS_SQL.insert, diffCommentToParams(comment), "Adding a review comment"),
		),
		...rows.sections.flatMap((write) => [
			() =>
				run(
					tx,
					SECTIONS_SQL.insert,
					sectionToParams(write.section, write.createdAt),
					`Adding the section ${write.section.name}`,
				),
			...write.section.workspaceIds.map(
				(workspaceId, position) => () =>
					run(
						tx,
						SECTIONS_SQL.addMember,
						[write.section.id, workspaceId, position],
						`Adding a workspace to ${write.section.name}`,
					),
			),
		]),
		...rows.favoriteModels.map(
			(favorite) => () =>
				run(
					tx,
					FAVORITE_MODELS_SQL.insert,
					favoriteModelToParams(favorite),
					"Adding a favourite model",
				),
		),
		...rows.settings.map(
			(setting) => () =>
				run(
					tx,
					SETTINGS_SQL.insertIfAbsent,
					settingToParams({ key: setting.key, value: setting.value, updatedAt: now }),
					`Saving the setting ${setting.key}`,
				),
		),
		...rows.envVars.map(
			(envVar) => () =>
				run(
					tx,
					ENV_VARS_SQL.upsertInsert,
					envVarToParams(envVar),
					`Adding the variable ${envVar.name}`,
				),
		),
	];
	for (const step of steps) {
		const done = await step();
		if (!done.ok) return done;
		// Each statement adds or changes one row. None means Conducted gained that row since the
		// dry run (a setting or a variable the user just set), and the import never replaces it.
		if (done.value !== 1) {
			return err(
				appError(
					"import_changed",
					"Conducted changed since the dry run, so the import stopped before replacing anything. Run the dry run again.",
				),
			);
		}
	}
	return ok(undefined);
}

const idList = (ids: readonly string[]): string => JSON.stringify(ids);

/** Counts what was written, by id, and reads one sample of each kind back. */
async function checkRows(
	tx: Database,
	repositories: Repositories,
	rows: ImportRows,
	ports: readonly number[],
): Promise<Result<void>> {
	const counted: [string, string, readonly string[]][] = [
		[
			"repos",
			"SELECT COUNT(*) AS n FROM repos WHERE id IN (SELECT value FROM json_each($1))",
			rows.repos.map((row) => row.id),
		],
		[
			"workspaces",
			"SELECT COUNT(*) AS n FROM workspaces WHERE id IN (SELECT value FROM json_each($1))",
			rows.workspaces.map((row) => row.id),
		],
		[
			"chats",
			"SELECT COUNT(*) AS n FROM sessions WHERE id IN (SELECT value FROM json_each($1))",
			rows.sessions.map((row) => row.id),
		],
		[
			"review comments",
			"SELECT COUNT(*) AS n FROM diff_comments WHERE id IN (SELECT value FROM json_each($1))",
			rows.diffComments.map((row) => row.id),
		],
		[
			"sections",
			"SELECT COUNT(*) AS n FROM sections WHERE id IN (SELECT value FROM json_each($1))",
			rows.sections.map((row) => row.section.id),
		],
		[
			"section members",
			"SELECT COUNT(*) AS n FROM section_members WHERE section_id || ' ' || workspace_id IN (SELECT value FROM json_each($1))",
			rows.sections.flatMap((row) =>
				row.section.workspaceIds.map((id) => `${row.section.id} ${id}`),
			),
		],
		[
			"favourite models",
			"SELECT COUNT(*) AS n FROM favorite_models WHERE id IN (SELECT value FROM json_each($1))",
			rows.favoriteModels.map((row) => row.id),
		],
		[
			"settings",
			"SELECT COUNT(*) AS n FROM settings WHERE key IN (SELECT value FROM json_each($1))",
			rows.settings.map((row) => row.key),
		],
		[
			"environment variables",
			"SELECT COUNT(*) AS n FROM env_vars WHERE scope = 'global' AND name IN (SELECT value FROM json_each($1))",
			rows.envVars.map((row) => row.name),
		],
	];
	for (const [what, sql, ids] of counted) {
		if (ids.length === 0) continue;
		const found = await selectRows<{ n: number }>(tx, sql, [idList(ids)], `Counting the ${what}`);
		if (!found.ok) return found;
		const count = Number(found.value[0]?.n ?? -1);
		if (count !== ids.length) {
			return err(
				appError(
					"import_count_mismatch",
					`${ids.length} ${what} were to be written, but ${count} are there. Conducted changed since the dry run, or a write was lost; run the dry run again.`,
				),
			);
		}
	}
	return checkSamples(repositories, rows, ports);
}

/** JSON with sorted keys, so two equal rows compare equal whatever order their fields are in. */
function stable(value: unknown): string {
	return JSON.stringify(value, (_key, inner: unknown) =>
		inner !== null && typeof inner === "object" && !Array.isArray(inner)
			? Object.fromEntries(
					Object.entries(inner as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
				)
			: inner,
	);
}

async function checkSamples(
	repositories: Repositories,
	rows: ImportRows,
	ports: readonly number[],
): Promise<Result<void>> {
	const mismatch = (what: string): Result<never> =>
		err(appError("import_sample_mismatch", `The ${what} read back differs from what was written.`));
	const repo = rows.repos[0];
	if (repo !== undefined) {
		const read = await repositories.repos.get(repo.id);
		if (!read.ok) return read;
		if (stable(read.value) !== stable(repo)) return mismatch("project");
	}
	const workspace = rows.workspaces[0];
	if (workspace !== undefined) {
		const read = await repositories.workspaces.get(workspace.id);
		if (!read.ok) return read;
		const active = rows.activeSessions.find((entry) => entry.workspaceId === workspace.id);
		const { setupLogPath: _setupLogPath, ...model } = workspace;
		// An imported workspace is on this Mac, so it has no mirror and its Sync files switch is
		// stored off (migration 0019), as Conductor stores it for one.
		const expected = {
			...model,
			port: ports[0],
			activeSessionId: active?.sessionId ?? null,
			remoteFileSyncEnabled: false,
		};
		if (stable(read.value) !== stable(expected)) return mismatch("workspace");
	}
	const session = rows.sessions[0];
	if (session !== undefined) {
		const read = await repositories.sessions.get(session.id);
		if (!read.ok) return read;
		if (stable(read.value) !== stable(session)) return mismatch("chat");
	}
	const comment = rows.diffComments[0];
	if (comment !== undefined) {
		const read = await repositories.diffComments.get(comment.id);
		if (!read.ok) return read;
		if (stable(read.value) !== stable(comment)) return mismatch("review comment");
	}
	const section = rows.sections[0];
	if (section !== undefined) {
		const listed = await repositories.sections.list();
		if (!listed.ok) return listed;
		const read = listed.value.find((found) => found.id === section.section.id);
		if (stable(read) !== stable(section.section)) return mismatch("section");
	}
	const favorite = rows.favoriteModels[0];
	if (favorite !== undefined) {
		const listed = await repositories.favoriteModels.list();
		if (!listed.ok) return listed;
		const read = listed.value.find((found) => found.id === favorite.id);
		if (stable(read) !== stable(favorite)) return mismatch("favourite model");
	}
	const setting = rows.settings[0];
	if (setting !== undefined) {
		const listed = await repositories.settings.list();
		if (!listed.ok) return listed;
		const read = listed.value.find((found) => found.key === setting.key);
		if (stable(read?.value) !== stable(setting.value)) return mismatch("setting");
	}
	const envVar = rows.envVars[0];
	if (envVar !== undefined) {
		const listed = await repositories.envVars.listGlobal();
		if (!listed.ok) return listed;
		const read = listed.value.find((found) => found.name === envVar.name);
		if (stable(read) !== stable(envVar)) return mismatch("environment variable");
	}
	return ok(undefined);
}
