/**
 * @feature RUN-01 Run actions with start and stop, concurrent or exclusive
 * Owns: the named actions of a repository (dev server, tests), starting and stopping them in a
 * terminal, the run state the Scripts panel shows, and finding the page URL in their output.
 * Behaviour: services-map.md 5A.1.3 (action process store: states, start attempts, kill with a
 * watchdog), 5A.1.4 (run mode, set by "run_script_mode"), 5A.1.5 (run history), 5A.1.6
 * (user-defined actions, default action and quoted args), ui-map.md 3.7 (Run tab: Run, Stop,
 * Starting, Stopping; the shortcut is "workspace.toggleRun"). Auto-run uses the repository
 * setting "auto_run_after_setup".
 * Must handle: starting an action stops the workspace's running one first (one process per
 * workspace); run mode "exclusive" also stops running actions of other workspaces of the same
 * repository; a start request while setup is still running waits for setup, then starts; every
 * async step checks its start attempt number and gives up if a newer start or a stop happened
 * (only the newest attempt changes state); stop asks the terminal service for a 20 second
 * watchdog, and a stop that is not confirmed is returned to the caller; quitting the app closes
 * all runs; "run after setup" starts the default action when setup succeeded; run output is not
 * saved to disk; only the last 20 action ids per workspace are remembered in memory.
 * Our design choice: the terminal service owns the process; this service owns the rules around
 * it. Run history lives in memory, not in the settings table.
 * Our design choice: setup runs with no `userEnv` for now. SET-04 owns the settings and Keychain
 * variables; until that service is wired here, no extra variables are passed rather than a
 * made-up set.
 * Built now (WS-03): `runSetup` and the setup half of `stopAll`.
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
import type { FileSystem } from "../../platform/platform.ts";
import type { RunState } from "../api.ts";
import { binDir, setupLogFile } from "../app-paths.ts";
import type { Repo, RepoConfig, RunAction, SetupView, Workspace } from "../model.ts";
import { buildScriptEnv, STOP_WATCHDOG_MS, type TerminalsService } from "./terminals.ts";

export { STOP_WATCHDOG_MS };
export const RUN_HISTORY_LIMIT = 20;

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

const emptyRunState = (): RunState => ({
	actions: [],
	running: [],
	spotlight: { active: false, terminalId: null },
	detectedPorts: [],
});

export class RunScriptsService {
	readonly store: StoreApi<RunScriptsState>;
	readonly #deps: RunScriptsServiceDeps;
	readonly #running = new Map<WorkspaceId, Promise<Result<SetupRunResult>>>();
	readonly #lastTerminal = new Map<WorkspaceId, TerminalId>();
	/** One run process per workspace, as the action store requires. */
	readonly #processes = new Map<WorkspaceId, RunProcess>();
	/** Start requests parked while the workspace's setup script runs. */
	readonly #pending = new Map<WorkspaceId, PendingRun>();
	/** The newest start attempt for each workspace; an older continuation bails out. */
	readonly #attempts = new Map<WorkspaceId, number>();
	/** A counter per workspace, for the last started run. */
	readonly #lastRunIds = new Map<WorkspaceId, number>();

	constructor(deps: RunScriptsServiceDeps) {
		this.#deps = deps;
		this.store = createStore<RunScriptsState>(() => ({
			byWorkspace: {},
			phases: {},
			history: {},
			outcomes: {},
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
		if (workspace.value.state === "archived" || workspace.value.state === "archiving") {
			return err(appError("workspace_not_ready", "That workspace is archived."));
		}
		const repo = await this.#deps.repoFor(workspaceId);
		if (!this.#isCurrent(workspaceId, attempt)) return ok(undefined);
		if (!repo.ok) return repo;

		// A start always stops the workspace's previous action first.
		await this.#stopProcess(workspaceId, attempt);
		if (!this.#isCurrent(workspaceId, attempt)) return ok(undefined);
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
		await this.#afterSetup(workspaceId, exitCode === 0);
		return ok({
			scriptFound: true,
			exitCode,
			terminalId: started.value.terminalId,
			logPath: wrote.ok ? logPath : null,
			log: wrote.ok ? "saved" : "missing",
		});
	}

	/** Runs the repo's archive script before a workspace is archived. */
	runArchive(_workspaceId: WorkspaceId): Promise<Result<void>> {
		return notImplemented("WS-05");
	}

	/** Stops the setup, run and Spotlight terminals of one workspace. */
	async stopWorkspace(workspaceId: WorkspaceId): Promise<Result<void>> {
		const attempt = this.#nextAttempt(workspaceId);
		this.#pending.delete(workspaceId);
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

	/** Called when a workspace leaves setup: starts the default action if the repo asks for it. */
	async onSetupFinished(workspaceId: WorkspaceId, setupSucceeded: boolean): Promise<Result<void>> {
		return this.#afterSetup(workspaceId, setupSucceeded);
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

	/** Forgets a workspace's run state without touching its processes. */
	clearRuns(workspaceId: WorkspaceId): void {
		this.#pending.delete(workspaceId);
		this.#processes.delete(workspaceId);
		this.store.setState((state) => {
			const byWorkspace = { ...state.byWorkspace };
			delete byWorkspace[workspaceId];
			const phases = { ...state.phases };
			delete phases[workspaceId];
			const outcomes = { ...state.outcomes };
			delete outcomes[workspaceId];
			return { ...state, byWorkspace, phases, outcomes };
		});
	}

	/**
	 * Closes every terminal this service started: the setup and run terminals, without the stop
	 * watchdog. The container calls this when the app stops.
	 */
	async stopAll(): Promise<Result<void>> {
		const terminalIds = [...this.#lastTerminal.values()];
		for (const process of this.#processes.values()) terminalIds.push(process.terminalId);
		this.#lastTerminal.clear();
		this.#processes.clear();
		this.#pending.clear();
		for (const workspaceId of this.#attempts.keys()) this.#nextAttempt(workspaceId);
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

		const env = buildScriptEnv({
			workspace,
			repoRootPath: repo.rootPath,
			defaultBranch: repo.defaultBranch,
			userEnv: {},
		});
		env.CONDUCTED_PATH_PREFIX = binDir(this.#deps.fs.paths);
		const cwd = expandActionCwd(action.cwd ?? workspace.path, env);
		const command = actionCommand(action);

		this.#setActions(workspaceId, config.runScripts);
		this.#setPhase(workspaceId, attempt, "starting");

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
		if (!this.#isCurrent(workspaceId, attempt)) {
			if (started.ok) await this.#deps.terminals.stop(started.value.terminalId);
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

		const settle = (_code: number | null): void => {
			if (!this.#isCurrent(workspaceId, attempt)) return;
			const current = this.#processes.get(workspaceId);
			if (current?.terminalId !== process.terminalId) return;
			this.#processes.delete(workspaceId);
			this.#clearOutcome(workspaceId);
			this.#setPhase(workspaceId, attempt, "stopped");
		};
		process.exit.then(settle, () => settle(null));
		return ok(undefined);
	}

	async #stopOtherWorkspaces(repoId: string, keepWorkspaceId: WorkspaceId): Promise<Result<void>> {
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
		const next = (this.#attempts.get(workspaceId) ?? 0) + 1;
		this.#attempts.set(workspaceId, next);
		return next;
	}

	#isCurrent(workspaceId: WorkspaceId, attempt: number): boolean {
		return this.#attempts.get(workspaceId) === attempt;
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
		this.store.setState((state) => ({
			...state,
			history: {
				...state.history,
				[workspaceId]: recordRunInHistory(state.history[workspaceId] ?? [], actionId),
			},
		}));
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
