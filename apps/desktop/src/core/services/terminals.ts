/**
 * @feature RUN-07 Terminals: tabs, script runs and output for the GetTerminalOutput tool; CHAT-23
 * Run button on shell code blocks
 * Owns: creating and closing terminal tabs, starting setup, run and Spotlight scripts and chat
 * code block commands in a terminal, keeping the live handles, saving history, and reading a
 * terminal's text for agents.
 * Behaviour: services-map.md 5A.4 (terminal layers, launch request, history and cold restore,
 * kinds of terminals), 5A.1.2 and 5A.1.3 (setup and run scripts as terminals; the agent tool
 * bridge and its error texts), 5A.1.2 (the environment variables), ui-map.md 3.7.
 * Must handle: a terminal whose folder is gone (clear error, no spawn); output flow control (ack
 * after rendering, owned by the view; an ack the shell did not hear is kept as the terminal's
 * error, since its output may stay paused); a history the shell could not save when the terminal
 * ended is kept as the terminal's error (PLAT-08); every terminal starts with the scrollback limit
 * from settings; a script terminal ends with an exit code that is stored;
 * the app quits while terminals run (kill all, mark them ended with no exit code); at most the
 * configured number of terminals per workspace; `getTerminalOutput` source "auto" picks the
 * Spotlight terminal, then the run terminal, then the newest interactive one, and says which it
 * used; a request for output when nothing matches returns a plain sentence the agent can read
 * ("No action process active"), not an error; an ended terminal falls back to the text kept when it
 * ended, then to its saved screen, then to a plain sentence when neither exists; script files are
 * never written to disk (the command goes to the shell as arguments); a chat command with no text,
 * or a workspace that is archived or not ready, is refused with a reason and no spawn.
 * CLOUD-01: a terminal, script or chat command checks the workspace's host before anything is
 * spawned (core/host.ts); a cloud workspace's terminals belong to the cloud runtime (CLOUD-09).
 * Shell integration (RUN-09, native-and-sidecar-map.md A5 and D1, services-map.md 5A.4.6): an
 * interactive terminal starts zsh with `ZDOTDIR` pointing at a folder of four small files
 * (`.zshenv`, `.zprofile`, `.zshrc`, `.zlogin`) that source the user's own dotfiles first and then
 * print OSC 633 markers: a program started, a command finished (with its exit code), and the
 * prompt. The service reads the markers from the output to keep `runningProgram` per terminal, as
 * Conductor keeps it on its terminal session (services-map.md 5A.4.6); the research names no screen
 * that shows it, so none does yet. The files are rewritten at every app start so an update reaches
 * existing installs; the shim reads the user's `.zshenv` from their home folder, and when that file
 * sets `ZDOTDIR` it reads their other dotfiles from that folder; a `ZDOTDIR` the app itself was
 * launched with (`Shell.loginEnv().zdotdir`) reaches the shim as `CONDUCTED_USER_ZDOTDIR`, and the
 * shim reads every user dotfile from it, as zsh would, then unsets it; a shell that is not
 * zsh, and every script terminal, start without the shim; a marker split across two
 * output chunks is still read; output with a marker still reaches the screen unchanged. Our design
 * choice: the marker namespace is `Conducted`, so markers are ours and not Conductor's.
 * Our design choice: environment variables are named CONDUCTED_*. Scripts run as
 * `<login shell> -l -c <script>` with the captured login environment, not from a temp file, and
 * with the PATH the login shell sees in the script's folder (PLAT-07, services-map.md 5A.8.3), so
 * direnv and mise settings of a workspace apply; a PATH the script's own variables set wins.
 * Closing a tab (`close`) kills its process and removes the row with its saved screen, as
 * Conductor's tab close destroys the terminal; `end` kills and marks the row ended but keeps it,
 * which is how script terminals end and how a tab's shell can be started again.
 * Built now (RUN-06, RUN-07, RUN-01, RUN-09, CHAT-23): tabs, the live connection, restart, repo
 * terminal, limit, folder check, kill on quit, `buildScriptEnv`, `outputFor`, `runScript`, `stop`
 * and `runCommand`. An ended terminal reads its saved scrollback once, before its connection is
 * handed to the view, so a reopened terminal replays it (PLAT-08). `runCommand` starts a chat code
 * block's command as a `run` terminal in the
 * workspace and returns its row; the chat shows its live stream, status, exit code, Stop and
 * Clear. `outputFor` reads the live screen, keeps the text of a finished terminal in memory, and
 * falls back to the saved screen for an older one. A run or spotlight script never saves its
 * screen, so its output stays off disk. `installShellIntegration` writes the zsh shim at app start
 * and interactive zsh terminals start with it.
 * SET-13: every terminal and script gets `CONDUCTED_PATH_PREFIX`, the shim folder for the program
 * paths chosen in settings (or the bundled bin folder), so a chosen `claude` or `codex` is the one
 * the shell runs. A script that already carries the variable keeps it.
 * Test first: buildScriptEnv sets CONDUCTED_PORT and CONDUCTED_WORKSPACE_PATH from the workspace.
 */

import type { Host } from "@conducted/protocol";
import {
	type AppError,
	appError,
	createKeyedQueue,
	err,
	ok,
	type RepoId,
	type Result,
	type TerminalId,
	type WorkspaceId,
} from "@conducted/shared";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { Platform, PtyHandle } from "../../platform/platform.ts";
import { stripTerminalEscapes } from "../../platform/terminal-escapes.ts";
import type { Loadable } from "../api.ts";
import { createLatestWins } from "../async/latest-wins.ts";
import { createSingleFlight } from "../async/single-flight.ts";
import { openCloudTerminal } from "../cloud/terminal.ts";
import type { Repositories } from "../db/repositories.ts";
import { checkHost } from "../host.ts";
import type { Terminal, TerminalConnection, TerminalUnsubscribe, Workspace } from "../model.ts";
import { isArchivedWorkspace } from "../status/archived.ts";
import { zshIntegrationDir } from "./shell-integration.ts";

/** The files of the zsh shim, in the order zsh reads them. */
export const ZSH_INTEGRATION_FILE_NAMES = [".zshenv", ".zprofile", ".zshrc", ".zlogin"] as const;

/** What a terminal's shell told us through an OSC 633 marker. */
export type ShellIntegrationEvent =
	| { kind: "program_start"; program: string }
	| { kind: "command_done"; exitCode: number | null }
	| { kind: "prompt" };

const SHELL_MARKER_PREFIX = `${String.fromCharCode(27)}]633;Conducted;`;
const SHELL_MARKER_BEL = String.fromCharCode(7);
const SHELL_MARKER_ST = `${String.fromCharCode(27)}\\`;

/** The text of each shim file, by file name. */
export function zshIntegrationFiles(): Readonly<
	Record<(typeof ZSH_INTEGRATION_FILE_NAMES)[number], string>
> {
	return {
		".zshenv": `# Conducted shell integration. Zsh reads this file first, from the shim folder.
_conducted_shim_zdotdir="\${ZDOTDIR:-$HOME}"
# Zsh reads a user's .zshenv from the ZDOTDIR the app was launched with, else their home folder,
# as it would without the shim.
_conducted_user_zdotdir="\${CONDUCTED_USER_ZDOTDIR:-$HOME}"
unset CONDUCTED_USER_ZDOTDIR
if [ "$_conducted_user_zdotdir" != "$_conducted_shim_zdotdir" ] && [ -f "$_conducted_user_zdotdir/.zshenv" ]; then
  source "$_conducted_user_zdotdir/.zshenv"
  # A .zshenv that sets ZDOTDIR names the folder that holds the user's other dotfiles.
  if [ -n "\${ZDOTDIR:-}" ] && [ "$ZDOTDIR" != "$_conducted_shim_zdotdir" ]; then
    _conducted_user_zdotdir="$ZDOTDIR"
  fi
fi
# Keep loading the rest of the shim even when the user's .zshenv changes ZDOTDIR.
ZDOTDIR="$_conducted_shim_zdotdir"
`,
		".zprofile": `# Conducted shell integration. Zsh reads this file for a login shell.
if [ "$_conducted_user_zdotdir" != "$ZDOTDIR" ] && [ -f "$_conducted_user_zdotdir/.zprofile" ]; then
  source "$_conducted_user_zdotdir/.zprofile"
fi
`,
		".zshrc": `# Conducted shell integration. Zsh reads this file for an interactive shell.
if [ "$_conducted_user_zdotdir" != "$ZDOTDIR" ] && [ -f "$_conducted_user_zdotdir/.zshrc" ]; then
  source "$_conducted_user_zdotdir/.zshrc"
fi

_conducted_marker() {
  printf '\\033]633;Conducted;%s\\007' "$1"
}

_conducted_preexec() {
  _conducted_command_running=1
  _conducted_marker "ProgramStart;\${1%% *}"
}

_conducted_precmd() {
  local code=$?
  if [ "\${_conducted_command_running:-0}" = "1" ]; then
    _conducted_marker "CommandDone;$code"
    _conducted_command_running=0
  fi
  _conducted_marker "Prompt"
}

autoload -Uz add-zsh-hook
add-zsh-hook preexec _conducted_preexec
add-zsh-hook precmd _conducted_precmd
`,
		".zlogin": `# Conducted shell integration. Zsh reads this file last for a login shell.
if [ "$_conducted_user_zdotdir" != "$ZDOTDIR" ] && [ -f "$_conducted_user_zdotdir/.zlogin" ]; then
  source "$_conducted_user_zdotdir/.zlogin"
fi
`,
	};
}

/**
 * Environment that starts zsh with the shim: `ZDOTDIR` is the shim folder. `launchZdotdir` is the
 * `ZDOTDIR` the app was launched with; the shim reads the user's dotfiles from it, else from their
 * home folder, and follows a `ZDOTDIR` their `.zshenv` sets. With none, no hand-over variable is
 * set, so an empty one never sends a user to the wrong folder.
 */
export function shellIntegrationEnv(
	shimDir: string,
	launchZdotdir: string | null,
): Readonly<Record<string, string>> {
	return launchZdotdir === null
		? { ZDOTDIR: shimDir }
		: { ZDOTDIR: shimDir, CONDUCTED_USER_ZDOTDIR: launchZdotdir };
}

const parseShellMarker = (payload: string): ShellIntegrationEvent | null => {
	const [kind, ...rest] = payload.split(";");
	if (kind === "ProgramStart") {
		const program = rest.join(";").trim();
		return program === "" ? null : { kind: "program_start", program };
	}
	if (kind === "CommandDone") {
		const raw = rest[0]?.trim() ?? "";
		const exitCode = /^\d+$/.test(raw) ? Number(raw) : null;
		return { kind: "command_done", exitCode };
	}
	if (kind === "Prompt") return { kind: "prompt" };
	return null;
};

/** Length of the longest suffix of `text` that starts the marker prefix. */
const partialMarkerPrefix = (text: string): number => {
	const max = Math.min(text.length, SHELL_MARKER_PREFIX.length - 1);
	for (let length = max; length > 0; length -= 1) {
		if (text.endsWith(SHELL_MARKER_PREFIX.slice(0, length))) return length;
	}
	return 0;
};

/**
 * Finds the markers in one chunk of terminal output. `carry` is the unfinished marker left by the
 * previous chunk (empty at first); the returned `carry` goes into the next call.
 */
export function scanShellIntegration(
	carry: string,
	chunk: string,
): { events: ShellIntegrationEvent[]; carry: string } {
	const text = carry + chunk;
	const events: ShellIntegrationEvent[] = [];
	let index = 0;
	let afterLastMarker = 0;
	for (;;) {
		const start = text.indexOf(SHELL_MARKER_PREFIX, index);
		if (start === -1) break;
		const payloadStart = start + SHELL_MARKER_PREFIX.length;
		const bel = text.indexOf(SHELL_MARKER_BEL, payloadStart);
		const st = text.indexOf(SHELL_MARKER_ST, payloadStart);
		let end = -1;
		let terminatorLength = 0;
		if (bel !== -1 && (st === -1 || bel < st)) {
			end = bel;
			terminatorLength = SHELL_MARKER_BEL.length;
		} else if (st !== -1) {
			end = st;
			terminatorLength = SHELL_MARKER_ST.length;
		}
		if (end === -1) return { events, carry: text.slice(start) };
		const event = parseShellMarker(text.slice(payloadStart, end));
		if (event !== null) events.push(event);
		index = end + terminatorLength;
		afterLastMarker = index;
	}
	const tail = text.slice(afterLastMarker);
	const kept = partialMarkerPrefix(tail);
	return { events, carry: kept === 0 ? "" : tail.slice(tail.length - kept) };
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

/** Lines returned when the caller does not ask for a positive number. From the research. */
export const DEFAULT_TERMINAL_OUTPUT_LINES = 1000;

/** The text Conductor uses when the requested source has no terminal (services-map.md 5A.1.3). */
export const NO_SPOTLIGHT_OUTPUT = "No spotlight process active";
export const NO_RUN_OUTPUT = "No action process active";
export const NO_TERMINAL_OUTPUT = "No terminal found for this workspace";

/** The text for an ended process whose output was never kept and never saved. */
export const NO_SAVED_OUTPUT = "No saved output for this process";

export interface TerminalOutput {
	output: string;
	/** The source that was actually read, as the agent's label: Spotlight, Action or Terminal. */
	source: string;
	running: boolean;
}

const SOURCE_LABELS: Readonly<Record<Terminal["kind"], string>> = {
	spotlight: "Spotlight",
	run: "Action",
	setup: "Action",
	terminal: "Terminal",
};

const KIND_FOR_SOURCE: Readonly<Record<Exclude<TerminalOutputSource, "auto">, Terminal["kind"]>> = {
	spotlight: "spotlight",
	run_script: "run",
	terminal: "terminal",
};

const MISSING_FOR_SOURCE: Readonly<Record<TerminalOutputSource, string>> = {
	auto: NO_TERMINAL_OUTPUT,
	spotlight: NO_SPOTLIGHT_OUTPUT,
	run_script: NO_RUN_OUTPUT,
	terminal: NO_TERMINAL_OUTPUT,
};

const sourceLabel = (source: TerminalOutputSource): string =>
	SOURCE_LABELS[source === "auto" ? "terminal" : KIND_FOR_SOURCE[source]];

/** Plain text of a saved screen snapshot. Invalid JSON and a missing `data` field are errors. */
export function snapshotText(json: string): Result<string> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch (cause) {
		return err(
			appError("terminal_output_failed", "The saved terminal screen could not be read.", cause),
		);
	}
	if (typeof parsed !== "object" || parsed === null) {
		return err(appError("terminal_output_failed", "The saved terminal screen could not be read."));
	}
	const data = (parsed as { data?: unknown }).data;
	if (typeof data !== "string") {
		return err(appError("terminal_output_failed", "The saved terminal screen could not be read."));
	}
	return ok(stripTerminalEscapes(data).replace(/\r/g, ""));
}

const lastLines = (text: string, maxLines: number): string => {
	const lines = text.split("\n");
	while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
	return lines.slice(Math.max(0, lines.length - maxLines)).join("\n");
};

const positiveLineCount = (maxLines: number): number =>
	Number.isFinite(maxLines) && maxLines > 0 ? Math.floor(maxLines) : DEFAULT_TERMINAL_OUTPUT_LINES;

/** Picks the terminal a source names. The newest row of that kind wins, including an ended one. */
function pickTerminal(
	terminals: readonly Terminal[],
	source: TerminalOutputSource,
): Terminal | null {
	const kinds: readonly Terminal["kind"][] =
		source === "auto" ? ["spotlight", "run", "terminal"] : [KIND_FOR_SOURCE[source]];
	const candidates = terminals
		.filter((terminal) => kinds.includes(terminal.kind))
		.sort((left, right) => left.startedAt - right.startedAt);
	const newestPerKind = kinds
		.map((kind) => candidates.filter((terminal) => terminal.kind === kind).at(-1))
		.find((terminal) => terminal !== undefined);
	return newestPerKind ?? null;
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
	/**
	 * Failures the screen should show, keyed `w:<workspace id>` or `r:<repo id>` (loading) and
	 * `t:<terminal id>` (saving an end time or a screen, or typing the starting command).
	 */
	errors: Readonly<Record<string, AppError>>;
	/** The program a terminal is running right now, by terminal id. Null: the shell is at its prompt. */
	runningProgram: Readonly<Record<string, string | null>>;
}

export interface TerminalsServiceDeps {
	platform: Pick<Platform, "pty" | "shell" | "fs" | "cloud">;
	repos: Pick<Repositories, "terminals" | "workspaces" | "repos">;
	/** Maximum interactive terminals per workspace, from settings. */
	maxPerWorkspace: () => number;
	/** Most bytes of saved history per terminal, from the Advanced setting (PLAT-08). */
	scrollbackLimitBytes: () => number;
	now: () => number;
	/** Runs `callback` after `ms`; returns a function that cancels it. Injected so tests control time. */
	setTimer?: (callback: () => void, ms: number) => () => void;
	/** The folder to put first on PATH (SET-13). Without it, a terminal gets no path prefix. */
	pathPrefixFor?: () => Promise<Result<string>>;
}

/** Milliseconds a stop waits for the process to exit before it reports "not confirmed". */
export const STOP_WATCHDOG_MS = 20_000;
export const STOP_NOT_CONFIRMED_MESSAGE = "Stop not confirmed, the process may still be running.";

type CloudHost = Extract<Host, { kind: "cloud" }>;

interface ConnectionRecord {
	terminal: Terminal;
	handle: PtyHandle | null;
	/** Whether the process runs in a sandbox, so its saved history is not read from the Mac. */
	cloud: boolean;
	history: Uint8Array;
	/** Whether the saved history has been read from the shell, so it is read once. */
	historyLoaded: boolean;
	ended: { exitCode: number | null } | null;
	/** The end-of-run text, kept so an agent can still read it after the process exits. */
	rendered: Promise<string | null> | null;
	/** Identifies the newest end-of-run read, so an older one cannot replace it. */
	screenTicket: number;
	dataListeners: Set<(chunk: Uint8Array) => void>;
	exitListeners: Set<(exitCode: number | null) => void>;
	pending: Uint8Array[];
	unsubscribeData: TerminalUnsubscribe | null;
	unsubscribeExit: TerminalUnsubscribe | null;
	/** Turns output bytes into text for the shell markers. */
	decoder: TextDecoder;
	/** The unfinished shell marker from the previous output chunk. */
	shellCarry: string;
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

/** A terminal title for a chat command: its first line, short enough to scan. */
function commandTitle(command: string): string {
	const firstLine = command.split(/\r?\n/, 1)[0] ?? command;
	return firstLine.length > 60 ? `${firstLine.slice(0, 57)}...` : firstLine;
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
	/** Only the newest list read for a workspace or repository may change the store. */
	readonly #loads = createLatestWins<string>();
	/** Creates in one workspace run one at a time, so the terminal limit counts the earlier ones. */
	readonly #creates = createKeyedQueue<string>();
	/** A second restart of one terminal joins the first, so it never spawns two shells. */
	readonly #restarts = createSingleFlight<string>();
	/** The zsh shim folder, or null when the login shell is not zsh. Set at app start. */
	#shimDir: string | null = null;
	/** The `ZDOTDIR` the app was launched with, read with the login shell at install (RUN-09). */
	#launchZdotdir: string | null = null;

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

	async start(): Promise<Result<void>> {
		const installed = await this.installShellIntegration();
		if (!installed.ok) return installed;
		this.store.setState({ loaded: true });
		return ok(undefined);
	}

	/** Reads the terminals of a workspace into the store. The screen calls it through useTerminals. */
	async loadWorkspace(workspaceId: WorkspaceId): Promise<Result<void>> {
		const ticket = this.#loads.begin(`w:${workspaceId}`);
		const listed = await this.#deps.repos.terminals.listByWorkspace(workspaceId);
		if (!this.#loads.isLatest(ticket)) return ok(undefined);
		this.#loads.settle(ticket);
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
		const ticket = this.#loads.begin(`r:${repoId}`);
		const listed = await this.#deps.repos.terminals.listByRepo(repoId);
		if (!this.#loads.isLatest(ticket)) return ok(undefined);
		this.#loads.settle(ticket);
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
		const known = this.#records.get(id);
		if (known) {
			await this.#loadSavedHistory(known);
			this.#setConnection(id, { state: "ready", data: known.connection });
			return ok(undefined);
		}
		if (existing?.state === "ready") return ok(undefined);

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
		await this.#loadSavedHistory(record);
		this.#setConnection(id, { state: "ready", data: record.connection });
		return ok(undefined);
	}

	/**
	 * Reads an ended terminal's saved scrollback once, so its view can replay it. A terminal that
	 * still runs has nothing saved to replay. A missing entry is normal; any other failure is kept
	 * as the terminal's error, and the view still opens.
	 */
	async #loadSavedHistory(record: ConnectionRecord): Promise<void> {
		if (record.historyLoaded) return;
		record.historyLoaded = true;
		if (record.cloud) return;
		if (record.ended === null && record.terminal.endedAt === null) return;
		const loaded = await this.#deps.platform.pty.loadHistory(record.terminal.id);
		if (!loaded.ok) {
			if (loaded.error.code !== "history_not_found") {
				this.#setError(`t:${record.terminal.id}`, loaded.error);
			}
			return;
		}
		record.history = loaded.value;
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
			cloud: false,
			history: new Uint8Array(),
			historyLoaded: false,
			ended: terminal.endedAt === null ? null : { exitCode: terminal.exitCode },
			rendered: null,
			screenTicket: 0,
			dataListeners: new Set(),
			exitListeners: new Set(),
			pending: [],
			unsubscribeData: null,
			unsubscribeExit: null,
			decoder: new TextDecoder(),
			shellCarry: "",
			connection: undefined as unknown as TerminalConnection,
		};
		record.connection = {
			get history() {
				return record.history;
			},
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
			ack: (bytes) => {
				const handle = record.handle;
				if (handle === null) return;
				// A lost acknowledgement can leave the terminal's output paused; keep why.
				void handle.ack(bytes).then((acked) => {
					if (!acked.ok) this.#setError(`t:${terminal.id}`, acked.error);
				});
			},
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

	/**
	 * Adds the chosen program shim folder to a terminal's environment (SET-13). A script that
	 * already carries the variable keeps it, so run scripts are not staged twice.
	 */
	async #withPathPrefix(
		env?: Readonly<Record<string, string>>,
	): Promise<Result<Readonly<Record<string, string>> | undefined>> {
		if (env?.CONDUCTED_PATH_PREFIX !== undefined && env.CONDUCTED_PATH_PREFIX !== "") {
			return ok(env);
		}
		if (this.#deps.pathPrefixFor === undefined) return ok(env);
		const prefix = await this.#deps.pathPrefixFor();
		if (!prefix.ok) return prefix;
		return ok({ ...(env ?? {}), CONDUCTED_PATH_PREFIX: prefix.value });
	}

	async #spawn(
		terminal: Terminal,
		existing?: ConnectionRecord,
		options?: {
			command?: { program: string; args: readonly string[] };
			env?: Readonly<Record<string, string>>;
			cloud?: CloudHost | null;
		},
	): Promise<Result<void>> {
		const cloud = options?.cloud ?? null;
		// Only an interactive zsh terminal on the Mac loads the shim. A script is not zsh, and a
		// sandbox has no zsh shim, so neither must.
		const env =
			cloud === null &&
			options?.command === undefined &&
			terminal.kind === "terminal" &&
			this.#shimDir !== null
				? { ...(options?.env ?? {}), ...shellIntegrationEnv(this.#shimDir, this.#launchZdotdir) }
				: options?.env;
		const spawned =
			cloud === null
				? await this.#deps.platform.pty.spawn({
						terminalId: terminal.id,
						cwd: terminal.cwd,
						cols: DEFAULT_COLS,
						rows: DEFAULT_ROWS,
						scrollbackLimitBytes: this.#deps.scrollbackLimitBytes(),
						...(options?.command === undefined ? {} : { command: options.command }),
						...(env === undefined ? {} : { env }),
					})
				: await openCloudTerminal(this.#deps.platform.cloud, cloud, {
						terminalId: terminal.id,
						cwd: terminal.cwd,
						cols: DEFAULT_COLS,
						rows: DEFAULT_ROWS,
						...(options?.command === undefined ? {} : { command: options.command }),
						...(env === undefined ? {} : { env }),
					});
		if (!spawned.ok) return spawned;

		const record = existing ?? this.#record(terminal);
		record.terminal = terminal;
		record.cloud = cloud !== null;
		record.handle = spawned.value;
		record.ended = null;
		// A restarted shell has no output yet; text from the previous one must not come back.
		record.rendered = null;
		record.screenTicket += 1;
		record.decoder = new TextDecoder();
		record.shellCarry = "";
		record.unsubscribeData = spawned.value.onData((chunk) => this.#emit(record, chunk));
		record.unsubscribeExit = spawned.value.onExit((exitCode, historyError) => {
			// The shell could not save the scrollback, so a reopened terminal will not show it.
			if (historyError !== null) this.#setError(`t:${terminal.id}`, historyError);
			this.#finish(terminal.id, exitCode);
		});
		this.#setConnection(terminal.id, { state: "ready", data: record.connection });
		return ok(undefined);
	}

	#emit(record: ConnectionRecord, chunk: Uint8Array): void {
		const scanned = scanShellIntegration(
			record.shellCarry,
			record.decoder.decode(chunk, { stream: true }),
		);
		record.shellCarry = scanned.carry;
		if (scanned.events.length > 0) this.#applyShellEvents(record.terminal.id, scanned.events);
		if (record.dataListeners.size === 0) {
			record.pending.push(chunk);
			return;
		}
		for (const listener of [...record.dataListeners]) listener(chunk);
	}

	/** Keeps the running program of a terminal from its shell markers. */
	#applyShellEvents(id: TerminalId, events: readonly ShellIntegrationEvent[]): void {
		const next = { ...this.store.getState().runningProgram };
		let changed = false;
		for (const event of events) {
			const value = event.kind === "program_start" ? event.program : null;
			if (next[id] !== value) {
				next[id] = value;
				changed = true;
			}
		}
		if (changed) this.store.setState({ runningProgram: next });
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
		void this.#persistEnd(id, endedAt, exitCode);
		this.#update(id, { endedAt, exitCode });
		// An ended shell runs no program, so no label keeps naming one.
		this.store.setState((state) => ({
			runningProgram: { ...state.runningProgram, [id]: null },
		}));
		if (handle) {
			const ticket = ++record.screenTicket;
			record.rendered = this.#captureScreenText(record, handle, ticket);
			// Script output is never written to disk. Only an interactive terminal keeps a screen.
			if (record.terminal.kind === "terminal") void this.#saveScreen(id, handle);
		}
	}

	/**
	 * Reads the end-of-run text while the handle is still alive. A failure is kept in the store so
	 * the user is not left with a terminal that looks readable but is not.
	 */
	async #captureScreenText(
		record: ConnectionRecord,
		handle: PtyHandle,
		ticket: number,
	): Promise<string | null> {
		let text: string;
		try {
			text = await handle.screenText(Number.MAX_SAFE_INTEGER);
		} catch (cause) {
			this.#setError(
				`t:${record.terminal.id}`,
				appError("terminal_output_failed", "Couldn't read the terminal output.", cause),
			);
			return null;
		}
		// Only the newest end may keep its text; an older read is dropped.
		return record.screenTicket === ticket ? text : null;
	}

	/** Stores the end time. A failure is kept in the store, so the row is not left looking live. */
	async #persistEnd(
		id: TerminalId,
		endedAt: number,
		exitCode: number | null,
	): Promise<Result<void>> {
		const marked = await this.#deps.repos.terminals.markEnded(id, endedAt, exitCode);
		if (marked.ok) return ok(undefined);
		this.#setError(`t:${id}`, marked.error);
		return err(marked.error);
	}

	async #saveScreen(id: TerminalId, handle: PtyHandle): Promise<void> {
		const snapshot = await handle.screenSnapshot();
		if (!snapshot.ok) {
			this.#setError(`t:${id}`, snapshot.error);
			return;
		}
		const saved = await this.#deps.repos.terminals.setScreenState(
			id,
			JSON.stringify(snapshot.value),
		);
		if (!saved.ok) this.#setError(`t:${id}`, saved.error);
	}

	/** Drops everything held for a removed terminal, so no list or view shows it again. */
	#forget(id: TerminalId): void {
		const known = this.#records.get(id)?.terminal;
		this.#records.delete(id);
		// A list read that began before the removal must not bring the terminal back.
		const keys: string[] = [];
		if (known?.workspaceId) keys.push(`w:${known.workspaceId}`);
		if (known?.repoId) keys.push(`r:${known.repoId}`);
		const state = this.store.getState();
		for (const [workspaceId, list] of Object.entries(state.byWorkspace)) {
			if (list.some((terminal) => terminal.id === id)) keys.push(`w:${workspaceId}`);
		}
		for (const [repoId, list] of Object.entries(state.byRepo)) {
			if (list.some((terminal) => terminal.id === id)) keys.push(`r:${repoId}`);
		}
		for (const key of keys) this.#loads.invalidate(key);
		const without = (list: readonly Terminal[]): readonly Terminal[] =>
			list.filter((terminal) => terminal.id !== id);
		this.store.setState((current) => ({
			byWorkspace: mapValues(current.byWorkspace, without),
			byRepo: mapValues(current.byRepo, without),
			connections: withoutKey(current.connections, id),
			errors: withoutKey(current.errors, `t:${id}`),
			runningProgram: withoutKey(current.runningProgram, id),
		}));
	}

	/** The sandbox a workspace's terminal runs in, or null when it runs on the Mac. */
	async #cloudHost(workspaceId: WorkspaceId): Promise<CloudHost | null> {
		const workspace = await this.#deps.repos.workspaces.get(workspaceId);
		if (!workspace.ok || workspace.value === null) return null;
		return workspace.value.host.kind === "cloud" ? workspace.value.host : null;
	}

	/** A terminal needs its folder. Without this check the shell would fail to start with no reason. */
	async #requireFolder(path: string): Promise<Result<void>> {
		if (await this.#deps.platform.fs.exists(path)) return ok(undefined);
		return err(appError("terminal_folder_missing", `The folder ${path} no longer exists.`));
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
	async installShellIntegration(): Promise<Result<void>> {
		let shell: string;
		let launchZdotdir: string | null;
		try {
			({ shell, zdotdir: launchZdotdir } = await this.#deps.platform.shell.loginEnv());
		} catch (cause) {
			return err(
				appError("shell_unknown", "Couldn't find your login shell to set up the terminal.", cause),
			);
		}

		const dir = zshIntegrationDir(this.#deps.platform.fs.paths);
		const made = await this.#deps.platform.fs.mkdirp(dir);
		if (!made.ok) return made;
		const files = zshIntegrationFiles();
		for (const name of ZSH_INTEGRATION_FILE_NAMES) {
			const written = await this.#deps.platform.fs.writeTextAtomic(`${dir}/${name}`, files[name]);
			if (!written.ok) return written;
		}
		this.#shimDir = /(?:^|\/)zsh$/.test(shell) ? dir : null;
		this.#launchZdotdir = launchZdotdir;
		return ok(undefined);
	}

	/** Backs `Actions.terminals.create`: an interactive login shell in the workspace folder. */
	create(workspaceId: WorkspaceId, options?: { command?: string }): Promise<Result<Terminal>> {
		return this.#creates.run(workspaceId, () => this.#create(workspaceId, options));
	}

	async #create(
		workspaceId: WorkspaceId,
		options?: { command?: string },
	): Promise<Result<Terminal>> {
		const workspace = await this.#deps.repos.workspaces.get(workspaceId);
		if (!workspace.ok) return workspace;
		if (workspace.value === null) {
			return err(appError("workspace_unknown", "That workspace no longer exists."));
		}
		checkHost(workspace.value.host, "terminals");
		const cloud = workspace.value.host.kind === "cloud" ? workspace.value.host : null;
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
		const folder = await this.#requireFolder(workspace.value.path);
		if (!folder.ok) return folder;
		const environment = cloud === null ? await this.#withPathPrefix() : ok(undefined);
		if (!environment.ok) return environment;

		const started = await this.#deps.repos.terminals.start({
			workspaceId,
			// A workspace terminal has no repo id: the table keeps exactly one of the two (0004).
			repoId: null,
			kind: "terminal",
			title: nextTerminalTitle(existing),
			cwd: workspace.value.path,
			startCommand: options?.command ?? null,
		});
		if (!started.ok) return started;

		const spawned = await this.#spawn(started.value, undefined, {
			cloud,
			...(environment.value === undefined ? {} : { env: environment.value }),
		});
		if (!spawned.ok) {
			await this.#persistEnd(started.value.id, this.#deps.now(), null);
			return spawned;
		}

		// A list read that began before this terminal existed must not replace the new list.
		this.#loads.invalidate(`w:${workspaceId}`);
		this.store.setState((state) => {
			const current = state.byWorkspace[workspaceId] ?? existing;
			const next = current.some((terminal) => terminal.id === started.value.id)
				? current
				: [...current, started.value];
			return { byWorkspace: { ...state.byWorkspace, [workspaceId]: next } };
		});
		if (started.value.startCommand !== null) {
			const typed = await this.#write(started.value.id, `${started.value.startCommand}\r`);
			if (!typed.ok) this.#setError(`t:${started.value.id}`, typed.error);
		}
		return ok(started.value);
	}

	/**
	 * Backs `Actions.terminals.close`: closing a terminal tab. The process is killed and the terminal
	 * is removed with its saved screen, so its tab leaves the strip and its view unmounts. Conductor's
	 * tab close destroys the terminal and clears its saved history (services-map.md 5A.4.7 `clear`;
	 * the call on close is in Conductor's bundle, not the research).
	 */
	async close(id: TerminalId): Promise<Result<void>> {
		const ended = await this.end(id);
		if (!ended.ok) return ended;
		const removed = await this.#deps.repos.terminals.delete(id);
		if (!removed.ok) return removed;
		this.#forget(id);
		return ok(undefined);
	}

	/**
	 * Kills the process and marks the row ended, keeping the row and its saved screen. A script
	 * terminal ends this way, so an agent can still read its output; a tab's terminal stays a tab.
	 */
	async end(id: TerminalId): Promise<Result<void>> {
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
	async runScript(input: {
		workspaceId: WorkspaceId;
		kind: "setup" | "run" | "spotlight";
		title: string;
		command: string;
		cwd: string;
		env: Readonly<Record<string, string>>;
		/** Receives the script's output as text, for URL detection. */
		onOutput?: (text: string) => void;
	}): Promise<Result<ScriptRun>> {
		const workspace = await this.#deps.repos.workspaces.get(input.workspaceId);
		if (!workspace.ok) return workspace;
		if (workspace.value === null) {
			return err(appError("workspace_unknown", "That workspace no longer exists."));
		}
		checkHost(workspace.value.host, "terminals");
		const cloud = workspace.value.host.kind === "cloud" ? workspace.value.host : null;
		const folder = await this.#requireFolder(input.cwd);
		if (!folder.ok) return folder;
		const environment = cloud === null ? await this.#withPathPrefix(input.env) : ok(input.env);
		if (!environment.ok) return environment;

		const started = await this.#deps.repos.terminals.start({
			workspaceId: input.workspaceId,
			repoId: null,
			kind: input.kind,
			title: input.title,
			cwd: input.cwd,
			startCommand: null,
		});
		if (!started.ok) return started;

		let login: { shell: string; path: string };
		try {
			// The script's own folder, so its direnv and mise settings reach the PATH (PLAT-07).
			login = await this.#deps.platform.shell.loginEnv(input.cwd);
		} catch (cause) {
			await this.#persistEnd(started.value.id, this.#deps.now(), null);
			return err(
				appError("shell_unknown", "Couldn't find your login shell to run the script.", cause),
			);
		}

		const spawned = await this.#spawn(started.value, undefined, {
			cloud,
			command: { program: login.shell, args: ["-l", "-c", input.command] },
			env: { PATH: login.path, ...(environment.value ?? input.env) },
		});
		if (!spawned.ok) {
			await this.#persistEnd(started.value.id, this.#deps.now(), null);
			return spawned;
		}

		const record = this.#records.get(started.value.id);
		if (record === undefined) {
			return err(appError("terminal_unknown", "That terminal no longer exists."));
		}

		let unsubscribeOutput: (() => void) | null = null;
		if (input.onOutput !== undefined) {
			const decoder = new TextDecoder();
			unsubscribeOutput = record.connection.onData((chunk) => {
				input.onOutput?.(decoder.decode(chunk));
			});
		}
		const exit = new Promise<number | null>((resolve) => {
			const unsubscribeExit = record.connection.onExit((code) => {
				unsubscribeExit();
				unsubscribeOutput?.();
				unsubscribeOutput = null;
				resolve(code);
			});
		});

		this.#loads.invalidate(`w:${input.workspaceId}`);
		this.store.setState((state) => {
			const current = state.byWorkspace[input.workspaceId] ?? [];
			const next = current.some((terminal) => terminal.id === started.value.id)
				? current
				: [...current, started.value];
			return { byWorkspace: { ...state.byWorkspace, [input.workspaceId]: next } };
		});
		return ok({ terminalId: started.value.id, exit });
	}

	/** Stops a script terminal: kill, then report a stop that did not confirm after 20 seconds. */
	async stop(id: TerminalId): Promise<Result<void>> {
		const record = this.#records.get(id);
		if (record === undefined || record.handle === null) {
			const found = await this.#deps.repos.terminals.get(id);
			if (!found.ok) return found;
			if (found.value === null || found.value.endedAt !== null) return ok(undefined);
			const marked = await this.#deps.repos.terminals.markEnded(id, this.#deps.now(), null);
			if (!marked.ok) return marked;
			this.#update(id, { endedAt: this.#deps.now(), exitCode: null });
			return ok(undefined);
		}

		const handle = record.handle;
		try {
			await handle.kill();
		} catch (cause) {
			return err(appError("terminal_stop_failed", "Couldn't stop the terminal.", cause));
		}

		let unsubscribeExit: () => void = () => {};
		const exited = new Promise<void>((resolve) => {
			unsubscribeExit = record.connection.onExit(() => {
				unsubscribeExit();
				unsubscribeExit = () => {};
				resolve();
			});
		});
		const timedOut = await new Promise<boolean>((resolve) => {
			let settled = false;
			let cancel: () => void = () => {};
			const finish = (value: boolean): void => {
				if (settled) return;
				settled = true;
				cancel();
				resolve(value);
			};
			cancel = this.#setTimer(() => finish(true), STOP_WATCHDOG_MS);
			void exited.then(() => finish(false));
		});
		if (timedOut) {
			unsubscribeExit();
			return err(appError("run_stop_unconfirmed", STOP_NOT_CONFIRMED_MESSAGE));
		}
		unsubscribeExit();
		return ok(undefined);
	}

	#setTimer(callback: () => void, ms: number): () => void {
		if (this.#deps.setTimer !== undefined) return this.#deps.setTimer(callback, ms);
		const handle = setTimeout(callback, ms);
		return () => clearTimeout(handle);
	}

	/**
	 * Backs the `getTerminalOutput` request from the sidecar. A caller that already has the
	 * terminal it wants passes `terminalId`; otherwise the source rule picks one. An ended
	 * terminal keeps its text from this run, then falls back to the saved screen.
	 */
	async outputFor(
		workspaceId: WorkspaceId,
		source: TerminalOutputSource,
		maxLines: number,
		terminalId?: TerminalId,
	): Promise<Result<TerminalOutput>> {
		const limit = positiveLineCount(maxLines);
		let terminal: Terminal;
		if (terminalId !== undefined) {
			const found = await this.#deps.repos.terminals.get(terminalId);
			if (!found.ok) return found;
			if (found.value === null) {
				return err(appError("terminal_unknown", "That terminal no longer exists."));
			}
			terminal = found.value;
		} else {
			const listed = await this.#deps.repos.terminals.listByWorkspace(workspaceId);
			if (!listed.ok) return listed;
			const picked = pickTerminal(listed.value, source);
			if (picked === null) {
				return ok({
					output: MISSING_FOR_SOURCE[source],
					source: sourceLabel(source),
					running: false,
				});
			}
			terminal = picked;
		}

		const read = await this.#readOutput(terminal, limit);
		if (!read.ok) return read;
		return ok({
			output: read.value.output,
			source: SOURCE_LABELS[terminal.kind],
			running: read.value.running,
		});
	}

	async #readOutput(
		terminal: Terminal,
		maxLines: number,
	): Promise<Result<{ output: string; running: boolean }>> {
		const record = this.#records.get(terminal.id);
		if (record?.handle) {
			try {
				return ok({ output: await record.handle.screenText(maxLines), running: true });
			} catch (cause) {
				return err(appError("terminal_output_failed", "Couldn't read the terminal output.", cause));
			}
		}

		if (record?.rendered) {
			const text = await record.rendered;
			if (text === null) {
				return err(appError("terminal_output_failed", "Couldn't read the terminal output."));
			}
			return ok({ output: lastLines(text, maxLines), running: false });
		}

		const saved = await this.#deps.repos.terminals.getScreenState(terminal.id);
		if (!saved.ok) return saved;
		if (saved.value !== null) {
			const text = snapshotText(saved.value);
			if (!text.ok) return text;
			return ok({ output: lastLines(text.value, maxLines), running: false });
		}

		return ok({ output: NO_SAVED_OUTPUT, running: false });
	}

	/** Kills every live terminal and stamps `ended_at`. Runs on quit. */
	async killAll(): Promise<Result<void>> {
		const records = [...this.#records.entries()];
		const failures: unknown[] = [];
		await Promise.all(
			records.map(async ([id, record]) => {
				if (record.handle) {
					try {
						await record.handle.kill();
					} catch (cause) {
						failures.push(cause);
					}
				}
				// Every row still gets its end time, so none is left looking live.
				this.#finish(id, null);
			}),
		);
		return failures.length === 0
			? ok(undefined)
			: err(
					appError(
						"terminal_kill_failed",
						`Couldn't stop ${failures.length} terminal${failures.length === 1 ? "" : "s"}.`,
						failures,
					),
				);
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

		const folder = await this.#requireFolder(repo.value.rootPath);
		if (!folder.ok) return folder;
		const environment = await this.#withPathPrefix();
		if (!environment.ok) return environment;

		const started = await this.#deps.repos.terminals.start({
			workspaceId: null,
			repoId,
			kind: "terminal",
			title: nextTerminalTitle(existing),
			cwd: repo.value.rootPath,
			startCommand: null,
		});
		if (!started.ok) return started;

		const spawned = await this.#spawn(
			started.value,
			undefined,
			environment.value === undefined ? undefined : { env: environment.value },
		);
		if (!spawned.ok) {
			await this.#persistEnd(started.value.id, this.#deps.now(), null);
			return spawned;
		}

		this.#loads.invalidate(`r:${repoId}`);
		this.store.setState((state) => {
			const current = state.byRepo[repoId] ?? existing;
			const next = current.some((terminal) => terminal.id === started.value.id)
				? current
				: [...current, started.value];
			return { byRepo: { ...state.byRepo, [repoId]: next } };
		});
		return ok(started.value);
	}

	/** Backs `Actions.terminals.restart`. Draws the divider, then starts a fresh shell. */
	restart(id: TerminalId): Promise<Result<void>> {
		return this.#restarts.run(id, () => this.#restart(id));
	}

	async #restart(id: TerminalId): Promise<Result<void>> {
		const found = await this.#deps.repos.terminals.get(id);
		if (!found.ok) return found;
		const terminal = found.value;
		if (terminal === null) {
			return err(appError("terminal_unknown", "That terminal no longer exists."));
		}
		if (terminal.endedAt === null) {
			return err(appError("terminal_running", "The terminal is still running."));
		}

		const folder = await this.#requireFolder(terminal.cwd);
		if (!folder.ok) return folder;
		const cloud =
			terminal.workspaceId === null ? null : await this.#cloudHost(terminal.workspaceId);
		const environment = cloud === null ? await this.#withPathPrefix() : ok(undefined);
		if (!environment.ok) return environment;

		const record = this.#records.get(id) ?? this.#record(terminal);
		this.#emit(record, new TextEncoder().encode(`${RESTART_DIVIDER}\r\n`));
		const spawned = await this.#spawn(terminal, record, {
			cloud,
			...(environment.value === undefined ? {} : { env: environment.value }),
		});
		if (!spawned.ok) return spawned;
		this.#update(id, { endedAt: null, exitCode: null });
		return ok(undefined);
	}

	/** Backs `Actions.terminals.runCommand`: the Run button on a chat code block. */
	async runCommand(workspaceId: WorkspaceId, command: string): Promise<Result<Terminal>> {
		const trimmed = command.trim();
		if (trimmed.length === 0) {
			return err(appError("command_empty", "There is no command to run."));
		}
		const workspace = await this.#deps.repos.workspaces.get(workspaceId);
		if (!workspace.ok) return workspace;
		if (workspace.value === null) {
			return err(appError("workspace_unknown", "That workspace no longer exists."));
		}
		checkHost(workspace.value.host, "terminals");
		if (isArchivedWorkspace(workspace.value)) {
			return err(appError("workspace_archived", "This workspace is archived."));
		}
		if (workspace.value.state !== "ready") {
			return err(appError("workspace_not_ready", "This workspace is not ready to run commands."));
		}
		const repo = await this.#deps.repos.repos.get(workspace.value.repoId);
		if (!repo.ok) return repo;
		if (repo.value === null) {
			return err(appError("repo_unknown", "That repository no longer exists."));
		}
		const env = buildScriptEnv({
			workspace: workspace.value,
			repoRootPath: repo.value.rootPath,
			defaultBranch: repo.value.defaultBranch,
			userEnv: {},
		});
		const started = await this.runScript({
			workspaceId,
			kind: "run",
			title: commandTitle(trimmed),
			command: trimmed,
			cwd: workspace.value.path,
			env,
		});
		if (!started.ok) return started;
		const terminal = await this.#deps.repos.terminals.get(started.value.terminalId);
		if (!terminal.ok) return terminal;
		if (terminal.value === null) {
			return err(appError("terminal_unknown", "That terminal no longer exists."));
		}
		return ok(terminal.value);
	}
}
