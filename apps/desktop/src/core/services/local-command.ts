/**
 * @feature CLOUD-14 Cloud agents ask to run commands on the Mac
 * Owns: the app's half of RunLocalCommand: the approval card a cloud agent's command asks for, the
 * Advanced settings that allow it, the per-chat approval, and running the command on this Mac.
 * Behaviour: research/conductor/claude-runner.md section 4.2 (the command, its 60/120/1800 second
 * limits, output over 32,000 characters saved to the workspace, and the three approval choices);
 * ui-map.md 3.3 ("...on your Mac?"), 6 ("Remote execution MCP", "Always allow local commands"),
 * services-map.md 5B.2.2 (a notification when a command waits for the user), 5B.6.
 * Must handle: a local workspace (the tool is only for a cloud one), the setting turned off, a
 * denial, a withdrawn request, an approval that is not given in time, a command that times out or
 * cannot start, a cwd with a null byte or a relative cwd, and output too long for the result.
 * Our design choice: the approval and the command run in the desktop app, because only the app has
 * the Mac's shell and the user; the sidecar inside the sandbox only forwards the request. The
 * interaction travels the app's existing interaction card and answer path, with a local marker so
 * an answer settles it here instead of at the sidecar. Session approvals live in memory for this
 * run; "Yes always" writes the `always_allow_local_execution` setting, which outlives it.
 * Test first: a command on a local workspace is refused before any card is shown.
 */
import {
	type Host,
	type InteractionAnswer,
	type InteractionRequest,
	LOCAL_COMMAND_APPROVAL_TIMEOUT_MS,
	LOCAL_COMMAND_OUTPUT_FILE_CHARS,
	LOCAL_COMMAND_OUTPUT_FOLDER,
	localCommandTimeoutMs,
} from "@conducted/protocol";
import type { InteractionId, Result, SessionId, ToolUseId } from "@conducted/shared";
import { appError, err, ok } from "@conducted/shared";
import type { FileSystem, Shell } from "../../platform/platform.ts";
import type { Workspace } from "../model.ts";

/** The Advanced setting that offers RunLocalCommand to a cloud chat. */
export const REMOTE_EXECUTION_SETTING = "internal_remote_local_execution_mcp";
/** The Advanced setting that skips the approval for every local command. */
export const ALWAYS_ALLOW_LOCAL_EXECUTION_SETTING = "always_allow_local_execution";

/** The tool name the approval card shows, so its title is "...on your Mac?". */
export const RUN_LOCAL_COMMAND_TOOL_NAME = "mcp__conducted__RunLocalCommand";

/**
 * True when a workspace on this host may ask the Mac to run a command: a cloud host, setting on.
 * A host that is not known (an incomplete context in a test harness) cannot ask the Mac.
 */
export function localExecutionForHost(
	host: Host | undefined,
	setting: <T>(key: string) => T,
): boolean {
	return host?.kind === "cloud" && setting<boolean>(REMOTE_EXECUTION_SETTING) !== false;
}

/** True when this workspace may ask the Mac to run a command. */
export function offersLocalExecution(
	workspace: Workspace,
	setting: <T>(key: string) => T,
): boolean {
	return localExecutionForHost(workspace.host, setting);
}

function sameCloudHost(host: Host, origin: Host | null): boolean {
	return (
		host.kind === "cloud" &&
		origin?.kind === "cloud" &&
		origin.url === host.url &&
		origin.vmId === host.vmId
	);
}

/** A RunLocalCommand request from the sidecar. */
export interface LocalCommandRequest {
	sessionId: SessionId;
	command: string;
	description?: string;
	reason?: string;
	cwd?: string;
	timeoutMs?: number;
	extendedTimeoutReason?: string;
}

/** The app's answer: the command's outcome, or why it did not run. */
export interface LocalCommandAnswer {
	code?: number;
	stdout?: string;
	stderr?: string;
	cwd?: string;
	error?: string;
	timedOut?: boolean;
	denied?: boolean;
	stdoutTruncated?: boolean;
	stderrTruncated?: boolean;
	outputPath?: string;
}

export interface LocalCommandServiceDeps {
	/** The chat's workspace, or an error when the chat is gone. */
	workspaceOfSession: (sessionId: SessionId) => Result<Workspace>;
	/** The Mac's shell, never the host-routed one: the command runs on this Mac by definition. */
	shell: Pick<Shell, "run">;
	/** The host-routed file system, so a cloud workspace's output file lands in its sandbox. */
	fs: Pick<FileSystem, "mkdirp" | "writeTextAtomic">;
	homePath: () => string;
	/** Shows the approval card and resolves with the user's answer. */
	openApproval: (request: InteractionRequest) => Promise<InteractionAnswer>;
	/** Removes a card whose approval was not given in time. */
	withdrawApproval: (interactionId: InteractionId) => void;
	/** The chat's notification path (CHAT-19). */
	notify: (input: {
		sessionId: SessionId;
		kind: "tool_approval";
		body: string;
	}) => Promise<Result<void>>;
	setting: <T>(key: string) => T;
	setSetting: (key: string, value: unknown) => Promise<Result<void>>;
	newId: () => string;
	log: (level: "warn" | "info", message: string) => void;
}

/** The folder a command runs in: the agent's, resolved against the Mac's home, or the home. */
export function resolveLocalCwd(requested: string | undefined, home: string): Result<string> {
	if (requested === undefined || requested.trim() === "") return ok(home);
	if (requested.includes("\0")) {
		return err(appError("local_command_bad_cwd", "The working folder cannot contain null bytes."));
	}
	if (requested.startsWith("/")) return ok(requested);
	return ok(`${home.replace(/\/$/, "")}/${requested}`);
}

/** Cuts stdout and stderr so together they fit the result, and says which was cut. */
export function truncateLocalOutput(
	stdout: string,
	stderr: string,
): {
	stdout: string;
	stderr: string;
	stdoutTruncated: boolean;
	stderrTruncated: boolean;
} {
	if (stdout.length >= LOCAL_COMMAND_OUTPUT_FILE_CHARS) {
		return {
			stdout: stdout.slice(0, LOCAL_COMMAND_OUTPUT_FILE_CHARS),
			stderr: "",
			stdoutTruncated: true,
			stderrTruncated: stderr.length > 0,
		};
	}
	const left = LOCAL_COMMAND_OUTPUT_FILE_CHARS - stdout.length;
	if (stderr.length > left) {
		return { stdout, stderr: stderr.slice(0, left), stdoutTruncated: false, stderrTruncated: true };
	}
	return { stdout, stderr, stdoutTruncated: false, stderrTruncated: false };
}

/** The app's RunLocalCommand: approval, then the Mac's shell. */
export class LocalCommandService {
	readonly #deps: LocalCommandServiceDeps;
	/** Approvals for one chat that the user gave for the rest of this app run. */
	readonly #sessionApprovals = new Set<string>();

	constructor(deps: LocalCommandServiceDeps) {
		this.#deps = deps;
	}

	/**
	 * `origin` is the host whose tunnel sent the request, or null for the Mac's own sidecar. A
	 * sandbox may only ask for a chat in its own workspace, so it cannot use another chat's approval.
	 */
	async run(request: LocalCommandRequest, origin: Host | null): Promise<LocalCommandAnswer> {
		const found = this.#deps.workspaceOfSession(request.sessionId);
		if (!found.ok) return { denied: true, error: found.error.message };
		const workspace = found.value;
		if (workspace.host.kind !== "cloud" || !sameCloudHost(workspace.host, origin)) {
			return { denied: true, error: "Local execution is not available for this workspace." };
		}
		if (this.#deps.setting<boolean>(REMOTE_EXECUTION_SETTING) === false) {
			return { denied: true, error: "Local execution is turned off." };
		}

		const cwdResult = resolveLocalCwd(request.cwd, this.#deps.homePath());
		if (!cwdResult.ok) return { denied: true, error: cwdResult.error.message };
		const cwd = cwdResult.value;

		if (!this.#isApproved(workspace.id, request.sessionId)) {
			const answered = await this.#askForApproval(workspace, request, cwd);
			if (answered === "denied") {
				return { denied: true, error: "The user denied local command execution." };
			}
			if (answered === "timed_out") {
				return {
					denied: true,
					error: "The user did not respond to the local command request in time.",
				};
			}
		}

		const timeoutMs = localCommandTimeoutMs(request);
		let result: Awaited<ReturnType<LocalCommandServiceDeps["shell"]["run"]>>;
		try {
			result = await this.#deps.shell.run({
				program: "/bin/bash",
				args: ["-lc", request.command],
				cwd,
				timeoutMs,
				envFromCwd: true,
			});
		} catch (cause) {
			return { cwd, error: cause instanceof Error ? cause.message : String(cause) };
		}
		if (!result.ok) {
			const timedOut = result.error.code === "shell_timeout";
			return { cwd, timedOut, error: result.error.message };
		}

		const output = result.value;
		const stdout = output.stdout;
		const stderr = output.stderr;
		if (stdout.length + stderr.length > LOCAL_COMMAND_OUTPUT_FILE_CHARS) {
			const saved = await this.#saveOutput(workspace.path, stdout, stderr);
			if (saved !== null) {
				return {
					code: output.exitCode,
					cwd,
					outputPath: saved,
					stdoutTruncated: true,
					stderrTruncated: stderr.length > 0,
				};
			}
		}
		return { code: output.exitCode, cwd, ...truncateLocalOutput(stdout, stderr) };
	}

	#isApproved(workspaceId: Workspace["id"], sessionId: SessionId): boolean {
		return (
			this.#deps.setting<boolean>(ALWAYS_ALLOW_LOCAL_EXECUTION_SETTING) === true ||
			this.#sessionApprovals.has(`${workspaceId}\0${sessionId}`)
		);
	}

	/** Shows the card and reads the answer, or gives up after Conductor's 110 second wait. */
	async #askForApproval(
		workspace: Workspace,
		request: LocalCommandRequest,
		cwd: string,
	): Promise<"allow" | "denied" | "timed_out"> {
		const interactionId = this.#deps.newId() as InteractionId;
		const card: InteractionRequest = {
			sessionId: request.sessionId,
			interactionId,
			interaction: {
				kind: "tool_approval",
				toolUseId: interactionId as unknown as ToolUseId,
				toolName: RUN_LOCAL_COMMAND_TOOL_NAME,
				input: {
					command: request.command,
					...(request.description === undefined ? {} : { description: request.description }),
					...(request.reason === undefined ? {} : { reason: request.reason }),
					cwd,
					...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
					...(request.extendedTimeoutReason === undefined
						? {}
						: { extendedTimeoutReason: request.extendedTimeoutReason }),
				},
				reason: "A remote agent wants to run a command on this Mac.",
			},
		};

		// Conductor shows "Approve local command: <command>", and a tool approval notifies even
		// when the user is looking at the chat.
		const notified = await this.#deps.notify({
			sessionId: request.sessionId,
			kind: "tool_approval",
			body: `Approve local command: ${request.command}`,
		});
		if (!notified.ok) {
			this.#deps.log("warn", `Could not notify about a local command: ${notified.error.message}`);
		}

		let timer: ReturnType<typeof setTimeout> | undefined;
		const timedOut = new Promise<"timed_out">((resolve) => {
			timer = setTimeout(() => resolve("timed_out"), LOCAL_COMMAND_APPROVAL_TIMEOUT_MS);
		});
		const answered = await Promise.race([this.#deps.openApproval(card), timedOut]);
		if (timer !== undefined) clearTimeout(timer);
		if (answered === "timed_out") {
			this.#deps.withdrawApproval(interactionId);
			return "timed_out";
		}
		if (answered.kind !== "tool_approval" || answered.decision === "deny") return "denied";
		if (answered.decision === "allow_for_session") {
			this.#sessionApprovals.add(`${workspace.id}\0${request.sessionId}`);
		}
		if (answered.decision === "always_allow") {
			const written = await this.#deps.setSetting(ALWAYS_ALLOW_LOCAL_EXECUTION_SETTING, true);
			if (!written.ok) {
				this.#deps.log(
					"warn",
					`Could not turn on "Always allow local commands": ${written.error.message}`,
				);
			}
		}
		return "allow";
	}

	/** Saves a long output in the workspace and returns its path, or null when the write failed. */
	async #saveOutput(workspacePath: string, stdout: string, stderr: string): Promise<string | null> {
		const folder = `${workspacePath.replace(/\/$/, "")}/${LOCAL_COMMAND_OUTPUT_FOLDER}`;
		const path = `${folder}/run-local-command-output-${this.#deps.newId()}.txt`;
		const made = await this.#deps.fs.mkdirp(folder);
		if (!made.ok) return null;
		const text = stderr.length === 0 ? stdout : `${stdout}\n\nStandard error:\n${stderr}`;
		const written = await this.#deps.fs.writeTextAtomic(path, text);
		return written.ok ? path : null;
	}
}
