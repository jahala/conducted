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
 * points at a path of their own is shown as theirs and never downloaded over; copying an image
 * that is not an image file fails with a plain message; a save the user cancels is `ok(null)`;
 * System Settings that will not open says where to grant Full Disk Access by hand; feedback opens
 * the project's issue page with the text filled in and never sends logs anywhere by itself; the
 * Xcode licence fix opens Terminal and reports a Terminal that cannot be opened.
 * Our design choice: one service for these Mac-level actions, so screens get them through
 * `Actions` like everything else and the Platform stays out of `features/`.
 * Built now: the program store, the install, re-download and remove actions, and opening the
 * Privacy & Security pane for Full Disk Access. The other Mac-level actions are placeholders
 * owned by CHAT-29, APP-09 and APP-03.
 * Test first: install while a download of the same program runs starts no second download.
 */
import {
	appError,
	err,
	type ManagedProgram,
	notImplemented,
	ok,
	type Result,
} from "@conducted/shared";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { Platform } from "../../platform/platform.ts";
import type { FeedbackInput, Loadable } from "../api.ts";
import { createSingleFlight } from "../async/single-flight.ts";
import { openXcodeLicenseTerminal } from "../git/xcode-license.ts";
import type { AgentProgramView } from "../model.ts";

export interface SystemState {
	programs: Loadable<AgentProgramView[]>;
}

export interface SystemServiceDeps {
	platform: Pick<
		Platform,
		"programs" | "clipboard" | "dialogs" | "opener" | "system" | "sidecar" | "shell" | "fs"
	>;
	setting: <T>(key: string) => T;
}

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
		this.store = createStore<SystemState>(() => ({ programs: { state: "loading" } }));
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
