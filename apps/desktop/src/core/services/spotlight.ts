/**
 * @feature RUN-02 Spotlight: test workspace changes in the repo root, restore on stop
 * Owns: starting and stopping Spotlight for a workspace: save the repository root, run the sync
 * loop, restore the root when it stops, and repair after a crash.
 * Behaviour: services-map.md 5A.2 (gating, start sequence, the sync loop, stop and restore, state
 * fields), 3.12.3 (pre-spotlight checkpoint), ui-map.md 3.7 (Use spotlight testing, Start
 * spotlight).
 * Must handle: only when the repository setting is on; the root must not be in the middle of a
 * merge or rebase and must be on a branch (clear error text that says what to run); a leftover
 * `pre-spotlight` checkpoint from a crash is restored and removed before a new start; starting
 * Spotlight stops any other Spotlight (one root, one workspace at a time) and the workspace's run
 * actions; the sync loop is `bin/spotlighter.sh` in a terminal of kind "spotlight"; stopping
 * restores the root, and a failed restore keeps the checkpoint so the next start can heal it;
 * quitting the app does not restore (the next start does); the root's branch pointer moves while
 * Spotlight runs, because the sync loop resets the root to the workspace's commit.
 * Built now: preflight, start, stop and `healAfterCrash`. App start runs `healAfterCrash` for every
 * project (services-map 5A.2.2 step 1 and 5A.2.5): with no `pre-spotlight` ref it changes nothing;
 * otherwise it restores the root from the ref under the root's worktree lock and then deletes the
 * ref. A failed restore keeps the ref and returns an error. Starting heals a leftover checkpoint,
 * checks the root, saves a new checkpoint and runs the sync loop. Stopping kills the sync, waits
 * for the terminal service's 20 second watchdog, then restores the root and removes the sync loop's
 * `cp-spotlight-*` checkpoints.
 * Our design choice: the saved id and the helper scripts come from core/git/refs.ts and
 * core/app-paths.ts, so bin/ and the UI agree. File watching is done by the script, not the UI.
 * Watchexec comes from the PATH until PLAT-35 installs a managed copy.
 * Test first: starting with a leftover pre-spotlight checkpoint restores it before saving a new one.
 */
import {
	appError,
	err,
	ok,
	type RepoId,
	type Result,
	type TerminalId,
	type WorkspaceId,
} from "@conducted/shared";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { RunState } from "../api.ts";
import { createKeyedQueue } from "../async/serial-queue.ts";
import type { GitCommand } from "../git/commands.ts";
import {
	branchShowCurrent,
	checkpointerRestore,
	checkpointerSave,
	forEachRefNames,
	showRefVerify,
	updateRefDelete,
} from "../git/commands.ts";
import { CHECKPOINT_REF_PREFIX, checkpointRef, PRE_SPOTLIGHT_CHECKPOINT_ID } from "../git/refs.ts";
import type { GitRunner } from "../git/runner.ts";
import type { Repo, RepoConfig, Terminal, Workspace } from "../model.ts";
import { quoteShellArg } from "./run-scripts.ts";
import type { TerminalsService } from "./terminals.ts";

export interface SpotlightState {
	/** The workspace whose changes are mirrored into its repository root, if any. */
	active: Readonly<Record<string, RunState["spotlight"]>>;
}

export interface SpotlightPreflight {
	ok: boolean;
	/** Plain-language reason, with the command the user can run, when `ok` is false. */
	problem: string | null;
}

/** Shown when the repository root could not be put back as it was before Spotlight started. */
const SPOTLIGHT_RESTORE_FAILED_MESSAGE =
	"Couldn't put the repository back as it was before Spotlight started. The saved state is kept, so the next start tries again.";

/** Shown when the root could not be saved before the sync loop starts. */
const SPOTLIGHT_SAVE_FAILED_MESSAGE =
	"Couldn't save the repository root before Spotlight started. Finish or abort any merge in the root, then try again.";

const SPOTLIGHT_ROOT_BRANCH_MESSAGE =
	"The repository root is not on a branch. Check out a branch in the root repository, then try again.";

/** Ids the sync loop saves in the workspace. They are removed when Spotlight stops. */
const SPOTLIGHT_SYNC_CHECKPOINT_PREFIX = "cp-spotlight-";

const SPOTLIGHT_BUSY_MESSAGES: Readonly<Record<string, string>> = {
	"busy:rebase":
		"The repository root is in the middle of a rebase. Run `git rebase --abort` in the root repository, then try again.",
	"busy:merge":
		"The repository root is in the middle of a merge. Run `git merge --abort` in the root repository, then try again.",
	"busy:squash-merge":
		"The repository root has an unfinished squash merge. Finish it or run `git reset --merge` in the root repository, then try again.",
	"busy:cherry-pick":
		"The repository root is in the middle of a cherry-pick. Run `git cherry-pick --abort` in the root repository, then try again.",
	"busy:revert":
		"The repository root is in the middle of a revert. Run `git revert --abort` in the root repository, then try again.",
};

export interface SpotlightServiceDeps {
	git: GitRunner;
	terminals: Pick<TerminalsService, "runScript" | "stop">;
	checkpointerPath: string;
	spotlighterPath: string;
	/** bin/git-busy-check.sh, which says whether a merge or rebase is in progress. */
	busyCheckPath?: string;
	/** The watcher the sync loop runs. "watchexec" means the copy on the user's PATH. */
	watchexecPath?: string;
	configFor?: (workspaceId: WorkspaceId) => Promise<Result<RepoConfig>>;
	workspaceFor?: (workspaceId: WorkspaceId) => Promise<Result<Workspace>>;
	repoFor?: (workspaceId: WorkspaceId) => Promise<Result<Repo>>;
	/** Stops the workspace's run actions before Spotlight starts, since Spotlight is exclusive. */
	stopRuns?: (workspaceId: WorkspaceId) => Promise<Result<void>>;
	/** Copies research 5A.2.2: starting Spotlight also opens the repository terminal. */
	openRepoTerminal?: (repoId: RepoId) => Promise<Result<Terminal>>;
	/** Receives a failed repository terminal open, so it is not silent. */
	log?: (level: "warn" | "info", message: string) => void;
}

const busyCheckCommand = (script: string, rootPath: string): GitCommand => ({
	program: script,
	args: [rootPath],
	retryOnLock: false,
});

export class SpotlightService {
	readonly store: StoreApi<SpotlightState>;
	readonly #deps: SpotlightServiceDeps;
	/** Start and stop for one workspace run one after the other, so a stop never races a start. */
	readonly #operations = createKeyedQueue<WorkspaceId>();
	/** The repository root each active Spotlight mirrors into. */
	readonly #roots = new Map<WorkspaceId, string>();

	constructor(deps: SpotlightServiceDeps) {
		this.#deps = deps;
		this.store = createStore<SpotlightState>(() => ({ active: {} }));
	}

	/** Checks the root repository: no merge or rebase in progress and a branch is checked out. */
	async preflight(repoRootPath: string): Promise<Result<SpotlightPreflight>> {
		const { git, busyCheckPath } = this.#deps;
		if (busyCheckPath === undefined) {
			return err(
				appError(
					"spotlight_unavailable",
					"Spotlight can't check the repository root because the git busy check script is missing.",
				),
			);
		}
		const busy = await git.runChecked(busyCheckCommand(busyCheckPath, repoRootPath), {
			cwd: repoRootPath,
		});
		if (!busy.ok) return busy;
		const state = busy.value.stdout.trim();
		if (state !== "clean") {
			const problem =
				SPOTLIGHT_BUSY_MESSAGES[state] ??
				"The repository root has an unfinished git operation. Finish or abort it in the root repository, then try again.";
			return ok({ ok: false, problem });
		}
		const branch = await git.stdout(branchShowCurrent(), { cwd: repoRootPath });
		if (!branch.ok) return branch;
		if (branch.value === "") return ok({ ok: false, problem: SPOTLIGHT_ROOT_BRANCH_MESSAGE });
		return ok({ ok: true, problem: null });
	}

	/** Backs `Actions.run.startSpotlight`. */
	start(workspaceId: WorkspaceId): Promise<Result<void>> {
		return this.#operations.run(workspaceId, () => this.#start(workspaceId));
	}

	/** Backs `Actions.run.stopSpotlight`. */
	stop(workspaceId: WorkspaceId): Promise<Result<void>> {
		return this.#operations.run(workspaceId, () => this.#stopWorkspace(workspaceId));
	}

	/**
	 * Restores a leftover pre-spotlight checkpoint of a repository, if one exists, and then removes
	 * it. The value says whether there was one to restore. A failed restore keeps the checkpoint,
	 * so the next start tries again.
	 */
	async healAfterCrash(repoRootPath: string): Promise<Result<boolean>> {
		const { git, checkpointerPath } = this.#deps;
		const cwd = repoRootPath;
		const ref = checkpointRef(PRE_SPOTLIGHT_CHECKPOINT_ID);
		const found = await git.runChecked(showRefVerify(ref), { cwd });
		if (!found.ok) return found;
		if (found.value.exitCode !== 0) return ok(false);

		const restored = await git.withWorktreeLock(cwd, () =>
			git.runChecked(checkpointerRestore(checkpointerPath, PRE_SPOTLIGHT_CHECKPOINT_ID), { cwd }),
		);
		if (!restored.ok) {
			return err(
				appError("spotlight_restore_failed", SPOTLIGHT_RESTORE_FAILED_MESSAGE, restored.error),
			);
		}
		const deleted = await git.runChecked(updateRefDelete(ref), { cwd });
		return deleted.ok ? ok(true) : deleted;
	}

	async #start(workspaceId: WorkspaceId): Promise<Result<void>> {
		const { terminals, checkpointerPath, spotlighterPath, watchexecPath } = this.#deps;
		const config = await this.#configFor(workspaceId);
		if (!config.ok) return config;
		if (!config.value.spotlightTesting) {
			return err(
				appError(
					"spotlight_disabled",
					'Spotlight testing is off for this repository. Turn on "Use Spotlight testing" in its Actions settings to start it.',
				),
			);
		}
		const workspace = await this.#workspaceFor(workspaceId);
		if (!workspace.ok) return workspace;
		if (workspace.value.state === "archived" || workspace.value.state === "archiving") {
			return err(appError("workspace_not_ready", "That workspace is archived."));
		}
		const repo = await this.#repoFor(workspaceId);
		if (!repo.ok) return repo;
		if (watchexecPath === undefined) {
			return err(
				appError(
					"spotlight_unavailable",
					"Spotlight can't start because the watchexec program is not available.",
				),
			);
		}

		const stoppedRuns = await this.#stopRuns(workspaceId);
		if (!stoppedRuns.ok) return stoppedRuns;

		// One repository root has one Spotlight. Starting one stops every other one first.
		for (const [id, state] of Object.entries(this.store.getState().active)) {
			if (id === workspaceId || !state.active) continue;
			const stopped = await this.#stopWorkspace(id as WorkspaceId);
			if (!stopped.ok) return stopped;
		}
		const stoppedHere = await this.#stopWorkspace(workspaceId);
		if (!stoppedHere.ok) return stoppedHere;

		const rootPath = repo.value.rootPath;
		const healed = await this.healAfterCrash(rootPath);
		if (!healed.ok) return healed;
		const preflight = await this.preflight(rootPath);
		if (!preflight.ok) return preflight;
		if (!preflight.value.ok) {
			return err(
				appError(
					"spotlight_preflight_failed",
					preflight.value.problem ?? "The repository root is not ready for Spotlight.",
				),
			);
		}

		const saved = await this.#savePreSpotlight(rootPath);
		if (!saved.ok) return saved;

		const started = await terminals.runScript({
			workspaceId,
			kind: "spotlight",
			title: "Spotlight",
			command: `bash ${quoteShellArg(spotlighterPath)}`,
			cwd: workspace.value.path,
			env: {
				CONDUCTED_ROOT_PATH: rootPath,
				CONDUCTED_CHECKPOINTER_PATH: checkpointerPath,
				CONDUCTED_WATCHEXEC_PATH: watchexecPath,
			},
		});
		if (!started.ok) {
			await this.#deletePreSpotlight(rootPath);
			return started;
		}

		this.#roots.set(workspaceId, rootPath);
		this.#setActive(workspaceId, started.value.terminalId);
		void started.value.exit.then(
			() => this.#deactivate(workspaceId, started.value.terminalId),
			() => this.#deactivate(workspaceId, started.value.terminalId),
		);

		const openRepoTerminal = this.#deps.openRepoTerminal;
		if (openRepoTerminal !== undefined) {
			const opened = await openRepoTerminal(repo.value.id);
			if (!opened.ok) {
				this.#deps.log?.(
					"warn",
					`Couldn't open the repository terminal for Spotlight: ${opened.error.message}`,
				);
			}
		}
		return ok(undefined);
	}

	async #stopWorkspace(workspaceId: WorkspaceId): Promise<Result<void>> {
		const current = this.store.getState().active[workspaceId];
		if (current?.active !== true) return ok(undefined);

		const terminalId = current.terminalId;
		const rootPath = this.#roots.get(workspaceId);
		const stopped =
			terminalId === null ? ok(undefined) : await this.#deps.terminals.stop(terminalId);
		const restored =
			rootPath === undefined
				? err(
						appError("spotlight_unknown", "Spotlight's saved repository state could not be found."),
					)
				: await this.healAfterCrash(rootPath);
		const syncDeleted =
			rootPath === undefined ? ok(undefined) : await this.#deleteSyncCheckpoints(rootPath);

		this.#roots.delete(workspaceId);
		this.#deactivate(workspaceId, terminalId);
		if (!restored.ok) return restored;
		if (!syncDeleted.ok) return syncDeleted;
		return stopped;
	}

	async #savePreSpotlight(rootPath: string): Promise<Result<void>> {
		const { git, checkpointerPath } = this.#deps;
		const saved = await git.withWorktreeLock(rootPath, () =>
			git.runChecked(checkpointerSave(checkpointerPath, PRE_SPOTLIGHT_CHECKPOINT_ID), {
				cwd: rootPath,
			}),
		);
		if (!saved.ok) {
			return err(appError("spotlight_save_failed", SPOTLIGHT_SAVE_FAILED_MESSAGE, saved.error));
		}
		if (saved.value.exitCode !== 0) {
			return err(appError("spotlight_save_failed", SPOTLIGHT_SAVE_FAILED_MESSAGE));
		}
		return ok(undefined);
	}

	async #deletePreSpotlight(rootPath: string): Promise<void> {
		const deleted = await this.#deps.git.runChecked(
			updateRefDelete(checkpointRef(PRE_SPOTLIGHT_CHECKPOINT_ID)),
			{ cwd: rootPath },
		);
		if (!deleted.ok) {
			this.#deps.log?.(
				"warn",
				`Couldn't remove the pre-spotlight checkpoint after Spotlight failed to start: ${deleted.error.message}`,
			);
		}
	}

	async #deleteSyncCheckpoints(rootPath: string): Promise<Result<void>> {
		const { git } = this.#deps;
		const listed = await git.stdout(forEachRefNames(CHECKPOINT_REF_PREFIX), { cwd: rootPath });
		if (!listed.ok) return listed;
		const prefix = `${CHECKPOINT_REF_PREFIX}${SPOTLIGHT_SYNC_CHECKPOINT_PREFIX}`;
		let failure: Result<void> | null = null;
		for (const ref of listed.value.split("\n")) {
			if (!ref.startsWith(prefix)) continue;
			const deleted = await git.runChecked(updateRefDelete(ref), { cwd: rootPath });
			if (!deleted.ok && failure === null) failure = deleted;
		}
		return failure ?? ok(undefined);
	}

	async #configFor(workspaceId: WorkspaceId): Promise<Result<RepoConfig>> {
		if (this.#deps.configFor === undefined) {
			return err(
				appError("spotlight_unavailable", "Spotlight can't start without the repository settings."),
			);
		}
		return this.#deps.configFor(workspaceId);
	}

	async #workspaceFor(workspaceId: WorkspaceId): Promise<Result<Workspace>> {
		if (this.#deps.workspaceFor === undefined) {
			return err(appError("spotlight_unavailable", "Spotlight can't start without the workspace."));
		}
		return this.#deps.workspaceFor(workspaceId);
	}

	async #repoFor(workspaceId: WorkspaceId): Promise<Result<Repo>> {
		if (this.#deps.repoFor === undefined) {
			return err(
				appError("spotlight_unavailable", "Spotlight can't start without the repository."),
			);
		}
		return this.#deps.repoFor(workspaceId);
	}

	async #stopRuns(workspaceId: WorkspaceId): Promise<Result<void>> {
		if (this.#deps.stopRuns === undefined) return ok(undefined);
		return this.#deps.stopRuns(workspaceId);
	}

	#setActive(workspaceId: WorkspaceId, terminalId: TerminalId): void {
		this.store.setState((state) => ({
			...state,
			active: { ...state.active, [workspaceId]: { active: true, terminalId } },
		}));
	}

	#deactivate(workspaceId: WorkspaceId, terminalId: TerminalId | null): void {
		this.store.setState((state) => {
			const current = state.active[workspaceId];
			if (current === undefined) return state;
			if (terminalId !== null && current.terminalId !== terminalId) return state;
			const active = { ...state.active };
			delete active[workspaceId];
			return { ...state, active };
		});
	}
}
