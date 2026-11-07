/**
 * @feature RUN-01 Run actions with start and stop, concurrent or exclusive
 * Owns: the named actions of a repository (dev server, tests), starting and stopping them in a
 * terminal, the run state the Scripts panel shows, and finding the page URL in their output.
 * Behaviour: services-map.md 5A.1.3 (action process store: states, start attempts, kill with a
 * watchdog), 5A.1.4 (run mode, set by "run_script_mode"), 5A.1.5 (run history), 5A.1.6
 * (user-defined actions, default action and quoted args), ui-map.md 3.7 (Run tab: Run, Stop,
 * Starting, Stopping; the shortcut is "workspace.toggleRun"). Auto-run uses the repository
 * setting "auto_run_after_setup". RUN-03: services-map.md 5A.3.2 (listening ports of the
 * workspace's processes, a 10 second timeout) and ui-map.md 3.7 (Ports tab, activating a detected
 * app).
 * Must handle: starting an action stops the workspace's running one first (one process per
 * workspace); run mode "exclusive" also stops running actions of other workspaces of the same
 * repository; a start request while setup is still running waits for setup, then starts; every
 * async step checks its start attempt number and gives up if a newer start or a stop happened
 * (only the newest attempt changes state); stop asks the terminal service for a 20 second
 * watchdog, and a stop that is not confirmed is returned to the caller and kept as the
 * workspace's outcome until the next start; quitting the app closes all runs; "run after setup"
 * starts the default action when setup succeeded; run output is not saved to disk. Run history is
 * the last 20 action ids per workspace, kept in local storage so it survives a restart. Port
 * scanning (RUN-03) starts when a run starts and stops when it ends; an older scan never replaces
 * a newer one; a failed scan is reported to the log; activating a port with no owning macOS app
 * returns an error rather than opening it silently.
 * Our design choice: the terminal service owns the process; this service owns the rules around
 * it. Run history is in local storage, not in the settings table.
 * Setup, archive and run scripts receive the Environment page's variables for the repository
 * (SET-04): the global values, with the repository's own values replacing them. The values come
 * from the Keychain through the composition root, never from a file.
 * All three also receive `CONDUCTED_PATH_PREFIX` (SET-13): the shim folder for the program paths
 * chosen in settings, then the app's bin folder in the data folder, which holds the managed
 * programs (PLAT-28, PLAT-35); the bin folder alone when none are chosen or staging fails. All
 * three start from the login environment of the workspace folder (PLAT-07, services-map.md
 * 5A.8.3): the archive script through `envFromCwd`, setup and run through the terminal service.
 * Built now: `runSetup` and `stopAll` (WS-03 and RUN-01), `runArchive` (WS-05), which runs the
 * repository's archive script once through the shell before the worktree is removed, the run
 * actions above (RUN-01), and the RUN-03 paths: polling the workspace's listening ports into
 * `detectedPorts`, and activating the macOS app that owns a port.
 * Test first: starting an action while another runs in the same workspace stops the first.
 */
import {
	type AppError,
	appError,
	err,
	ok,
	type RepoId,
	type Result,
	type TerminalId,
	type WorkspaceId,
} from "@conducted/shared";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { FileSystem, Platform } from "../../platform/platform.ts";
import type { RunState } from "../api.ts";
import { programsBinDir, setupLogFile } from "../app-paths.ts";
import { createLatestWins } from "../async/latest-wins.ts";
import { createSingleFlight } from "../async/single-flight.ts";
import type { Repo, RepoConfig, RunAction, SetupView, Workspace } from "../model.ts";
import { isArchivedWorkspace } from "../status/archived.ts";
import type { PortService } from "./ports.ts";
import { buildScriptEnv, STOP_WATCHDOG_MS, type TerminalsService } from "./terminals.ts";

export { STOP_WATCHDOG_MS };
export const RUN_HISTORY_LIMIT = 20;
/** How often a workspace's listening ports are read while its run is active. */
export const PORT_POLL_INTERVAL_MS = 5_000;

/** Local storage key prefix for one workspace's run history. */
export const RUN_HISTORY_STORAGE_PREFIX = "conducted.run-history:";

/** The local storage key that holds one workspace's run history. */
export const runHistoryStorageKey = (workspaceId: WorkspaceId): string =>
	`${RUN_HISTORY_STORAGE_PREFIX}${workspaceId}`;

const LOCAL_URL = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::\])(?::\d+)?[^\s"'<>)]*/g;
const VARIABLE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g;

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

/** Quotes one argument so a shell keeps it as a single word. */
export function quoteShellArg(value: string): string {
	if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** The command a run action starts: its command followed by its quoted arguments. */
export function actionCommand(action: Pick<RunAction, "command" | "args">): string {
	return [action.command, ...action.args.map(quoteShellArg)].join(" ").trim();
}

/**
 * The action the Run button starts: the first marked default, else the first. Hidden actions are
 * skipped, so a hidden default does not run by itself.
 */
export function defaultRunAction(actions: readonly RunAction[]): RunAction | null {
	const visible = actions.filter((action) => !action.hidden);
	return visible.find((action) => action.isDefault) ?? visible[0] ?? null;
}

/** Replaces `$NAME` and `${NAME}` in a working folder with the value from the run environment. */
export function expandActionCwd(cwd: string, env: Readonly<Record<string, string>>): string {
	return cwd.replace(VARIABLE, (whole, braced: string | undefined, plain: string | undefined) => {
		const name = braced ?? plain ?? "";
		return env[name] ?? whole;
	});
}

export type StartPhase = "starting" | "waiting_for_setup" | "running" | "stopping" | "stopped";

export interface RunScriptsState {
	byWorkspace: Readonly<Record<string, RunState>>;
	phases: Readonly<Record<string, StartPhase>>;
	history: Readonly<Record<string, readonly string[]>>;
	/** A stop the terminal service could not confirm, kept until the next start. */
	outcomes: Readonly<Record<string, "stop-unconfirmed">>;
	/** The last failed port scan per workspace, for the Ports tab to show. */
	portErrors: Readonly<Record<string, AppError>>;
	/** A saved history that could not be read or written, for the Run tab to show. */
	historyError: AppError | null;
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
	terminals: Pick<TerminalsService, "runScript" | "end" | "stop" | "outputFor">;
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
	/**
	 * RUN-03's port service. The composition root supplies it; a test of another path may leave
	 * it out, and no ports are then listed.
	 */
	ports?: Pick<PortService, "listListening">;
	/** Receives a failed port scan so a detection problem is not silent. */
	log?: (level: "warn" | "info", message: string) => void;
	/**
	 * The Environment page's variables for one repository (SET-04). The composition root supplies
	 * it; a test of another path may leave it out, and no extra variables are then passed.
	 */
	environmentFor?: (repoId: RepoId) => Promise<Result<Record<string, string>>>;
	/**
	 * The folder to put first on PATH (SET-13). The composition root supplies it; a test of
	 * another path may leave it out, and the app's bin folder is then used.
	 */
	pathPrefixFor?: () => Promise<Result<string>>;
}

interface RunProcess {
	actionId: string;
	attempt: number;
	terminalId: TerminalId;
	repoId: string;
	url: string | null;
	exit: Promise<number | null>;
}

interface PendingRun {
	actionId: string;
	attempt: number;
}

/** A start that is waiting for its terminal to open, before it has a process to stop. */
interface LaunchingRun {
	actionId: string;
	attempt: number;
	repoId: string;
}

const emptyRunState = (): RunState => ({
	actions: [],
	running: [],
	spotlight: { active: false, terminalId: null },
	detectedPorts: [],
});

export class RunScriptsService {
	readonly store: StoreApi<RunScriptsState>;
	readonly #deps: RunScriptsServiceDeps;
	readonly #running = createSingleFlight<WorkspaceId>();
	readonly #lastTerminal = new Map<WorkspaceId, TerminalId>();
	/** One run process per workspace, as the action store requires. */
	readonly #processes = new Map<WorkspaceId, RunProcess>();
	/** Start requests parked while the workspace's setup script runs. */
	readonly #pending = new Map<WorkspaceId, PendingRun>();
	/** Starts whose terminal is still opening, so a stop can cancel them before a process exists. */
	readonly #launching = new Map<WorkspaceId, LaunchingRun>();
	/** The newest start attempt for each workspace; an older continuation bails out. */
	readonly #attempts = new Map<WorkspaceId, number>();
	/** One counter for all workspaces, so an attempt number is never reused after a clear. */
	#attemptCounter = 0;
	/** A counter per workspace, for the last started run. */
	readonly #lastRunIds = new Map<WorkspaceId, number>();
	/** The newest port scan per workspace, so an older answer cannot replace it. */
	readonly #portScans = createLatestWins<WorkspaceId>();
	/** The next port scan timer per workspace. */
	readonly #portTimers = new Map<WorkspaceId, ReturnType<typeof setTimeout>>();
	/** The folder whose processes belong to each workspace being scanned. */
	readonly #portPaths = new Map<WorkspaceId, string>();

	constructor(deps: RunScriptsServiceDeps) {
		this.#deps = deps;
		const saved = this.#readSavedHistory();
		this.store = createStore<RunScriptsState>(() => ({
			byWorkspace: {},
			phases: {},
			history: saved.history,
			outcomes: {},
			portErrors: {},
			historyError: saved.error,
		}));
	}

	/** Backs `Actions.run.start`. */
	async start(workspaceId: WorkspaceId, actionId: string): Promise<Result<void>> {
		const attempt = this.#nextAttempt(workspaceId);
		const config = await this.#deps.configFor(workspaceId);
		if (!this.#isCurrent(workspaceId, attempt)) return ok(undefined);
		if (!config.ok) return config;
		const action = config.value.runScripts.find((entry) => entry.id === actionId);
		if (action === undefined) {
			return err(appError("run_action_unknown", "That action no longer exists."));
		}
		if (actionCommand(action) === "") {
			return err(appError("run_action_empty", "That action has no command."));
		}

		const workspace = await this.#deps.workspaceFor(workspaceId);
		if (!this.#isCurrent(workspaceId, attempt)) return ok(undefined);
		if (!workspace.ok) return workspace;
		if (isArchivedWorkspace(workspace.value) || workspace.value.state === "archiving") {
			return err(appError("workspace_not_ready", "That workspace is archived."));
		}
		const repo = await this.#deps.repoFor(workspaceId);
		if (!this.#isCurrent(workspaceId, attempt)) return ok(undefined);
		if (!repo.ok) return repo;

		// A start always stops the workspace's previous action first. A stop that is not
		// confirmed leaves the old process alive, so the new action must not start beside it.
		const stopped = await this.#stopProcess(workspaceId, attempt);
		if (!this.#isCurrent(workspaceId, attempt)) return ok(undefined);
		if (!stopped.ok) return stopped;
		this.#pending.delete(workspaceId);
		this.#clearOutcome(workspaceId);
		this.#setActions(workspaceId, config.value.runScripts);

		if (workspace.value.state === "initializing") {
			this.#pending.set(workspaceId, { actionId, attempt });
			this.#setPhase(workspaceId, attempt, "waiting_for_setup");
			return ok(undefined);
		}

		return this.#launch(workspaceId, attempt, action, config.value, workspace.value, repo.value);
	}

	/** Backs `Actions.run.stop`. */
	async stop(workspaceId: WorkspaceId, actionId: string): Promise<Result<void>> {
		const attempt = this.#nextAttempt(workspaceId);
		const pending = this.#pending.get(workspaceId);
		if (pending !== undefined) {
			this.#pending.delete(workspaceId);
			if (pending.actionId === actionId) {
				this.#setPhase(workspaceId, attempt, "stopped");
				return ok(undefined);
			}
		}
		const launching = this.#launching.get(workspaceId);
		if (launching !== undefined) {
			if (launching.actionId !== actionId) {
				return err(appError("run_not_running", "No process to stop."));
			}
			// The terminal is still opening. Cancelling here makes the opening start bail out,
			// stop its terminal and leave the button on Run instead of Starting forever.
			this.#launching.delete(workspaceId);
			this.#setPhase(workspaceId, attempt, "stopped");
			return ok(undefined);
		}
		const process = this.#processes.get(workspaceId);
		if (process === undefined) {
			return err(appError("run_not_running", "No process to stop."));
		}
		if (process.actionId !== actionId) {
			return err(appError("run_not_running", "No process to stop."));
		}
		return this.#stopProcess(workspaceId, attempt, actionId);
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
		return this.#running.run(workspaceId, () => this.#runSetup(workspaceId, onStarted));
	}

	async #runSetup(
		workspaceId: WorkspaceId,
		onStarted?: (terminalId: TerminalId) => void,
	): Promise<Result<SetupRunResult>> {
		const config = await this.#deps.configFor(workspaceId);
		if (!config.ok) return config;
		const script = config.value.setupScript?.trim() ?? "";
		if (script === "") {
			await this.#afterSetup(workspaceId, true);
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
			await this.#deps.terminals.end(old);
			this.#lastTerminal.delete(workspaceId);
		}

		const userEnv = await this.#userEnv(repo.value.id);
		if (!userEnv.ok) return userEnv;
		const env = buildScriptEnv({
			workspace: workspace.value,
			repoRootPath: repo.value.rootPath,
			defaultBranch: repo.value.defaultBranch,
			userEnv: userEnv.value,
		});
		const prefix = await this.#pathPrefix();
		if (!prefix.ok) return prefix;
		env.CONDUCTED_PATH_PREFIX = prefix.value;
		// A remote host runs the setup script with strict options, as Conductor does; a local script
		// runs as written (services-map.md 5A.1.2).
		const command = workspace.value.host.kind === "cloud" ? `set -euo pipefail\n${script}` : script;
		const started = await this.#deps.terminals.runScript({
			workspaceId,
			kind: "setup",
			title: "Setup",
			command,
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
		await this.#afterSetup(workspaceId, exitCode === 0);
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

		const userEnv = await this.#userEnv(repo.value.id);
		if (!userEnv.ok) return userEnv;
		const env = buildScriptEnv({
			workspace: workspace.value,
			repoRootPath: repo.value.rootPath,
			defaultBranch: repo.value.defaultBranch,
			userEnv: userEnv.value,
		});
		const prefix = await this.#pathPrefix();
		if (!prefix.ok) return prefix;
		env.CONDUCTED_PATH_PREFIX = prefix.value;
		const result = await this.#deps.shell.run({
			program: "zsh",
			args: ["-lc", script],
			cwd: workspace.value.path,
			env,
			// A script runs in its folder's login environment, as Conductor's scripts do (5A.8.3).
			envFromCwd: true,
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
	async stopWorkspace(workspaceId: WorkspaceId): Promise<Result<void>> {
		const attempt = this.#nextAttempt(workspaceId);
		this.#pending.delete(workspaceId);
		if (this.#launching.delete(workspaceId)) {
			this.#setPhase(workspaceId, attempt, "stopped");
		}
		const failures: unknown[] = [];
		const stopped = await this.#stopProcess(workspaceId, attempt);
		if (!stopped.ok) failures.push(stopped.error);
		const setup = this.#lastTerminal.get(workspaceId);
		if (setup !== undefined) {
			this.#lastTerminal.delete(workspaceId);
			const closed = await this.#deps.terminals.stop(setup);
			if (!closed.ok) failures.push(closed.error);
		}
		if (failures.length === 0) return ok(undefined);
		const first = failures[0];
		return err(
			first !== null && typeof first === "object" && "message" in first
				? (first as { code: string; message: string })
				: appError("run_stop_failed", "Couldn't stop the workspace's processes.", failures),
		);
	}

	/** Stops everything of one repository. Used when the repository is removed. */
	async stopAllForRepository(workspaceIds: readonly WorkspaceId[]): Promise<Result<void>> {
		let failure: Result<void> | null = null;
		for (const workspaceId of workspaceIds) {
			const stopped = await this.stopWorkspace(workspaceId);
			if (!stopped.ok && failure === null) failure = stopped;
		}
		return failure ?? ok(undefined);
	}

	/** True while a start is parked, beginning, running or stopping for the workspace. */
	isBusy(workspaceId: WorkspaceId): boolean {
		const phase = this.store.getState().phases[workspaceId];
		return (
			this.#pending.has(workspaceId) ||
			phase === "starting" ||
			phase === "waiting_for_setup" ||
			phase === "running" ||
			phase === "stopping"
		);
	}

	/** The counter id of the workspace's last started run. Null before the first one. */
	lastRunId(workspaceId: WorkspaceId): number | null {
		return this.#lastRunIds.get(workspaceId) ?? null;
	}

	/** Forgets a workspace's run state, history and counters without touching its processes. */
	clearRuns(workspaceId: WorkspaceId): void {
		this.#pending.delete(workspaceId);
		this.#processes.delete(workspaceId);
		this.#stopPortPolling(workspaceId, true);
		this.#launching.delete(workspaceId);
		this.#attempts.delete(workspaceId);
		this.#lastRunIds.delete(workspaceId);
		this.#removeSavedHistory(workspaceId);
		this.store.setState((state) => {
			const byWorkspace = { ...state.byWorkspace };
			delete byWorkspace[workspaceId];
			const phases = { ...state.phases };
			delete phases[workspaceId];
			const outcomes = { ...state.outcomes };
			delete outcomes[workspaceId];
			const portErrors = { ...state.portErrors };
			delete portErrors[workspaceId];
			const history = { ...state.history };
			delete history[workspaceId];
			return { ...state, byWorkspace, phases, outcomes, portErrors, history };
		});
	}

	/**
	 * Ends every terminal this service started: the setup and run terminals, without the stop
	 * watchdog. The container calls this when the app stops.
	 */
	async stopAll(): Promise<Result<void>> {
		const terminalIds = [...this.#lastTerminal.values()];
		for (const process of this.#processes.values()) terminalIds.push(process.terminalId);
		this.#lastTerminal.clear();
		this.#processes.clear();
		this.#pending.clear();
		this.#launching.clear();
		for (const workspaceId of [...this.#portTimers.keys()]) {
			this.#stopPortPolling(workspaceId, false);
		}
		for (const workspaceId of this.#attempts.keys()) this.#nextAttempt(workspaceId);
		const closed = await Promise.all(terminalIds.map((id) => this.#deps.terminals.end(id)));
		for (const result of closed) {
			if (!result.ok) return result;
		}
		return ok(undefined);
	}

	/**
	 * Reads the workspace's listening ports once and stores them in the run state. The poll timer
	 * and `RunScriptsService.activateApp` use this same read.
	 */
	async refreshPorts(workspaceId: WorkspaceId, workspacePath: string): Promise<Result<void>> {
		const ports = this.#deps.ports;
		if (ports === undefined) return ok(undefined);
		const ticket = this.#portScans.begin(workspaceId);
		const listed = await ports.listListening(workspaceId, workspacePath);
		if (!this.#portScans.isLatest(ticket)) {
			this.#portScans.settle(ticket);
			return ok(undefined);
		}
		this.#portScans.settle(ticket);
		if (!listed.ok) {
			this.#deps.log?.(
				"warn",
				`The listening ports of workspace ${workspaceId} could not be read: ${listed.error.message}`,
			);
			this.#setPortError(workspaceId, listed.error);
			return listed;
		}
		this.#setPortError(workspaceId, null);
		this.#setDetectedPorts(
			workspaceId,
			listed.value.map((entry) => ({
				port: entry.port,
				pid: entry.pid,
				processName: entry.command,
				appName: entry.appName,
			})),
		);
		return ok(undefined);
	}

	/** Backs `Actions.run.activateApp`: brings the macOS app that owns the port to the front. */
	async activateApp(workspaceId: WorkspaceId, port: number): Promise<Result<void>> {
		const workspace = await this.#deps.workspaceFor(workspaceId);
		if (!workspace.ok) return workspace;
		const ports = this.#deps.ports;
		if (ports === undefined) {
			return err(
				appError(
					"ports_unavailable",
					"The port cannot be activated because port detection is off.",
				),
			);
		}
		const listed = await ports.listListening(workspaceId, workspace.value.path);
		if (!listed.ok) return listed;
		const target = listed.value.find((entry) => entry.port === port);
		if (target === undefined) {
			return err(appError("port_not_found", `Nothing is listening on port ${port}.`));
		}
		if (target.appName === null) {
			return err(appError("app_not_detected", `No app owns port ${port}.`));
		}
		const shell = this.#deps.shell;
		if (shell === undefined) {
			return err(
				appError(
					"app_activate_failed",
					"The app cannot be activated because the shell was not provided.",
				),
			);
		}
		const activated = await shell.run({
			program: "open",
			args: ["-a", target.appName],
			cwd: workspace.value.path,
		});
		if (!activated.ok) return activated;
		if (activated.value.exitCode !== 0) {
			return err(
				appError(
					"app_activate_failed",
					`The app could not be activated: ${activated.value.stderr.trim() || `open exited ${activated.value.exitCode}`}`,
				),
			);
		}
		return ok(undefined);
	}

	/** Stores the last failed port scan for a workspace, or clears it after a good scan. */
	#setPortError(workspaceId: WorkspaceId, error: AppError | null): void {
		this.store.setState((state) => {
			if (error === null) {
				if (state.portErrors[workspaceId] === undefined) return state;
				const portErrors = { ...state.portErrors };
				delete portErrors[workspaceId];
				return { ...state, portErrors };
			}
			return { ...state, portErrors: { ...state.portErrors, [workspaceId]: error } };
		});
	}

	/** Stores one workspace's detected ports, replacing the list the Ports tab shows. */
	#setDetectedPorts(workspaceId: WorkspaceId, detected: RunState["detectedPorts"]): void {
		this.store.setState((state) => {
			const current = state.byWorkspace[workspaceId] ?? emptyRunState();
			return {
				...state,
				byWorkspace: {
					...state.byWorkspace,
					[workspaceId]: { ...current, detectedPorts: detected },
				},
			};
		});
	}

	/** Starts the port poll for a running workspace. A second call keeps the first timer. */
	#startPortPolling(workspaceId: WorkspaceId, workspacePath: string): void {
		if (this.#deps.ports === undefined) return;
		this.#portPaths.set(workspaceId, workspacePath);
		if (this.#portTimers.has(workspaceId)) return;
		const tick = (): void => {
			const path = this.#portPaths.get(workspaceId);
			if (path === undefined) return;
			void this.refreshPorts(workspaceId, path);
			this.#portTimers.set(workspaceId, setTimeout(tick, PORT_POLL_INTERVAL_MS));
		};
		this.#portTimers.set(workspaceId, setTimeout(tick, PORT_POLL_INTERVAL_MS));
		void this.refreshPorts(workspaceId, workspacePath);
	}

	/** Stops the port poll and, when asked, clears the list the Ports tab shows. */
	#stopPortPolling(workspaceId: WorkspaceId, clearPorts: boolean): void {
		const timer = this.#portTimers.get(workspaceId);
		if (timer !== undefined) {
			clearTimeout(timer);
			this.#portTimers.delete(workspaceId);
		}
		this.#portPaths.delete(workspaceId);
		this.#portScans.invalidate(workspaceId);
		if (clearPorts) {
			this.#setDetectedPorts(workspaceId, []);
			this.#setPortError(workspaceId, null);
		}
	}

	/** The variables saved on the Environment page for a repository, or none when it is not wired. */
	async #userEnv(repoId: RepoId): Promise<Result<Record<string, string>>> {
		if (this.#deps.environmentFor === undefined) return ok({});
		return this.#deps.environmentFor(repoId);
	}

	/** The folder to put first on PATH, or the bundled bin folder when no source is wired. */
	async #pathPrefix(): Promise<Result<string>> {
		if (this.#deps.pathPrefixFor === undefined) return ok(programsBinDir(this.#deps.fs.paths));
		return this.#deps.pathPrefixFor();
	}

	async #afterSetup(workspaceId: WorkspaceId, succeeded: boolean): Promise<Result<void>> {
		const pending = this.#pending.get(workspaceId);
		if (pending !== undefined) {
			this.#pending.delete(workspaceId);
			if (!succeeded) {
				this.#setPhase(workspaceId, pending.attempt, "stopped");
				return ok(undefined);
			}
			return this.#launchByAction(workspaceId, pending.actionId, pending.attempt);
		}
		if (!succeeded) return ok(undefined);

		const config = await this.#deps.configFor(workspaceId);
		if (!config.ok) return config;
		if (!config.value.autoRunAfterSetup || config.value.spotlightTesting) return ok(undefined);
		const action = defaultRunAction(config.value.runScripts);
		if (action === null) return ok(undefined);
		return this.#launchByAction(workspaceId, action.id, this.#nextAttempt(workspaceId));
	}

	async #launchByAction(
		workspaceId: WorkspaceId,
		actionId: string,
		attempt: number,
	): Promise<Result<void>> {
		if (!this.#isCurrent(workspaceId, attempt)) return ok(undefined);
		const config = await this.#deps.configFor(workspaceId);
		if (!this.#isCurrent(workspaceId, attempt)) return ok(undefined);
		if (!config.ok) return config;
		const action = config.value.runScripts.find((entry) => entry.id === actionId);
		if (action === undefined) {
			return err(appError("run_action_unknown", "That action no longer exists."));
		}
		const workspace = await this.#deps.workspaceFor(workspaceId);
		if (!this.#isCurrent(workspaceId, attempt)) return ok(undefined);
		if (!workspace.ok) return workspace;
		const repo = await this.#deps.repoFor(workspaceId);
		if (!this.#isCurrent(workspaceId, attempt)) return ok(undefined);
		if (!repo.ok) return repo;
		this.#setActions(workspaceId, config.value.runScripts);
		return this.#launch(workspaceId, attempt, action, config.value, workspace.value, repo.value);
	}

	async #launch(
		workspaceId: WorkspaceId,
		attempt: number,
		action: RunAction,
		config: RepoConfig,
		workspace: Workspace,
		repo: Repo,
	): Promise<Result<void>> {
		if (!this.#isCurrent(workspaceId, attempt)) return ok(undefined);

		if (config.runMode === "exclusive") {
			const stoppedOthers = await this.#stopOtherWorkspaces(repo.id, workspaceId);
			if (!this.#isCurrent(workspaceId, attempt)) return ok(undefined);
			if (!stoppedOthers.ok) return stoppedOthers;
		}

		const userEnv = await this.#userEnv(repo.id);
		if (!userEnv.ok) return userEnv;
		const env = buildScriptEnv({
			workspace,
			repoRootPath: repo.rootPath,
			defaultBranch: repo.defaultBranch,
			userEnv: userEnv.value,
		});
		const prefix = await this.#pathPrefix();
		if (!prefix.ok) return prefix;
		env.CONDUCTED_PATH_PREFIX = prefix.value;
		const cwd = expandActionCwd(action.cwd ?? workspace.path, env);
		const command = actionCommand(action);

		this.#setActions(workspaceId, config.runScripts);
		this.#setPhase(workspaceId, attempt, "starting");
		this.#launching.set(workspaceId, { actionId: action.id, attempt, repoId: repo.id });

		let liveUrl: string | null = null;
		let tail = "";
		const started = await this.#deps.terminals.runScript({
			workspaceId,
			kind: "run",
			title: action.label,
			command,
			cwd,
			env,
			onOutput: (text) => {
				tail = `${tail}${text}`.slice(-4096);
				const url = detectLocalUrl(tail);
				if (url === null) return;
				liveUrl = url;
				const process = this.#processes.get(workspaceId);
				if (process?.attempt === attempt) {
					process.url = url;
					this.#syncRunState(workspaceId, attempt, "running");
				}
			},
		});
		if (this.#launching.get(workspaceId)?.attempt === attempt) {
			this.#launching.delete(workspaceId);
		}
		if (!this.#isCurrent(workspaceId, attempt)) {
			if (started.ok) await this.#deps.terminals.stop(started.value.terminalId);
			// A stop with nothing newer to show still has to move the button off Starting.
			this.#settleAbandoned(workspaceId, attempt);
			return ok(undefined);
		}
		if (!started.ok) {
			this.#setPhase(workspaceId, attempt, "stopped");
			return started;
		}

		const runId = (this.#lastRunIds.get(workspaceId) ?? 0) + 1;
		this.#lastRunIds.set(workspaceId, runId);
		const process: RunProcess = {
			actionId: action.id,
			attempt,
			terminalId: started.value.terminalId,
			repoId: repo.id,
			url: liveUrl,
			exit: started.value.exit,
		};
		this.#processes.set(workspaceId, process);
		this.#recordHistory(workspaceId, action.id);
		this.#setPhase(workspaceId, attempt, "running");
		this.#startPortPolling(workspaceId, workspace.path);

		const settle = (_code: number | null): void => {
			if (!this.#isCurrent(workspaceId, attempt)) return;
			const current = this.#processes.get(workspaceId);
			if (current?.terminalId !== process.terminalId) return;
			this.#processes.delete(workspaceId);
			this.#stopPortPolling(workspaceId, true);
			this.#clearOutcome(workspaceId);
			this.#setPhase(workspaceId, attempt, "stopped");
		};
		process.exit.then(settle, () => settle(null));
		return ok(undefined);
	}

	async #stopOtherWorkspaces(repoId: string, keepWorkspaceId: WorkspaceId): Promise<Result<void>> {
		for (const [workspaceId, launching] of [...this.#launching.entries()]) {
			if (workspaceId === keepWorkspaceId || launching.repoId !== repoId) continue;
			const attempt = this.#nextAttempt(workspaceId);
			this.#launching.delete(workspaceId);
			this.#setPhase(workspaceId, attempt, "stopped");
		}
		for (const [workspaceId, process] of [...this.#processes.entries()]) {
			if (workspaceId === keepWorkspaceId || process.repoId !== repoId) continue;
			const stopped = await this.#stopProcess(workspaceId, this.#nextAttempt(workspaceId));
			if (!stopped.ok) return stopped;
		}
		return ok(undefined);
	}

	async #stopProcess(
		workspaceId: WorkspaceId,
		attempt: number,
		actionId?: string,
	): Promise<Result<void>> {
		const process = this.#processes.get(workspaceId);
		if (process === undefined) return ok(undefined);
		if (actionId !== undefined && process.actionId !== actionId) {
			return err(appError("run_not_running", "No process to stop."));
		}
		if (this.#isCurrent(workspaceId, attempt)) {
			this.#setPhase(workspaceId, attempt, "stopping");
		}
		this.#processes.delete(workspaceId);
		this.#stopPortPolling(workspaceId, true);
		const stopped = await this.#deps.terminals.stop(process.terminalId);
		if (this.#isCurrent(workspaceId, attempt)) {
			this.#setPhase(workspaceId, attempt, "stopped");
			if (!stopped.ok && stopped.error.code === "run_stop_unconfirmed") {
				this.store.setState((state) => ({
					...state,
					outcomes: { ...state.outcomes, [workspaceId]: "stop-unconfirmed" },
				}));
			}
		}
		return stopped;
	}

	#nextAttempt(workspaceId: WorkspaceId): number {
		this.#attemptCounter += 1;
		this.#attempts.set(workspaceId, this.#attemptCounter);
		return this.#attemptCounter;
	}

	#isCurrent(workspaceId: WorkspaceId, attempt: number): boolean {
		return this.#attempts.get(workspaceId) === attempt;
	}

	/**
	 * Moves a workspace's button off Starting after a launch was cancelled. A newer start or a
	 * newer process owns the state, so it is left alone.
	 */
	#settleAbandoned(workspaceId: WorkspaceId, attempt: number): void {
		const newest = this.#attempts.get(workspaceId);
		if (newest === undefined || newest === attempt) return;
		if (
			this.#launching.has(workspaceId) ||
			this.#processes.has(workspaceId) ||
			this.#pending.has(workspaceId)
		) {
			return;
		}
		this.#setPhase(workspaceId, newest, "stopped");
	}

	#clearOutcome(workspaceId: WorkspaceId): void {
		this.store.setState((state) => {
			if (state.outcomes[workspaceId] === undefined) return state;
			const outcomes = { ...state.outcomes };
			delete outcomes[workspaceId];
			return { ...state, outcomes };
		});
	}

	#recordHistory(workspaceId: WorkspaceId, actionId: string): void {
		let saved: readonly string[] = [];
		this.store.setState((state) => {
			saved = recordRunInHistory(state.history[workspaceId] ?? [], actionId);
			return { ...state, history: { ...state.history, [workspaceId]: saved } };
		});
		this.#saveHistory(workspaceId, saved);
	}

	/** The local storage that keeps run history, or the reason it cannot be reached. */
	#historyStorage(): Result<Storage> {
		if (typeof globalThis.localStorage === "undefined") {
			return err(
				appError("local_storage_unavailable", "Run history can't be read in this environment."),
			);
		}
		try {
			return ok(globalThis.localStorage);
		} catch (cause) {
			return err(
				appError("local_storage_unavailable", "Run history can't be read on this Mac.", cause),
			);
		}
	}

	/** Reads every saved workspace history. A bad entry is reported, not thrown away silently. */
	#readSavedHistory(): {
		history: Record<string, readonly string[]>;
		error: AppError | null;
	} {
		const storage = this.#historyStorage();
		if (!storage.ok) return { history: {}, error: storage.error };
		const history: Record<string, readonly string[]> = {};
		let error: AppError | null = null;
		for (let index = 0; index < storage.value.length; index += 1) {
			let key: string | null;
			try {
				key = storage.value.key(index);
			} catch (cause) {
				return {
					history,
					error: appError(
						"run_history_unreadable",
						"Run history couldn't be read on this Mac.",
						cause,
					),
				};
			}
			if (key === null || !key.startsWith(RUN_HISTORY_STORAGE_PREFIX)) continue;
			const workspaceId = key.slice(RUN_HISTORY_STORAGE_PREFIX.length);
			let raw: string | null;
			try {
				raw = storage.value.getItem(key);
			} catch (cause) {
				return {
					history,
					error: appError(
						"run_history_unreadable",
						"Run history couldn't be read on this Mac.",
						cause,
					),
				};
			}
			if (raw === null) continue;
			let parsed: unknown;
			try {
				parsed = JSON.parse(raw);
			} catch (cause) {
				error ??= appError("run_history_invalid", "The saved run history is not readable.", cause);
				continue;
			}
			if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === "string")) {
				error ??= appError("run_history_invalid", "The saved run history is not readable.");
				continue;
			}
			history[workspaceId] = parsed.slice(0, RUN_HISTORY_LIMIT);
		}
		return { history, error };
	}

	#saveHistory(workspaceId: WorkspaceId, history: readonly string[]): void {
		const storage = this.#historyStorage();
		if (!storage.ok) {
			this.#setHistoryError(storage.error);
			return;
		}
		try {
			storage.value.setItem(runHistoryStorageKey(workspaceId), JSON.stringify(history));
			this.#setHistoryError(null);
		} catch (cause) {
			this.#setHistoryError(
				appError("run_history_unwritable", "The run history couldn't be saved on this Mac.", cause),
			);
		}
	}

	#removeSavedHistory(workspaceId: WorkspaceId): void {
		const storage = this.#historyStorage();
		if (!storage.ok) {
			this.#setHistoryError(storage.error);
			return;
		}
		try {
			storage.value.removeItem(runHistoryStorageKey(workspaceId));
			this.#setHistoryError(null);
		} catch (cause) {
			this.#setHistoryError(
				appError(
					"run_history_unwritable",
					"The run history couldn't be cleared on this Mac.",
					cause,
				),
			);
		}
	}

	#setHistoryError(error: AppError | null): void {
		this.store.setState((state) =>
			state.historyError === error ? state : { ...state, historyError: error },
		);
	}

	#setActions(workspaceId: WorkspaceId, actions: readonly RunAction[]): void {
		this.store.setState((state) => {
			const current = state.byWorkspace[workspaceId] ?? emptyRunState();
			return {
				...state,
				byWorkspace: {
					...state.byWorkspace,
					[workspaceId]: { ...current, actions: [...actions] },
				},
			};
		});
	}

	#setPhase(workspaceId: WorkspaceId, attempt: number, phase: StartPhase): void {
		if (!this.#isCurrent(workspaceId, attempt)) return;
		this.#syncRunState(workspaceId, attempt, phase);
	}

	#syncRunState(workspaceId: WorkspaceId, attempt: number, phase: StartPhase): void {
		if (!this.#isCurrent(workspaceId, attempt)) return;
		const process = this.#processes.get(workspaceId);
		this.store.setState((state) => {
			const current = state.byWorkspace[workspaceId] ?? emptyRunState();
			const running =
				process === undefined ||
				phase === "stopped" ||
				phase === "waiting_for_setup" ||
				phase === "starting"
					? []
					: [
							{
								actionId: process.actionId,
								terminalId: process.terminalId,
								url: process.url,
								phase,
							},
						];
			return {
				...state,
				byWorkspace: { ...state.byWorkspace, [workspaceId]: { ...current, running } },
				phases: { ...state.phases, [workspaceId]: phase },
			};
		});
	}
}
