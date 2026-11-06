/**
 * @feature PLAT-28 System service: the managed programs and the Mac-level actions screens ask for
 * Owns: installing, downloading again and removing the programs the app manages (D021, D024) and
 * their status store; and small actions on the Mac that screens may not reach the Platform for:
 * copying text and images, saving or opening a file in its own app, Full Disk Access, the sidecar
 * log, the app log, the diagnostics capture, the feedback form and the Xcode licence fix.
 * Behaviour: native-and-sidecar-map.md A9 (binary manager), services-map.md 5A.8.1 (download
 * states, retry, send gate), ui-map.md 6 (Agents and Advanced pages, Full Disk Access row), 2 and
 * 5.4 (diagnostics, sidecar and app logs), 5.1 and 5.2 (Send feedback), 7.4 (Xcode licence).
 * Must handle: a program that is already downloading (a second install joins it); a failed
 * download keeps its retry state and the Retry button calls install again; a program the user
 * points at a path of their own is shown as theirs and never downloaded over; copying an image
 * that is not an image file fails with a plain message; a save the user cancels is `ok(null)`;
 * System Settings that will not open says where to grant Full Disk Access by hand; feedback opens
 * the project's issue page with the text filled in, adding recent logs only when the user asks;
 * the Xcode licence fix opens Terminal and reports a Terminal that cannot be opened; the
 * diagnostics capture reports a login shell or environment it cannot read instead of inventing
 * one; the sidecar and app logs open in their default app, and a missing log path is an error
 * value.
 * Our design choice: one service for these Mac-level actions, so screens get them through
 * `Actions` like everything else and the Platform stays out of `features/`.
 * Built now: the program store, the install, re-download and remove actions, opening the
 * Privacy & Security pane for Full Disk Access, the diagnostics capture, opening the sidecar
 * and app logs, and sending feedback. Copying and saving attachments are placeholders owned by
 * CHAT-29.
 * Test first: install while a download of the same program runs starts no second download.
 *
 * @feature APP-09 Send feedback
 * Owns: turning the feedback form into a new issue on the project's GitHub page.
 * Behaviour: ui-map.md 5.2 (the Feedback dialog's message, email, images and recent logs),
 * native-and-sidecar-map.md A5 (Help > Send Feedback).
 * Must handle: an empty message is refused; a failed log export or read is reported instead of
 * opening an issue without the logs the user asked for; a message longer than an issue title
 * becomes a shorter title; images are listed in the body because a browser link cannot attach
 * them.
 * Our design choice: Conductor posts the feedback to its own service; ours opens the project's
 * issue page, as the backlog row says.
 * Test first: a message, email, image and logs become a GitHub issue URL that holds all four.
 *
 * @feature SET-13 Chosen program paths reach terminals and scripts
 * Owns: the folder to put first on PATH, built from the executable paths chosen in Advanced
 * settings through the `programs_sync_path_overrides` command.
 * Behaviour: services-map.md 5A.8.2 (the shim folder and the plain bundled prefix it falls back
 * to when staging fails).
 * Must handle: no chosen path (the plain bundled folder, without asking the command); a staging
 * failure (the plain bundled folder, so a terminal still opens, and `pathOverrideProblem`, which
 * app/path-override-notice.ts shows, so the user knows the chosen program is not the one running).
 * Our design choice: Conductor only logs the failure; we also tell the user, because a silent
 * switch to another program breaks the rule against silent failures.
 * Test first: the chosen Claude and Codex paths reach the command, and its folder is returned.
 */
import type { AgentInstall } from "@conducted/protocol";
import {
	appError,
	err,
	type ManagedProgram,
	messageOf,
	notImplemented,
	ok,
	type Result,
} from "@conducted/shared";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { Platform } from "../../platform/platform.ts";
import type { FeedbackInput, Loadable } from "../api.ts";
import { binDir } from "../app-paths.ts";
import { createSingleFlight } from "../async/single-flight.ts";
import { openXcodeLicenseTerminal } from "../git/xcode-license.ts";
import type { AgentProgramView, DiagnosticsCapture } from "../model.ts";

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
	now: () => number;
	/** The agent programs the sidecar reports, for the diagnostics capture (APP-03). */
	agentInstalls?: () => readonly AgentInstall[];
}

/** The setting that names the program the user chose, per managed agent program. */
const PROGRAM_PATH_SETTING: Readonly<Record<string, string>> = {
	claude: "claude_executable_path",
	codex: "codex_executable_path",
};

/** The project's new-issue page. The feedback form fills its title and body. */
const FEEDBACK_ISSUE_URL = "https://github.com/jahala/conducted/issues/new";
/** Longest title the issue page gets; the rest of the message stays in the body. */
const MAX_FEEDBACK_TITLE = 120;
/** Most log text an issue link carries, so a long export does not break the browser URL. */
const MAX_FEEDBACK_LOG_CHARS = 20_000;

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
	 * on PATH for terminals and scripts. A staging failure goes into `pathOverrideProblem`, which
	 * the app shows as a notice, and the plain bundled folder is used, so the terminal still opens
	 * and the user knows it runs the bundled program instead of the chosen one.
	 */
	async pathPrefix(): Promise<Result<string>> {
		const bundled = binDir(this.#deps.platform.fs.paths);
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

	/**
	 * Captures what the diagnostics page shows: the app and the machine, the login shell and its
	 * PATH, the environment, the agent programs and the sidecar. Secrets stay in the capture; the
	 * diagnostics report hashes them before it is shown or copied.
	 */
	async captureDiagnostics(): Promise<Result<DiagnosticsCapture>> {
		const { platform } = this.#deps;
		let login: { shell: string; path: string };
		try {
			login = await platform.shell.loginEnv();
		} catch (cause) {
			return err(
				appError(
					"diagnostics_shell_failed",
					"The login shell and its PATH could not be captured.",
					cause,
				),
			);
		}
		const environment = await platform.shell.run({
			program: login.shell,
			args: ["-lc", "env"],
			cwd: platform.fs.paths.home,
		});
		if (!environment.ok) return environment;
		if (environment.value.exitCode !== 0) {
			const reason = environment.value.stderr.trim();
			return err(
				appError(
					"diagnostics_environment_failed",
					reason === ""
						? "The environment could not be captured."
						: `The environment could not be captured: ${reason}`,
				),
			);
		}
		let os: { osVersion: string; machineArch: "arm64" | "x86_64" };
		try {
			os = await platform.system.info();
		} catch (cause) {
			return err(
				appError(
					"diagnostics_system_failed",
					"The Mac's system information could not be read.",
					cause,
				),
			);
		}
		let logPath: string | null = null;
		try {
			logPath = await platform.sidecar.logPath();
		} catch (cause) {
			platform.app.writeLog("warn", "The sidecar log path could not be read", {
				message: messageOf(cause),
			});
		}
		const sidecar = await platform.sidecar.ensureStarted();
		const installs = this.#deps.agentInstalls?.() ?? [];
		return ok({
			app: { version: platform.app.version, channel: platform.app.channel },
			os: { name: "macOS", version: os.osVersion, arch: os.machineArch },
			shell: login.shell,
			path: login.path,
			env: parseEnvironment(environment.value.stdout),
			agents: installs.map((install) => ({
				name:
					install.acpAgent === undefined ? install.agent : `${install.agent} (${install.acpAgent})`,
				installed: install.installed,
				version: install.version ?? null,
				path: install.path ?? null,
			})),
			sidecar: { running: sidecar.ok, logPath },
			capturedAt: this.#deps.now(),
		});
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
	async sendFeedback(input: FeedbackInput): Promise<Result<void>> {
		const message = input.message.trim();
		if (message === "") {
			return err(appError("feedback_message_empty", "Write a message before sending feedback."));
		}
		const email = input.email?.trim() ?? "";
		const imagePaths = [...new Set(input.imagePaths.map((path) => path.trim()))].filter(
			(path) => path !== "",
		);
		let logs: string | null = null;
		if (input.includeLogs) {
			const recent = await this.#recentLogs();
			if (!recent.ok) return recent;
			logs = recent.value;
		}
		const body = feedbackBody({
			message,
			email,
			imagePaths,
			logs,
			version: this.#deps.platform.app.version,
			channel: this.#deps.platform.app.channel,
		});
		const url = `${FEEDBACK_ISSUE_URL}?${new URLSearchParams({
			title: feedbackTitle(message),
			body,
		}).toString()}`;
		try {
			await this.#deps.platform.opener.openUrl(url);
			return ok(undefined);
		} catch (cause) {
			return err(
				appError("feedback_open_failed", "The feedback issue page could not be opened.", cause),
			);
		}
	}

	/** The redacted log export, cut to the most recent part so the issue URL stays usable. */
	async #recentLogs(): Promise<Result<string>> {
		const exported = await this.#deps.platform.app.exportLogs();
		if (!exported.ok) {
			return err(
				appError(
					"feedback_logs_failed",
					"The recent app logs could not be exported.",
					exported.error,
				),
			);
		}
		const read = await this.#deps.platform.fs.readText(exported.value);
		if (!read.ok) {
			return err(
				appError("feedback_logs_failed", "The recent app logs could not be read.", read.error),
			);
		}
		const text = read.value.trimEnd();
		if (text.length <= MAX_FEEDBACK_LOG_CHARS) return ok(text);
		return ok(
			`(Showing the most recent ${MAX_FEEDBACK_LOG_CHARS} characters.)\n${text.slice(
				-MAX_FEEDBACK_LOG_CHARS,
			)}`,
		);
	}

	/** Backs `Actions.app.openSidecarLogs`: opens the sidecar log file in its default app. */
	async openSidecarLogs(): Promise<Result<void>> {
		let path: string;
		try {
			path = await this.#deps.platform.sidecar.logPath();
		} catch (cause) {
			return err(
				appError("sidecar_log_path_failed", "The sidecar log file could not be found.", cause),
			);
		}
		return this.#openFile(path);
	}

	/** Backs `app.openLogViewer`: exports the app log and opens the file in its default app. */
	async openAppLogs(): Promise<Result<void>> {
		const exported = await this.#deps.platform.app.exportLogs();
		if (!exported.ok) return exported;
		return this.#openFile(exported.value);
	}

	async #openFile(path: string): Promise<Result<void>> {
		const opened = await this.#deps.platform.shell.run({
			program: "open",
			args: [path],
			cwd: this.#deps.platform.fs.paths.home,
		});
		if (!opened.ok) return opened;
		if (opened.value.exitCode !== 0) {
			const reason = opened.value.stderr.trim();
			return err(
				appError("log_open_failed", reason === "" ? "The log file could not be opened." : reason),
			);
		}
		return ok(undefined);
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

/**
 * Reads `env` output into a record. Only lines shaped like an assignment are kept; a later value
 * for the same name replaces the earlier one, as an environment does.
 */
function parseEnvironment(text: string): Record<string, string> {
	const env: Record<string, string> = {};
	for (const line of text.split("\n")) {
		const equals = line.indexOf("=");
		if (equals <= 0) continue;
		const name = line.slice(0, equals);
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;
		env[name] = line.slice(equals + 1);
	}
	return env;
}

/** Claude first, then Codex, so the Agents page keeps a stable order. */
function orderOf(program: ManagedProgram): number {
	if (program === "claude") return 0;
	if (program === "codex") return 1;
	return 2;
}

/** The issue title: the message's first line, cut when it is too long for a title. */
function feedbackTitle(message: string): string {
	const firstLine = message.split(/\r?\n/, 1)[0]?.trim() ?? "";
	if (firstLine === "") return "Feedback about Conducted";
	if (firstLine.length <= MAX_FEEDBACK_TITLE) return firstLine;
	return `${firstLine.slice(0, MAX_FEEDBACK_TITLE - 1)}…`;
}

interface FeedbackBodyInput {
	message: string;
	email: string;
	imagePaths: readonly string[];
	logs: string | null;
	version: string;
	channel: string;
}

/** The issue body: the message first, then the contact and environment facts the sheet collected. */
function feedbackBody(input: FeedbackBodyInput): string {
	const parts = [input.message];
	if (input.email !== "") parts.push(`Contact email: ${input.email}`);
	parts.push(`Sent from Conducted ${input.version} (${input.channel}).`);
	if (input.imagePaths.length > 0) {
		parts.push(
			[
				"Images to attach:",
				...input.imagePaths.map((path) => `- ${path}`),
				"",
				"A link cannot upload them, so drag the files above into this issue.",
			].join("\n"),
		);
	}
	if (input.logs !== null) {
		parts.push(["Recent app logs:", "", "```", input.logs, "```"].join("\n"));
	}
	return parts.join("\n\n");
}
