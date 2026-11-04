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
 * Test first: starting an action while another runs in the same workspace stops the first.
 */
import { notImplemented, type Result, type WorkspaceId } from "@conducted/shared";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { RunState } from "../api.ts";
import type { RepoConfig } from "../model.ts";
import type { TerminalsService } from "./terminals.ts";

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

export interface RunScriptsServiceDeps {
	terminals: Pick<TerminalsService, "runScript" | "stop" | "outputFor">;
	/** Config of the repository a workspace belongs to. */
	configFor: (workspaceId: WorkspaceId) => Promise<Result<RepoConfig>>;
}

export class RunScriptsService {
	readonly store: StoreApi<RunScriptsState>;
	readonly #deps: RunScriptsServiceDeps;

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

	/** Runs the repo's setup script in a terminal of kind "setup". Backs the workspace service. */
	runSetup(_workspaceId: WorkspaceId): Promise<Result<{ exitCode: number | null }>> {
		return notImplemented("WS-03");
	}

	/** Runs the repo's archive script before a workspace is archived. */
	runArchive(_workspaceId: WorkspaceId): Promise<Result<void>> {
		return notImplemented("WS-05");
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

	stopAll(): Promise<Result<void>> {
		return notImplemented("RUN-01");
	}

	/** Backs `Actions.run.activateApp`. */
	activateApp(_workspaceId: WorkspaceId, _port: number): Promise<Result<void>> {
		return notImplemented("RUN-03");
	}
}
