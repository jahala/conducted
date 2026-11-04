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
 * Our design choice: environment variables are named CONDUCTED_*. Scripts run as
 * `<login shell> -l -c <script>` with the captured login environment, not from a temp file.
 * Test first: buildScriptEnv sets CONDUCTED_PORT and CONDUCTED_WORKSPACE_PATH from the workspace.
 */
import { notImplemented, type Result, type TerminalId, type WorkspaceId } from "@conducted/shared";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { Platform, PtyHandle } from "../../platform/platform.ts";
import type { Repositories } from "../db/repositories.ts";
import type { Terminal, Workspace } from "../model.ts";

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
}

export interface TerminalsServiceDeps {
	platform: Pick<Platform, "pty" | "shell" | "fs">;
	repos: Pick<Repositories, "terminals">;
	/** Maximum interactive terminals per workspace, from settings. */
	maxPerWorkspace: () => number;
}

export class TerminalsService {
	readonly store: StoreApi<TerminalsState>;
	readonly #deps: TerminalsServiceDeps;
	readonly #handles = new Map<TerminalId, PtyHandle>();

	constructor(deps: TerminalsServiceDeps) {
		this.#deps = deps;
		this.store = createStore<TerminalsState>(() => ({ loaded: false, byWorkspace: {} }));
	}

	start(): Promise<Result<void>> {
		void this.#deps;
		void this.#handles;
		return notImplemented("RUN-06");
	}

	/** Backs `Actions.terminals.create`: an interactive login shell in the workspace folder. */
	create(_workspaceId: WorkspaceId): Promise<Result<Terminal>> {
		return notImplemented("RUN-06");
	}

	/** Backs `Actions.terminals.close`. Kills the process, keeps the saved history until pruned. */
	close(_id: TerminalId): Promise<Result<void>> {
		return notImplemented("RUN-06");
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
	killAll(): Promise<Result<void>> {
		return notImplemented("RUN-06");
	}
}
