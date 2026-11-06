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
 * points at a path of their own is shown as theirs and never downloaded over; a message to Claude
 * or Codex while its managed copy is still being made ready waits, unless the user chose a
 * program of their own (`holdsSend`; the container holds the follow-up queue with it); gh and
 * watchexec are managed too but stay off the agent programs list (PLAT-35); Cursor's SDK is on
 * that list and holds a send to Cursor while it installs (AGENT-09); copying an image
 * that is not an image file fails with a plain message; a save the user cancels is `ok(null)`;
 * System Settings that will not open says where to grant Full Disk Access by hand; feedback opens
 * the project's issue page with the text filled in, adding recent logs only when the user asks;
 * the Xcode licence fix opens Terminal and reports a Terminal that cannot be opened; the
 * diagnostics capture reports a login shell or environment it cannot read instead of inventing
 * one; the sidecar and app logs open in their default app, and a missing log path is an error
 * value.
 * Our design choice: one service for these Mac-level actions, so screens get them through
 * `Actions` like everything else and the Platform stays out of `features/`.
 * Built now: the program store, the install, re-download and remove actions, the send gate,
 * opening the Privacy & Security pane for Full Disk Access, the diagnostics capture, opening the
 * sidecar and app logs, copying, saving and opening an attachment in its own app (CHAT-29), and
 * sending feedback (APP-09).
 * Our design choice: a copy that failed or is missing does not hold a message, so a copy on the
 * user's PATH runs instead (D021). Conductor holds until the copy is ready.
 * Test first: install while a download of the same program runs starts no second download.
 *
 * @feature APP-09 Send feedback
 * Owns: turning the feedback form into a new issue on the project's GitHub page.
 * Behaviour: ui-map.md 5.2 (the Feedback dialog's message, email, images and recent logs),
 * native-and-sidecar-map.md A5 (Help > Send Feedback).
 * Must handle: an empty message is refused; a failed log export or read is reported instead of
 * opening an issue without the logs the user asked for; a message longer than an issue title
 * becomes a shorter title; images are listed in the body because a browser link cannot attach
 * them; logs that would make the link longer than `MAX_FEEDBACK_URL_CHARS` keep only their most
 * recent whole lines, and when not one line fits the issue says the logs were left out; a message
 * or image list too long for the link on its own is refused with a message, and nothing opens.
 * Our design choice: Conductor posts the feedback to its own service; ours opens the project's
 * issue page, as the backlog row says. The dialog is features/diagnostics/FeedbackDialog.tsx.
 * Test first: a message, email, image and logs become a GitHub issue URL that holds all four.
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
import type { AgentInstall } from "@conducted/protocol";
import {
	type AgentKind,
	appError,
	err,
	type ManagedProgram,
	messageOf,
	ok,
	type Result,
} from "@conducted/shared";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { Platform, ProgramState } from "../../platform/platform.ts";
import type { FeedbackInput, Loadable } from "../api.ts";
import { programsBinDir } from "../app-paths.ts";
import { createSingleFlight } from "../async/single-flight.ts";
import { copyFileKeepingMode } from "../fs-helpers.ts";
import { openXcodeLicenseTerminal } from "../git/xcode-license.ts";
import { isImagePath } from "../media-files.ts";
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

/**
 * The programs the Advanced page lists. gh and watchexec are managed too (PLAT-35) but stay off
 * it, as Conductor lists only its agent programs there (ui-map 7.4). Cursor's SDK is listed: it
 * installs only from there, because it is never bundled (AGENT-09, D083).
 */
const AGENT_PROGRAMS: readonly ManagedProgram[] = ["claude", "codex", "cursor"];

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

/**
 * Reads an image file as base64 PNG. `sips` converts whatever the file holds; the temporary PNG
 * is removed by the shell that made it. The path arrives as an argument, so a name with spaces or
 * shell characters is not interpreted.
 */
const COPY_IMAGE_SCRIPT = `out=$(mktemp -t conducted-image)
trap 'rm -f "$out"' EXIT
sips -s format png "$1" --out "$out" >/dev/null 2>&1 || exit 1
base64 -i "$out"`;

/** Base64 text, with any line breaks `base64` adds, as bytes. */
function decodeBase64(text: string): Uint8Array {
	const binary = atob(text.replace(/\s+/g, ""));
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}
	return bytes;
}

/** The project's new-issue page. The feedback form fills its title and body. */
export const FEEDBACK_ISSUE_URL = "https://github.com/jahala/conducted/issues/new";
/** Longest title the issue page gets; the rest of the message stays in the body. */
const MAX_FEEDBACK_TITLE = 120;
/**
 * Longest issue link the feedback opens. GitHub refuses very long new-issue links, so the logs
 * are cut from the front until the link fits, and a message that alone is too long is refused.
 * Our dial: the research has no number.
 */
export const MAX_FEEDBACK_URL_CHARS = 8_000;

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
		if (agent !== "claude" && agent !== "codex" && agent !== "cursor") return false;
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
	async copyImage(path: string): Promise<Result<void>> {
		const read = await this.#deps.platform.shell.run({
			program: "sh",
			args: ["-c", COPY_IMAGE_SCRIPT, "conducted-copy-image", path],
			cwd: this.#deps.platform.fs.paths.home,
		});
		if (!read.ok) return read;
		if (read.value.exitCode !== 0) {
			return err(
				appError("image_read_failed", read.value.stderr.trim() || "The image could not be read."),
			);
		}
		let bytes: Uint8Array;
		try {
			bytes = decodeBase64(read.value.stdout);
		} catch (cause) {
			return err(appError("image_read_failed", "The image could not be read.", cause));
		}
		try {
			await this.#deps.platform.clipboard.writeImage(bytes);
			return ok(undefined);
		} catch (cause) {
			return err(
				appError("clipboard_write_failed", "Could not copy the image to the clipboard.", cause),
			);
		}
	}

	/** Backs `Actions.attachments.saveAs`. */
	async saveAs(path: string): Promise<Result<string | null>> {
		let destination: string | null;
		try {
			destination = await this.#deps.platform.dialogs.pickSavePath({
				title: isImagePath(path) ? "Save image" : "Save file",
				defaultPath: path.slice(path.lastIndexOf("/") + 1),
			});
		} catch (cause) {
			return err(appError("save_dialog_failed", "The save dialog could not be opened.", cause));
		}
		if (destination === null) return ok(null);
		const copied = await copyFileKeepingMode(this.#deps.platform.shell, path, destination);
		return copied.ok ? ok(destination) : copied;
	}

	/** Backs `Actions.attachments.openExternally`. */
	openExternally(path: string): Promise<Result<void>> {
		return this.#openPath(path, "file_open_failed", "The file could not be opened.");
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
		const url = feedbackUrl({
			message,
			email,
			imagePaths,
			logs,
			version: this.#deps.platform.app.version,
			channel: this.#deps.platform.app.channel,
		});
		if (!url.ok) return url;
		try {
			await this.#deps.platform.opener.openUrl(url.value);
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
		return ok(read.value.trimEnd());
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
		return this.#openPath(path, "log_open_failed", "The log file could not be opened.");
	}

	async #openPath(
		path: string,
		failureCode: string,
		failureMessage: string,
	): Promise<Result<void>> {
		const opened = await this.#deps.platform.shell.run({
			program: "open",
			args: [path],
			cwd: this.#deps.platform.fs.paths.home,
		});
		if (!opened.ok) return opened;
		if (opened.value.exitCode !== 0) {
			const reason = opened.value.stderr.trim();
			return err(appError(failureCode, reason === "" ? failureMessage : reason));
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

/** Claude first, then Codex, then Cursor's SDK, so the Advanced page keeps a stable order. */
function orderOf(program: ManagedProgram): number {
	if (program === "claude") return 0;
	if (program === "codex") return 1;
	if (program === "cursor") return 2;
	return 3;
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
	/** The log text to include, or null for none. */
	logs: string | null;
	/** The user asked for logs and none fit in the link, so the body says so. */
	logsLeftOut: boolean;
	version: string;
	channel: string;
}

const LOGS_CUT_NOTE = "(Only the most recent lines fit in the link.)";
const LOGS_LEFT_OUT_NOTE = "(Logs left out: they did not fit in the link.)";

function issueUrl(title: string, body: string): string {
	return `${FEEDBACK_ISSUE_URL}?${new URLSearchParams({ title, body }).toString()}`;
}

/** The whole lines among the last `kept` characters of the logs. */
function recentLines(logs: string, kept: number): string {
	if (kept >= logs.length) return logs;
	const tail = logs.slice(logs.length - kept);
	if (logs[logs.length - kept - 1] === "\n") return tail;
	const lineStart = tail.indexOf("\n");
	return lineStart === -1 ? "" : tail.slice(lineStart + 1);
}

/**
 * The new-issue link, never longer than `MAX_FEEDBACK_URL_CHARS`. Logs that do not fit keep only
 * their most recent whole lines, found by a binary search over how much of the end is kept; when
 * not one line fits, the body says the logs were left out. A message or image list that alone
 * makes the link too long is an error, so the user can shorten it instead of losing part of it.
 */
function feedbackUrl(input: Omit<FeedbackBodyInput, "logsLeftOut">): Result<string> {
	const title = feedbackTitle(input.message);
	const urlWith = (logs: string | null, logsLeftOut: boolean): string =>
		issueUrl(title, feedbackBody({ ...input, logs, logsLeftOut }));
	const whole = urlWith(input.logs, false);
	if (whole.length <= MAX_FEEDBACK_URL_CHARS) return ok(whole);
	const logs = input.logs;
	if (logs !== null) {
		const withTail = (kept: number): string =>
			urlWith(`${LOGS_CUT_NOTE}\n${recentLines(logs, kept)}`, false);
		let low = 0;
		let high = logs.length - 1;
		while (low < high) {
			const middle = Math.ceil((low + high) / 2);
			if (withTail(middle).length <= MAX_FEEDBACK_URL_CHARS) low = middle;
			else high = middle - 1;
		}
		if (recentLines(logs, low) !== "" && withTail(low).length <= MAX_FEEDBACK_URL_CHARS) {
			return ok(withTail(low));
		}
		const leftOut = urlWith(null, true);
		if (leftOut.length <= MAX_FEEDBACK_URL_CHARS) return ok(leftOut);
	}
	return err(
		appError(
			"feedback_too_long",
			"The message is too long for the issue link. Shorten it and send again.",
		),
	);
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
	} else if (input.logsLeftOut) {
		parts.push(LOGS_LEFT_OUT_NOTE);
	}
	return parts.join("\n\n");
}
