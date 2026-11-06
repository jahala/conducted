/**
 * @feature PLAT-28 System service: the managed programs and the Mac-level actions screens ask for
 * Owns: installing, downloading again and removing the programs the app manages (D021, D024) and
 * their status store; and small actions on the Mac that screens may not reach the Platform for:
 * copying text and images, saving or opening a file in its own app, Full Disk Access, the sidecar
 * log, the feedback form and the Xcode licence fix.
 * Behaviour: native-and-sidecar-map.md A9 (binary manager), services-map.md 5A.8.1 (download
 * states, retry, send gate), ui-map.md 6 (Agents and Advanced pages, Full Disk Access row), 5.1 and
 * 5.2 (Send feedback), 7.4 (Xcode licence).
 * Must handle: a program that is already downloading (a second install joins it); a failed
 * download keeps its retry state and the Retry button calls install again; a program the user
 * points at a path of their own is shown as theirs and never downloaded over; a message to Claude
 * or Codex while its managed copy is still being made ready waits, unless the user chose a
 * program of their own (`holdsSend`; the container holds the follow-up queue with it); gh and
 * watchexec are managed too but stay off the agent programs list (PLAT-35); copying an image
 * that is not an image file fails with a plain message; a save the user cancels is `ok(null)`;
 * System Settings that will not open says where to grant Full Disk Access by hand; feedback opens
 * the project's issue page with the text filled in and never sends logs anywhere by itself; the
 * Xcode licence fix opens Terminal and reports a Terminal that cannot be opened.
 * Our design choice: one service for these Mac-level actions, so screens get them through
 * `Actions` like everything else and the Platform stays out of `features/`.
 * Built now: the program store, the install, re-download and remove actions, the send gate, and
 * opening the Privacy & Security pane for Full Disk Access.
 * Our design choice: a copy that failed or is missing does not hold a message, so a copy on the
 * user's PATH runs instead (D021). Conductor holds until the copy is ready. The other Mac-level actions are placeholders
 * owned by CHAT-29, APP-09 and APP-03.
 * Test first: install while a download of the same program runs starts no second download.
 *
 * @feature SET-13 Chosen program paths reach terminals and scripts
 * Owns: the folder to put first on PATH, built from the executable paths chosen in Advanced
 * settings through the `programs_sync_path_overrides` command, then the app's bin folder in the
 * data folder, where the program manager links the managed programs (PLAT-35).
 * Behaviour: services-map.md 5A.8.2 (the shim folder and the plain prefix it falls back to when
 * staging fails) and 5A.1.2 (the prefix is `AppData/bin`).
 * Must handle: no chosen path (the app's bin folder alone, without asking the command); a staging
 * failure (the app's bin folder alone, so a terminal still opens, and `pathOverrideProblem`, which
 * app/path-override-notice.ts shows, so the user knows the chosen program is not the one running).
 * Our design choice: Conductor only logs the failure; we also tell the user, because a silent
 * switch to another program breaks the rule against silent failures.
 * Test first: the chosen Claude and Codex paths reach the command, and its folder is returned.
 */
import {
	type AgentKind,
	appError,
	err,
	type ManagedProgram,
	notImplemented,
	ok,
	type Result,
} from "@conducted/shared";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { Platform, ProgramState } from "../../platform/platform.ts";
import type { FeedbackInput, Loadable } from "../api.ts";
import { programsBinDir } from "../app-paths.ts";
import { createSingleFlight } from "../async/single-flight.ts";
import { openXcodeLicenseTerminal } from "../git/xcode-license.ts";
import type { AgentProgramView } from "../model.ts";

export interface SystemState {
	programs: Loadable<AgentProgramView[]>;
	/**
	 * The last time the chosen program paths could not be staged (SET-13). `serial` grows with
	 * each failure, so the notice shows again for the next terminal or script. Null once staging
	 * works again.
	 */
	pathOverrideProblem: { serial: number; message: string } | null;
}

export interface SystemServiceDeps {
	platform: Pick<
		Platform,
		"programs" | "clipboard" | "dialogs" | "opener" | "system" | "sidecar" | "shell" | "fs" | "app"
	>;
	setting: <T>(key: string) => T;
}

/**
 * The programs the Advanced page lists. gh and watchexec are managed too (PLAT-35) but stay off
 * it, as Conductor lists only its agent programs there (ui-map 7.4).
 */
const AGENT_PROGRAMS: readonly ManagedProgram[] = ["claude", "codex"];

/** The states in which the program manager is still getting a program ready. */
const PREPARING: ReadonlySet<ProgramState> = new Set([
	"queued",
	"downloading",
	"verifying",
	"retrying",
]);

/** The setting that names the program the user chose, per managed agent program. */
const PROGRAM_PATH_SETTING: Readonly<Record<string, string>> = {
	claude: "claude_executable_path",
	codex: "codex_executable_path",
};

export class SystemService {
	readonly store: StoreApi<SystemState>;
	readonly #deps: SystemServiceDeps;
	readonly #flights = createSingleFlight();
	#statuses = new Map<ManagedProgram, AgentProgramView["status"]>();
	#unsubscribe: (() => void) | null = null;
	/** Counts every status the store applies, so an older list cannot overwrite a newer one. */
	#statusSerial = 0;
	#started: Promise<Result<void>> | null = null;
	#disposed = false;

	constructor(deps: SystemServiceDeps) {
		this.#deps = deps;
		this.store = createStore<SystemState>(() => ({
			programs: { state: "loading" },
			pathOverrideProblem: null,
		}));
	}

	/** Loads the program statuses and follows their changes. */
	start(): Promise<Result<void>> {
		if (this.#started === null) this.#started = this.#load();
		return this.#started;
	}

	async #load(): Promise<Result<void>> {
		const unsubscribe = this.#deps.platform.programs.onStatus((status) => {
			this.#applyStatus(status);
		});
		if (this.#disposed) {
			unsubscribe();
			return ok(undefined);
		}
		this.#unsubscribe = unsubscribe;
		const serial = this.#statusSerial;
		const loaded = await this.#deps.platform.programs.statuses();
		if (!loaded.ok) {
			if (this.#statusSerial === serial) {
				this.store.setState({ programs: { state: "error", error: loaded.error } });
			}
			return loaded;
		}
		// A status that arrived while the list was loading is newer than the list.
		if (this.#statusSerial === serial) {
			this.#statuses = new Map(loaded.value.map((status) => [status.program, status]));
			this.#publish();
		}
		return ok(undefined);
	}

	/**
	 * True while a message to `agent` must wait (services-map 5A.8.1): the program manager is still
	 * getting the agent's managed copy ready and the user chose no program of their own. A copy
	 * that failed or is missing does not hold a message, so a copy on the user's PATH can run
	 * instead (D021).
	 */
	holdsSend(agent: AgentKind): boolean {
		if (agent !== "claude" && agent !== "codex") return false;
		if (this.#userPath(agent) !== null) return false;
		const status = this.#statuses.get(agent);
		return status !== undefined && PREPARING.has(status.state);
	}

	/** Backs `Actions.programs.install`, also the Retry after a failure. */
	installProgram(program: ManagedProgram): Promise<Result<void>> {
		return this.#run(program, () => this.#deps.platform.programs.install(program));
	}

	/** Backs `Actions.programs.redownload`. */
	redownloadProgram(program: ManagedProgram): Promise<Result<void>> {
		return this.#run(program, () => this.#deps.platform.programs.redownload(program));
	}

	/** Backs `Actions.programs.remove`. */
	removeProgram(program: ManagedProgram): Promise<Result<void>> {
		return this.#run(program, () => this.#deps.platform.programs.remove(program));
	}

	/**
	 * Stages the executable paths chosen in Advanced settings and returns the folder to put first
	 * on PATH for terminals and scripts, followed by the app's bin folder. A staging failure goes
	 * into `pathOverrideProblem`, which the app shows as a notice, and the app's bin folder alone is
	 * used, so the terminal still opens and the user knows it runs the managed program instead of
	 * the chosen one.
	 */
	async pathPrefix(): Promise<Result<string>> {
		const bundled = programsBinDir(this.#deps.platform.fs.paths);
		const overrides: Partial<Record<ManagedProgram, string>> = {};
		for (const program of ["claude", "codex"] as const) {
			const key = PROGRAM_PATH_SETTING[program];
			if (key === undefined) continue;
			const value = this.#deps.setting<string>(key);
			const chosen = typeof value === "string" ? value.trim() : "";
			if (chosen !== "") overrides[program] = chosen;
		}
		if (Object.keys(overrides).length === 0) return ok(bundled);

		const synced = await this.#deps.platform.programs.syncPathOverrides(overrides);
		if (synced.ok) {
			if (this.store.getState().pathOverrideProblem !== null) {
				this.store.setState({ pathOverrideProblem: null });
			}
			return ok(`${synced.value}:${bundled}`);
		}
		this.#deps.platform.app.writeLog(
			"warn",
			`Failed to stage agent PATH override shims: ${synced.error.message}`,
		);
		this.store.setState((state) => ({
			pathOverrideProblem: {
				serial: (state.pathOverrideProblem?.serial ?? 0) + 1,
				message: synced.error.message,
			},
		}));
		return ok(bundled);
	}

	/** Stops following the program statuses. The container calls it when the app stops. */
	dispose(): void {
		this.#disposed = true;
		this.#unsubscribe?.();
		this.#unsubscribe = null;
	}

	/** One action per program at a time: a second install joins the first instead of starting one. */
	#run(program: ManagedProgram, action: () => Promise<Result<void>>): Promise<Result<void>> {
		return this.#flights.run(`program:${program}`, async () => {
			const result = await action();
			if (!result.ok) return result;
			return ok(undefined);
		});
	}

	#applyStatus(status: AgentProgramView["status"]): void {
		this.#statusSerial += 1;
		this.#statuses.set(status.program, status);
		this.#publish();
	}

	#publish(): void {
		const views: AgentProgramView[] = [...this.#statuses.values()]
			.filter((status) => AGENT_PROGRAMS.includes(status.program))
			.map((status) => ({
				status,
				userPath: this.#userPath(status.program),
			}))
			.sort((left, right) => orderOf(left.status.program) - orderOf(right.status.program));
		this.store.setState({ programs: { state: "ready", data: views } });
	}

	#userPath(program: ManagedProgram): string | null {
		const key = PROGRAM_PATH_SETTING[program];
		if (key === undefined) return null;
		const value = this.#deps.setting<string>(key);
		const trimmed = typeof value === "string" ? value.trim() : "";
		return trimmed === "" ? null : trimmed;
	}

	/** Backs `Actions.app.copyText`. */
	async copyText(text: string): Promise<Result<void>> {
		try {
			await this.#deps.platform.clipboard.writeText(text);
			return ok(undefined);
		} catch (cause) {
			return err(appError("clipboard_write_failed", "Could not copy to the clipboard.", cause));
		}
	}

	/** Backs `Actions.attachments.copyImage`. */
	copyImage(_path: string): Promise<Result<void>> {
		return notImplemented("CHAT-29");
	}

	/** Backs `Actions.attachments.saveAs`. */
	saveAs(_path: string): Promise<Result<string | null>> {
		return notImplemented("CHAT-29");
	}

	/** Backs `Actions.attachments.openExternally`. */
	openExternally(_path: string): Promise<Result<void>> {
		return notImplemented("CHAT-29");
	}

	/** Backs `Actions.app.sendFeedback`. */
	sendFeedback(_input: FeedbackInput): Promise<Result<void>> {
		return notImplemented("APP-09");
	}

	/** Backs `Actions.app.openSidecarLogs`. */
	openSidecarLogs(): Promise<Result<void>> {
		return notImplemented("APP-03");
	}

	/** Backs `Actions.app.openFullDiskAccessSettings`. */
	async openFullDiskAccessSettings(): Promise<Result<void>> {
		const opened = await this.#deps.platform.system.openFullDiskAccessSettings();
		if (opened.ok) return ok(undefined);
		return err(
			appError(
				"full_disk_access_settings_unavailable",
				"System Settings could not be opened. Grant Full Disk Access under Privacy & Security yourself.",
				opened.error,
			),
		);
	}

	/** Backs `Actions.app.runXcodeLicenseFix`: opens Terminal with the accept command. */
	runXcodeLicenseFix(): Promise<Result<void>> {
		return openXcodeLicenseTerminal(this.#deps.platform.shell, this.#deps.platform.fs.paths.home);
	}
}

/** Claude first, then Codex, so the Agents page keeps a stable order. */
function orderOf(program: ManagedProgram): number {
	if (program === "claude") return 0;
	if (program === "codex") return 1;
	return 2;
}
