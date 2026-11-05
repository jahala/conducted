/**
 * @feature RUN-01 Run actions with start and stop, concurrent or exclusive
 * Owns: the named actions of a repository (dev server, tests), starting and stopping them in a
 * terminal, the run state the Scripts panel shows, and finding the page URL in their output.
 * Behaviour: services-map.md 5A.1.3 (action process store: states, start attempts, kill with a
 * watchdog), 5A.1.4 (run mode), 5A.1.5 (run history), 5A.1.6 (user-defined actions, default
 * action), ui-map.md 3.7 (Run tab: Run, Stop, Starting, Stopping).
 * Must handle: starting an action stops the workspace's running one first (one process per
 * workspace); run mode "exclusive" also stops running actions of other workspaces of the same
 * repository; a start request while setup is still running waits for setup, then starts; every
 * async step checks its start attempt number and gives up if a newer start or a stop happened
 * (only the newest attempt changes state); stop sends terminate, and if no exit arrives within 20
 * seconds the run is settled as "stop not confirmed" and the user is told; quitting the app kills
 * all runs; "run after setup" starts the default action when setup succeeded; run output is
 * not saved to disk; only the last 20 action ids per workspace are remembered.
 * Our design choice: the terminal service owns the process; this service owns the rules around
 * it. Run history is kept in memory plus the `settings` table is not used for it.
 * Our design choice: setup runs with no `userEnv` for now. SET-04 owns the settings and Keychain
 * variables; until that service is wired here, no extra variables are passed rather than a
 * made-up set.
 * Built now: `runSetup` and `stopAll` for the setup terminal (WS-03), and `runArchive` (WS-05),
 * which runs the repository's archive script once through the shell before the worktree is
 * removed. Everything else above is RUN-01 and still a placeholder.
 * Test first: starting an action while another runs in the same workspace stops the first.
 */
import {
	appError,
	err,
	notImplemented,
	ok,
	type Result,
	type TerminalId,
	type WorkspaceId,
} from "@conducted/shared";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { FileSystem, Platform } from "../../platform/platform.ts";
import type { RunState } from "../api.ts";
import { setupLogFile } from "../app-paths.ts";
import type { Repo, RepoConfig, SetupView, Workspace } from "../model.ts";
import { buildScriptEnv, type TerminalsService } from "./terminals.ts";

/** Milliseconds a stop request waits for the process to exit before it reports "not confirmed". */
export const STOP_WATCHDOG_MS = 20_000;
export const RUN_HISTORY_LIMIT = 20;

const LOCAL_URL = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::\])(?::\d+)?[^\s"'<>)]*/g;

/**
 * Finds the last local URL in the tail of a process's output. `0.0.0.0` and `[::]` are shown as
 * `localhost`, since a browser cannot open them.
 */
export function detectLocalUrl(outputTail: string): string | null {
	const matches = outputTail.match(LOCAL_URL);
	const last = matches?.at(-1);
	if (last === undefined) return null;
	return last.replace("//0.0.0.0", "//localhost").replace("//[::]", "//localhost");
}

/** Keeps the newest ids first, without duplicates, at most `RUN_HISTORY_LIMIT`. */
export function recordRunInHistory(history: readonly string[], actionId: string): string[] {
	return [actionId, ...history.filter((id) => id !== actionId)].slice(0, RUN_HISTORY_LIMIT);
}

export type StartPhase = "starting" | "waiting_for_setup" | "running" | "stopping" | "stopped";

export interface RunScriptsState {
	byWorkspace: Readonly<Record<string, RunState>>;
	phases: Readonly<Record<string, StartPhase>>;
	history: Readonly<Record<string, readonly string[]>>;
}

/** The most output lines kept in a setup log. */
export const SETUP_LOG_LINES = 20_000;

/** What one setup run leaves behind for the Setup tab. */
export interface SetupRunResult {
	/** False when the repository has no setup script, so nothing ran. */
	scriptFound: boolean;
	exitCode: number | null;
	terminalId: TerminalId | null;
	logPath: string | null;
	log: SetupView["log"];
}

export interface RunScriptsServiceDeps {
	terminals: Pick<TerminalsService, "runScript" | "close" | "stop" | "outputFor">;
	/** Config of the repository a workspace belongs to. */
	configFor: (workspaceId: WorkspaceId) => Promise<Result<RepoConfig>>;
	/** The workspace and its project, for the folder and the script variables. */
	workspaceFor: (workspaceId: WorkspaceId) => Promise<Result<Workspace>>;
	repoFor: (workspaceId: WorkspaceId) => Promise<Result<Repo>>;
	fs: Pick<FileSystem, "writeTextAtomic" | "mkdirp"> & { paths: FileSystem["paths"] };
	/**
	 * Runs the archive script, a one-shot shell command. The composition root supplies it; a test
	 * of the setup path may leave it out, and archive then reports that it cannot run.
	 */
	shell?: Pick<Platform["shell"], "run">;
}

export class RunScriptsService {
	readonly store: StoreApi<RunScriptsState>;
	readonly #deps: RunScriptsServiceDeps;
	readonly #running = new Map<WorkspaceId, Promise<Result<SetupRunResult>>>();
	readonly #lastTerminal = new Map<WorkspaceId, TerminalId>();

	constructor(deps: RunScriptsServiceDeps) {
		this.#deps = deps;
		this.store = createStore<RunScriptsState>(() => ({ byWorkspace: {}, phases: {}, history: {} }));
	}

	/** Backs `Actions.run.start`. */
	start(_workspaceId: WorkspaceId, _actionId: string): Promise<Result<void>> {
		void this.#deps;
		return notImplemented("RUN-01");
	}

	/** Backs `Actions.run.stop`. */
	stop(_workspaceId: WorkspaceId, _actionId: string): Promise<Result<void>> {
		return notImplemented("RUN-01");
	}

	/**
	 * Runs the repo's setup script in a terminal of kind "setup". Backs the workspace service.
	 * `onStarted` fires once the terminal exists, so the Setup tab can show its live output before
	 * the script ends.
	 */
	runSetup(
		workspaceId: WorkspaceId,
		onStarted?: (terminalId: TerminalId) => void,
	): Promise<Result<SetupRunResult>> {
		const existing = this.#running.get(workspaceId);
		if (existing !== undefined) return existing;
		const run = this.#runSetup(workspaceId, onStarted).finally(() => {
			this.#running.delete(workspaceId);
		});
		this.#running.set(workspaceId, run);
		return run;
	}

	async #runSetup(
		workspaceId: WorkspaceId,
		onStarted?: (terminalId: TerminalId) => void,
	): Promise<Result<SetupRunResult>> {
		const config = await this.#deps.configFor(workspaceId);
		if (!config.ok) return config;
		const script = config.value.setupScript?.trim() ?? "";
		if (script === "") {
			return ok({
				scriptFound: false,
				exitCode: null,
				terminalId: null,
				logPath: null,
				log: "missing",
			});
		}

		const workspace = await this.#deps.workspaceFor(workspaceId);
		if (!workspace.ok) return workspace;
		const repo = await this.#deps.repoFor(workspaceId);
		if (!repo.ok) return repo;

		const old = this.#lastTerminal.get(workspaceId);
		if (old !== undefined) {
			await this.#deps.terminals.close(old);
			this.#lastTerminal.delete(workspaceId);
		}

		const env = buildScriptEnv({
			workspace: workspace.value,
			repoRootPath: repo.value.rootPath,
			defaultBranch: repo.value.defaultBranch,
			userEnv: {},
		});
		const started = await this.#deps.terminals.runScript({
			workspaceId,
			kind: "setup",
			title: "Setup",
			command: script,
			cwd: workspace.value.path,
			env,
		});
		if (!started.ok) return started;
		this.#lastTerminal.set(workspaceId, started.value.terminalId);
		onStarted?.(started.value.terminalId);

		const exitCode = await started.value.exit;
		const logPath = setupLogFile(this.#deps.fs.paths, workspaceId);
		const made = await this.#deps.fs.mkdirp(logPath.slice(0, logPath.lastIndexOf("/")));
		const transcript = made.ok
			? await this.#deps.terminals.outputFor(
					workspaceId,
					"auto",
					SETUP_LOG_LINES,
					started.value.terminalId,
				)
			: made;
		const wrote = transcript.ok
			? await this.#deps.fs.writeTextAtomic(logPath, transcript.value.output)
			: err(transcript.error);
		return ok({
			scriptFound: true,
			exitCode,
			terminalId: started.value.terminalId,
			logPath: wrote.ok ? logPath : null,
			log: wrote.ok ? "saved" : "missing",
		});
	}

	/** Runs the repo's archive script before a workspace is archived (services-map 3.10). */
	async runArchive(workspaceId: WorkspaceId): Promise<Result<void>> {
		const config = await this.#deps.configFor(workspaceId);
		if (!config.ok) return config;
		const script = config.value.archiveScript?.trim() ?? "";
		if (script === "") return ok(undefined);

		const workspace = await this.#deps.workspaceFor(workspaceId);
		if (!workspace.ok) return workspace;
		const repo = await this.#deps.repoFor(workspaceId);
		if (!repo.ok) return repo;
		if (this.#deps.shell === undefined) {
			return err(
				appError(
					"archive_script_failed",
					"The archive script cannot run because the shell was not provided.",
				),
			);
		}

		const env = buildScriptEnv({
			workspace: workspace.value,
			repoRootPath: repo.value.rootPath,
			defaultBranch: repo.value.defaultBranch,
			userEnv: {},
		});
		const result = await this.#deps.shell.run({
			program: "zsh",
			args: ["-lc", script],
			cwd: workspace.value.path,
			env,
		});
		if (!result.ok) return result;
		if (result.value.exitCode !== 0) {
			return err(
				appError(
					"archive_script_failed",
					`The archive script failed: ${result.value.stderr.trim() || `exit code ${result.value.exitCode}`}`,
				),
			);
		}
		return ok(undefined);
	}

	/** Stops the setup, run and Spotlight terminals of one workspace. */
	stopWorkspace(_workspaceId: WorkspaceId): Promise<Result<void>> {
		return notImplemented("RUN-01");
	}

	/** Called when a workspace leaves setup: starts the default action if the repo asks for it. */
	onSetupFinished(_workspaceId: WorkspaceId, _setupSucceeded: boolean): Promise<Result<void>> {
		return notImplemented("RUN-01");
	}

	/** Stops everything of one repository. Used when the repository is removed. */
	stopAllForRepository(_workspaceIds: readonly WorkspaceId[]): Promise<Result<void>> {
		return notImplemented("RUN-01");
	}

	/**
	 * Closes the terminals this service started. Setup is the only script it runs so far, so those
	 * are the only ones to close. The container calls this when the app stops.
	 */
	async stopAll(): Promise<Result<void>> {
		const terminalIds = [...this.#lastTerminal.values()];
		this.#lastTerminal.clear();
		const closed = await Promise.all(terminalIds.map((id) => this.#deps.terminals.close(id)));
		for (const result of closed) {
			if (!result.ok) return result;
		}
		return ok(undefined);
	}

	/** Backs `Actions.run.activateApp`. */
	activateApp(_workspaceId: WorkspaceId, _port: number): Promise<Result<void>> {
		return notImplemented("RUN-03");
	}
}
