/**
 * @feature RUN-07 Terminals: tabs, script runs and output for the GetTerminalOutput tool
 * Owns: creating and closing terminal tabs, starting setup, run and Spotlight scripts in a
 * terminal, keeping the live handles, saving history, and reading a terminal's text for agents.
 * Behaviour: services-map.md 5A.4 (terminal layers, launch request, history and cold restore,
 * kinds of terminals), 5A.1.2 and 5A.1.3 (setup and run scripts as terminals; the agent tool
 * bridge and its error texts), 5A.1.2 (the environment variables), ui-map.md 3.7.
 * Must handle: a terminal whose folder is gone (clear error, no spawn); output flow control (ack
 * after rendering, owned by the view); a script terminal ends with an exit code that is stored;
 * the app quits while terminals run (kill all, mark them ended with no exit code); at most the
 * configured number of terminals per workspace; `getTerminalOutput` source "auto" picks the
 * Spotlight terminal, then the run terminal, then the newest interactive one, and says which it
 * used; a request for output when nothing matches returns a plain sentence the agent can read
 * ("No run script is active"), not an error; script files are never written to disk (the command
 * goes to the shell as arguments).
 * Shell integration (RUN-09, native-and-sidecar-map.md A5 and D1, services-map.md 5A.4.6): an
 * interactive terminal starts zsh with `ZDOTDIR` pointing at a folder of four small files
 * (`.zshenv`, `.zprofile`, `.zshrc`, `.zlogin`) that source the user's own dotfiles first and then
 * print OSC 633 markers: a program started, a command finished (with its exit code), and the
 * prompt. The service reads the markers from the output to keep `runningProgram` per terminal. The
 * files are rewritten at every app start so an update reaches existing installs; the user's own
 * `ZDOTDIR` is passed on in a second variable and restored by the shim; a shell that is not zsh,
 * and every script terminal, start without the shim; a marker split across two output chunks is
 * still read; output with a marker still reaches the screen unchanged.
 * Our design choice: environment variables are named CONDUCTED_*. Scripts run as
 * `<login shell> -l -c <script>` with the captured login environment, not from a temp file.
 * Test first: buildScriptEnv sets CONDUCTED_PORT and CONDUCTED_WORKSPACE_PATH from the workspace.
 */
import {
	type AppError,
	appError,
	err,
	notImplemented,
	ok,
	type RepoId,
	type Result,
	type TerminalId,
	type WorkspaceId,
} from "@conducted/shared";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { Platform, PtyHandle } from "../../platform/platform.ts";
import type { Loadable } from "../api.ts";
import type { Repositories } from "../db/repositories.ts";
import type { Terminal, TerminalConnection, TerminalUnsubscribe, Workspace } from "../model.ts";

/** The files of the zsh shim, in the order zsh reads them. */
export const ZSH_INTEGRATION_FILE_NAMES = [".zshenv", ".zprofile", ".zshrc", ".zlogin"] as const;

/** What a terminal's shell told us through an OSC 633 marker. */
export type ShellIntegrationEvent =
	| { kind: "program_start"; program: string }
	| { kind: "command_done"; exitCode: number | null }
	| { kind: "prompt" };

/** The text of each shim file, by file name. */
export function zshIntegrationFiles(): Readonly<
	Record<(typeof ZSH_INTEGRATION_FILE_NAMES)[number], string>
> {
	return notImplemented("RUN-09");
}

/**
 * Environment that starts zsh with the shim: `ZDOTDIR` is the shim folder, and the user's own
 * `ZDOTDIR` (or null when unset) travels in a second variable so the shim can restore it.
 */
export function shellIntegrationEnv(
	_shimDir: string,
	_userZdotdir: string | null,
): Readonly<Record<string, string>> {
	return notImplemented("RUN-09");
}

/**
 * Finds the markers in one chunk of terminal output. `carry` is the unfinished marker left by the
 * previous chunk (empty at first); the returned `carry` goes into the next call.
 */
export function scanShellIntegration(
	_carry: string,
	_chunk: string,
): { events: ShellIntegrationEvent[]; carry: string } {
	return notImplemented("RUN-09");
}

export interface ScriptEnvInput {
	workspace: Pick<Workspace, "id" | "directoryName" | "path" | "port" | "targetBranch">;
	repoRootPath: string;
	defaultBranch: string;
	/** Variables from settings and the Keychain, applied under ours. */
	userEnv: Readonly<Record<string, string>>;
}

/** The variables every setup, run and archive script gets. */
export function buildScriptEnv(input: ScriptEnvInput): Record<string, string> {
	return {
		...input.userEnv,
		CONDUCTED_WORKSPACE_ID: input.workspace.id,
		CONDUCTED_WORKSPACE_NAME: input.workspace.directoryName,
		CONDUCTED_WORKSPACE_PATH: input.workspace.path,
		CONDUCTED_ROOT_PATH: input.repoRootPath,
		CONDUCTED_DEFAULT_BRANCH: input.defaultBranch,
		CONDUCTED_PORT: String(input.workspace.port),
		TERM: "xterm-256color",
		COLORTERM: "truecolor",
	};
}

/**
 * Most terminals one workspace may have. Our design choice: 5, or 10 with the experimental "tab
 * freak mode" setting, because the research does not state the default (services-map.md 5A.9).
 */
export const terminalLimit = (tabFreakMode: boolean): number => (tabFreakMode ? 10 : 5);

export type TerminalOutputSource = "auto" | "run_script" | "spotlight" | "terminal";

export interface TerminalOutput {
	output: string;
	/** The source that was actually read. */
	source: string;
	running: boolean;
}

export interface ScriptRun {
	terminalId: TerminalId;
	/** Resolves with the exit code when the script ends. */
	exit: Promise<number | null>;
}

export interface TerminalsState {
	loaded: boolean;
	byWorkspace: Readonly<Record<string, readonly Terminal[]>>;
	byRepo: Readonly<Record<string, readonly Terminal[]>>;
	/** The live PTY stream of each terminal that has been opened. */
	connections: Readonly<Record<string, Loadable<TerminalConnection>>>;
	/** Loading failures, keyed `w:<workspace id>` or `r:<repo id>`. */
	errors: Readonly<Record<string, AppError>>;
	/** The program a terminal is running right now, by terminal id. Null: the shell is at its prompt. */
	runningProgram: Readonly<Record<string, string | null>>;
}

export interface TerminalsServiceDeps {
	platform: Pick<Platform, "pty" | "shell" | "fs">;
	repos: Pick<Repositories, "terminals" | "workspaces" | "repos">;
	/** Maximum interactive terminals per workspace, from settings. */
	maxPerWorkspace: () => number;
	now: () => number;
}

interface ConnectionRecord {
	terminal: Terminal;
	handle: PtyHandle | null;
	history: Uint8Array;
	ended: { exitCode: number | null } | null;
	dataListeners: Set<(chunk: Uint8Array) => void>;
	exitListeners: Set<(exitCode: number | null) => void>;
	pending: Uint8Array[];
	unsubscribeData: TerminalUnsubscribe | null;
	unsubscribeExit: TerminalUnsubscribe | null;
	connection: TerminalConnection;
}

/** The divider Conductor draws when a finished shell starts again (services-map.md 5A.4.6). */
export const RESTART_DIVIDER = "--- Previous terminal session restored. Starting new shell... ---";

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

/** The lowest free "Terminal N" title. */
export function nextTerminalTitle(terminals: readonly Terminal[]): string {
	const used = new Set(terminals.map((terminal) => terminal.title));
	for (let number = 1; ; number += 1) {
		const title = `Terminal ${number}`;
		if (!used.has(title)) return title;
	}
}

const withoutKey = <T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> => {
	const next = { ...record };
	delete next[key];
	return next;
};

const mapValues = <T>(
	record: Readonly<Record<string, T>>,
	change: (value: T) => T,
): Record<string, T> =>
	Object.fromEntries(Object.entries(record).map(([key, value]) => [key, change(value)]));

export class TerminalsService {
	readonly store: StoreApi<TerminalsState>;
	readonly #deps: TerminalsServiceDeps;
	readonly #records = new Map<TerminalId, ConnectionRecord>();

	constructor(deps: TerminalsServiceDeps) {
		this.#deps = deps;
		this.store = createStore<TerminalsState>(() => ({
			loaded: false,
			byWorkspace: {},
			byRepo: {},
			connections: {},
			errors: {},
			runningProgram: {},
		}));
	}

	start(): Promise<Result<void>> {
		this.store.setState({ loaded: true });
		return Promise.resolve(ok(undefined));
	}

	/** Reads the terminals of a workspace into the store. The screen calls it through useTerminals. */
	async loadWorkspace(workspaceId: WorkspaceId): Promise<Result<void>> {
		const listed = await this.#deps.repos.terminals.listByWorkspace(workspaceId);
		if (!listed.ok) {
			this.#setError(`w:${workspaceId}`, listed.error);
			return err(listed.error);
		}
		this.store.setState((state) => ({
			byWorkspace: { ...state.byWorkspace, [workspaceId]: listed.value },
			errors: withoutKey(state.errors, `w:${workspaceId}`),
		}));
		return ok(undefined);
	}

	/** Reads the repository terminal and its earlier runs. Backs useRepoTerminals. */
	async loadRepo(repoId: RepoId): Promise<Result<void>> {
		const listed = await this.#deps.repos.terminals.listByRepo(repoId);
		if (!listed.ok) {
			this.#setError(`r:${repoId}`, listed.error);
			return err(listed.error);
		}
		this.store.setState((state) => ({
			byRepo: { ...state.byRepo, [repoId]: listed.value },
			errors: withoutKey(state.errors, `r:${repoId}`),
		}));
		return ok(undefined);
	}

	/**
	 * Makes the connection for one terminal available to its view. A terminal that is not loaded
	 * yet is read from the database first.
	 */
	async ensureConnection(id: TerminalId): Promise<Result<void>> {
		const existing = this.store.getState().connections[id];
		if (existing?.state === "ready") return ok(undefined);

		const known = this.#records.get(id);
		if (known) {
			this.#setConnection(id, { state: "ready", data: known.connection });
			return ok(undefined);
		}

		const found = await this.#deps.repos.terminals.get(id);
		if (!found.ok) {
			this.#setConnection(id, { state: "error", error: found.error });
			return err(found.error);
		}
		if (found.value === null) {
			const error = appError("terminal_unknown", "That terminal no longer exists.");
			this.#setConnection(id, { state: "error", error });
			return err(error);
		}
		const record = this.#record(found.value);
		this.#setConnection(id, { state: "ready", data: record.connection });
		return ok(undefined);
	}

	#setConnection(id: TerminalId, value: Loadable<TerminalConnection>): void {
		this.store.setState((state) => ({
			connections: { ...state.connections, [id]: value },
		}));
	}

	#setError(key: string, error: AppError): void {
		this.store.setState((state) => ({ errors: { ...state.errors, [key]: error } }));
	}

	#record(terminal: Terminal): ConnectionRecord {
		const known = this.#records.get(terminal.id);
		if (known) {
			known.terminal = terminal;
			return known;
		}

		const record: ConnectionRecord = {
			terminal,
			handle: null,
			history: new Uint8Array(),
			ended: terminal.endedAt === null ? null : { exitCode: terminal.exitCode },
			dataListeners: new Set(),
			exitListeners: new Set(),
			pending: [],
			unsubscribeData: null,
			unsubscribeExit: null,
			connection: undefined as unknown as TerminalConnection,
		};
		record.connection = {
			history: record.history,
			get ended() {
				return record.ended;
			},
			write: (data) => this.#write(terminal.id, data),
			resize: (cols, rows) => this.#resize(terminal.id, cols, rows),
			onData: (listener) => {
				record.dataListeners.add(listener);
				for (const chunk of record.pending.splice(0)) listener(chunk);
				return () => {
					record.dataListeners.delete(listener);
				};
			},
			ack: (bytes) => record.handle?.ack(bytes),
			onExit: (listener) => {
				if (record.ended !== null) {
					const code = record.ended.exitCode;
					queueMicrotask(() => listener(code));
					return () => {};
				}
				record.exitListeners.add(listener);
				return () => {
					record.exitListeners.delete(listener);
				};
			},
		};
		this.#records.set(terminal.id, record);
		return record;
	}

	async #spawn(terminal: Terminal, existing?: ConnectionRecord): Promise<Result<void>> {
		const spawned = await this.#deps.platform.pty.spawn({
			cwd: terminal.cwd,
			cols: DEFAULT_COLS,
			rows: DEFAULT_ROWS,
		});
		if (!spawned.ok) return spawned;

		const record = existing ?? this.#record(terminal);
		record.terminal = terminal;
		record.handle = spawned.value;
		record.ended = null;
		record.unsubscribeData = spawned.value.onData((chunk) => this.#emit(record, chunk));
		record.unsubscribeExit = spawned.value.onExit((exitCode) =>
			this.#finish(terminal.id, exitCode),
		);
		this.#setConnection(terminal.id, { state: "ready", data: record.connection });
		return ok(undefined);
	}

	#emit(record: ConnectionRecord, chunk: Uint8Array): void {
		if (record.dataListeners.size === 0) {
			record.pending.push(chunk);
			return;
		}
		for (const listener of [...record.dataListeners]) listener(chunk);
	}

	#finish(id: TerminalId, exitCode: number | null): void {
		const record = this.#records.get(id);
		if (!record || record.ended !== null) return;

		const handle = record.handle;
		record.handle = null;
		record.ended = { exitCode };
		record.unsubscribeData?.();
		record.unsubscribeData = null;
		record.unsubscribeExit?.();
		record.unsubscribeExit = null;

		for (const listener of [...record.exitListeners]) listener(exitCode);
		record.exitListeners.clear();

		const endedAt = this.#deps.now();
		void this.#deps.repos.terminals.markEnded(id, endedAt, exitCode);
		this.#update(id, { endedAt, exitCode });
		if (handle) void this.#saveScreen(id, handle);
	}

	async #saveScreen(id: TerminalId, handle: PtyHandle): Promise<void> {
		const snapshot = await handle.screenSnapshot();
		if (!snapshot.ok) return;
		await this.#deps.repos.terminals.setScreenState(id, JSON.stringify(snapshot.value));
	}

	#update(id: TerminalId, patch: Partial<Terminal>): void {
		const record = this.#records.get(id);
		if (record) record.terminal = { ...record.terminal, ...patch };
		const replace = (list: readonly Terminal[]): readonly Terminal[] =>
			list.map((terminal) => (terminal.id === id ? { ...terminal, ...patch } : terminal));
		this.store.setState((state) => ({
			byWorkspace: mapValues(state.byWorkspace, replace),
			byRepo: mapValues(state.byRepo, replace),
		}));
	}

	async #write(id: TerminalId, data: string): Promise<Result<void>> {
		const handle = this.#records.get(id)?.handle;
		if (!handle) {
			return err(appError("terminal_not_running", "The terminal is not running."));
		}
		try {
			await handle.write(data);
			return ok(undefined);
		} catch (cause) {
			return err(appError("terminal_write_failed", "Couldn't write to the terminal.", cause));
		}
	}

	async #resize(id: TerminalId, cols: number, rows: number): Promise<Result<void>> {
		const handle = this.#records.get(id)?.handle;
		if (!handle) return ok(undefined);
		try {
			await handle.resize(cols, rows);
			return ok(undefined);
		} catch (cause) {
			return err(appError("terminal_resize_failed", "Couldn't resize the terminal.", cause));
		}
	}

	/** Writes the zsh shim files into `zshIntegrationDir`. Runs at every app start. */
	installShellIntegration(): Promise<Result<void>> {
		return notImplemented("RUN-09");
	}

	/** Backs `Actions.terminals.create`: an interactive login shell in the workspace folder. */
	async create(
		workspaceId: WorkspaceId,
		options?: { command?: string },
	): Promise<Result<Terminal>> {
		const workspace = await this.#deps.repos.workspaces.get(workspaceId);
		if (!workspace.ok) return workspace;
		if (workspace.value === null) {
			return err(appError("workspace_unknown", "That workspace no longer exists."));
		}
		if (workspace.value.state !== "ready") {
			return err(appError("workspace_not_ready", "Workspace is not ready for local terminals."));
		}

		const listed = await this.#deps.repos.terminals.listByWorkspace(workspaceId);
		if (!listed.ok) return listed;
		const existing = listed.value;
		const liveCount = existing.filter(
			(terminal) => terminal.kind === "terminal" && terminal.endedAt === null,
		).length;
		const limit = this.#deps.maxPerWorkspace();
		if (liveCount >= limit) {
			return err(appError("terminal_limit", `Maximum ${limit} terminals allowed`));
		}

		const started = await this.#deps.repos.terminals.start({
			workspaceId,
			repoId: workspace.value.repoId,
			kind: "terminal",
			title: nextTerminalTitle(existing),
			cwd: workspace.value.path,
			startCommand: options?.command ?? null,
			cols: DEFAULT_COLS,
			rows: DEFAULT_ROWS,
		});
		if (!started.ok) return started;

		const spawned = await this.#spawn(started.value);
		if (!spawned.ok) {
			await this.#deps.repos.terminals.markEnded(started.value.id, this.#deps.now(), null);
			return spawned;
		}

		const next = [...existing, started.value];
		this.store.setState((state) => ({
			byWorkspace: { ...state.byWorkspace, [workspaceId]: next },
		}));
		if (started.value.startCommand !== null) {
			void this.#write(started.value.id, `${started.value.startCommand}\r`);
		}
		return ok(started.value);
	}

	/** Backs `Actions.terminals.close`. Kills the process, keeps the saved history until pruned. */
	async close(id: TerminalId): Promise<Result<void>> {
		const record = this.#records.get(id);
		if (record?.handle) {
			try {
				await record.handle.kill();
			} catch (cause) {
				return err(appError("terminal_close_failed", "Couldn't close the terminal.", cause));
			}
			this.#finish(id, null);
			return ok(undefined);
		}

		const found = await this.#deps.repos.terminals.get(id);
		if (!found.ok) return found;
		if (found.value === null) return ok(undefined);
		if (found.value.endedAt !== null) return ok(undefined);
		const ended = await this.#deps.repos.terminals.markEnded(id, this.#deps.now(), null);
		if (!ended.ok) return ended;
		this.#update(id, { endedAt: this.#deps.now(), exitCode: null });
		return ok(undefined);
	}

	/** Starts a script (setup, run or spotlight) in its own terminal row. */
	runScript(_input: {
		workspaceId: WorkspaceId;
		kind: "setup" | "run" | "spotlight";
		title: string;
		command: string;
		cwd: string;
		env: Readonly<Record<string, string>>;
	}): Promise<Result<ScriptRun>> {
		return notImplemented("RUN-01");
	}

	/** Stops a script terminal: terminate, then kill after 20 seconds if it does not exit. */
	stop(_id: TerminalId): Promise<Result<void>> {
		return notImplemented("RUN-01");
	}

	/** Backs the `getTerminalOutput` request from the sidecar. */
	outputFor(
		_workspaceId: WorkspaceId,
		_source: TerminalOutputSource,
		_maxLines: number,
	): Promise<Result<TerminalOutput>> {
		return notImplemented("RUN-07");
	}

	/** Kills every live terminal and stamps `ended_at`. Runs on quit. */
	async killAll(): Promise<Result<void>> {
		const records = [...this.#records.entries()];
		await Promise.all(
			records.map(async ([id, record]) => {
				if (record.handle) {
					try {
						await record.handle.kill();
					} catch {
						// The row still gets its end time below.
					}
				}
				this.#finish(id, null);
			}),
		);
		return ok(undefined);
	}

	/** Backs `Actions.terminals.openForRepo`. One terminal per repository, created the first time. */
	async openForRepo(repoId: RepoId): Promise<Result<Terminal>> {
		const repo = await this.#deps.repos.repos.get(repoId);
		if (!repo.ok) return repo;
		if (repo.value === null) {
			return err(appError("repo_unknown", "That repository no longer exists."));
		}

		const listed = await this.#deps.repos.terminals.listByRepo(repoId);
		if (!listed.ok) return listed;
		const existing = listed.value;
		const open = existing.find(
			(terminal) => terminal.kind === "terminal" && terminal.endedAt === null,
		);
		if (open) {
			this.store.setState((state) => ({
				byRepo: { ...state.byRepo, [repoId]: existing },
			}));
			return ok(open);
		}

		const started = await this.#deps.repos.terminals.start({
			workspaceId: null,
			repoId,
			kind: "terminal",
			title: nextTerminalTitle(existing),
			cwd: repo.value.rootPath,
			startCommand: null,
			cols: DEFAULT_COLS,
			rows: DEFAULT_ROWS,
		});
		if (!started.ok) return started;

		const spawned = await this.#spawn(started.value);
		if (!spawned.ok) {
			await this.#deps.repos.terminals.markEnded(started.value.id, this.#deps.now(), null);
			return spawned;
		}

		const next = [...existing, started.value];
		this.store.setState((state) => ({
			byRepo: { ...state.byRepo, [repoId]: next },
		}));
		return ok(started.value);
	}

	/** Backs `Actions.terminals.restart`. Draws the divider, then starts a fresh shell. */
	async restart(id: TerminalId): Promise<Result<void>> {
		const found = await this.#deps.repos.terminals.get(id);
		if (!found.ok) return found;
		const terminal = found.value;
		if (terminal === null) {
			return err(appError("terminal_unknown", "That terminal no longer exists."));
		}
		if (terminal.endedAt === null) {
			return err(appError("terminal_running", "The terminal is still running."));
		}

		const record = this.#records.get(id) ?? this.#record(terminal);
		this.#emit(record, new TextEncoder().encode(`${RESTART_DIVIDER}\r\n`));
		const spawned = await this.#spawn(terminal, record);
		if (!spawned.ok) return spawned;
		this.#update(id, { endedAt: null, exitCode: null });
		return ok(undefined);
	}

	/** Backs `Actions.terminals.runCommand`: the Run button on a chat code block. */
	runCommand(_workspaceId: WorkspaceId, _command: string): Promise<Result<Terminal>> {
		return notImplemented("CHAT-23");
	}
}
