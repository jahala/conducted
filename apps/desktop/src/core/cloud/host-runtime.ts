/**
 * @feature CLOUD-03 The user's Worker and one Durable Object per workspace: routes, state, keep-alive, relay
 * Owns: the cloud half of a workspace's git, shell and file calls: the routes it asks the Worker
 * for and the answers it turns back into the Platform's shapes, and the Platform adapter that
 * sends a cloud folder's calls there instead of to the Mac.
 * Behaviour: docs/plans/cloud-and-remote.md Part 1 (the Worker runs git, shell and files in the
 * sandbox) and services-map.md 1.2 (a shell call is a program and its arguments; the answer is
 * stdout, stderr and an exit code).
 * Must handle: a Worker answer that is not JSON, a 401 (not paired), another non-2xx answer and a
 * network failure each become an Err with a plain message; a local folder is untouched and goes to
 * the Mac exactly as before; a cloud folder never falls back to the Mac. The pairing token is
 * added in Rust, so it is never part of a request here.
 * Our design choice: a cloud workspace's stored folder is its absolute path in the sandbox, so the
 * same cwd is sent unchanged and the Worker runs it there. D101 records it.
 * Test first: a cloud shell call reaches the Worker's route, and a local one stays on the Mac.
 */
import type { Host } from "@conducted/protocol";
import { appError, err, ok, type Result } from "@conducted/shared";
import type {
	Cloud,
	CloudResponse,
	FileStat,
	FileSystem,
	Platform,
	Shell,
	ShellCommand,
	ShellOutput,
} from "../../platform/platform.ts";

type CloudHost = Extract<Host, { kind: "cloud" }>;

/** Base64 of raw bytes, built in slices so a large file does not overflow the argument list. */
function encodeBase64(bytes: Uint8Array): string {
	const SLICE = 0x8000;
	let binary = "";
	for (let start = 0; start < bytes.length; start += SLICE) {
		binary += String.fromCharCode(...bytes.subarray(start, start + SLICE));
	}
	return btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
	const binary = atob(value);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
	return bytes;
}

/** How long a git, shell or file call may take; a build can be slow, so this catches only a hang. */
export const CLOUD_CALL_TIMEOUT_MS = 10 * 60 * 1000;

/** The Worker's error text, when it sent one. */
function workerMessage(answer: CloudResponse): string {
	try {
		const parsed = JSON.parse(answer.body) as { error?: unknown };
		if (typeof parsed.error === "string" && parsed.error.length > 0) return parsed.error;
	} catch {
		// Not JSON; the status line below is the message.
	}
	return `The Workspace answered ${answer.status}.`;
}

/** One JSON request to a workspace's Durable Object. */
export async function cloudJson(
	cloud: Cloud,
	host: CloudHost,
	route: string,
	body?: unknown,
	timeoutMs: number = CLOUD_CALL_TIMEOUT_MS,
): Promise<Result<unknown>> {
	const answer = await cloud.request({
		url: host.url,
		method: body === undefined ? "GET" : "POST",
		path: `/w/${host.vmId}${route}`,
		...(body === undefined ? {} : { body }),
		timeoutMs,
	});
	if (!answer.ok) return answer;
	if (answer.value.status === 401) {
		return err(
			appError(
				"cloud_not_paired",
				"The Worker refused the pairing token. Pair this Mac with the Workspace again.",
			),
		);
	}
	if (answer.value.status < 200 || answer.value.status >= 300) {
		return err(appError("cloud_request_failed", workerMessage(answer.value)));
	}
	try {
		return ok(JSON.parse(answer.value.body));
	} catch {
		return err(
			appError("cloud_bad_response", "The Workspace answered with something other than JSON."),
		);
	}
}

/** Runs one command in a workspace's sandbox. Git takes its own route. */
export async function runCloudShell(
	cloud: Cloud,
	host: CloudHost,
	command: ShellCommand,
): Promise<Result<ShellOutput>> {
	const isGit = command.program === "git";
	const body = isGit
		? { args: command.args, cwd: command.cwd }
		: {
				program: command.program,
				args: command.args,
				cwd: command.cwd,
				...(command.env === undefined ? {} : { env: command.env }),
				...(command.stdin === undefined ? {} : { stdin: command.stdin }),
				...(command.timeoutMs === undefined ? {} : { timeoutMs: command.timeoutMs }),
			};
	const answer = await cloudJson(cloud, host, isGit ? "/git" : "/exec", body);
	if (!answer.ok) return answer;
	const value = answer.value as { exitCode?: unknown; stdout?: unknown; stderr?: unknown };
	if (
		typeof value.exitCode !== "number" ||
		typeof value.stdout !== "string" ||
		typeof value.stderr !== "string"
	) {
		return err(
			appError(
				"cloud_bad_response",
				"The Workspace's command answer was not what the app expected.",
			),
		);
	}
	return ok({ exitCode: value.exitCode, stdout: value.stdout, stderr: value.stderr });
}

/** One file operation in a workspace's sandbox. */
export async function cloudFile(
	cloud: Cloud,
	host: CloudHost,
	body: Record<string, unknown>,
): Promise<Result<unknown>> {
	return cloudJson(cloud, host, "/files", body);
}

/** The Platform's FileStat from the Worker's plain object. */
function toFileStat(value: unknown): FileStat | null {
	if (typeof value !== "object" || value === null) return null;
	const stat = value as {
		path?: unknown;
		isDirectory?: unknown;
		isSymlink?: unknown;
		size?: unknown;
		modifiedAt?: unknown;
	};
	if (
		typeof stat.path !== "string" ||
		typeof stat.isDirectory !== "boolean" ||
		typeof stat.isSymlink !== "boolean" ||
		typeof stat.size !== "number" ||
		typeof stat.modifiedAt !== "number"
	) {
		return null;
	}
	return {
		path: stat.path,
		isDirectory: stat.isDirectory,
		isSymlink: stat.isSymlink,
		size: stat.size,
		modifiedAt: stat.modifiedAt,
	};
}

/** Runs one file operation and reads the named field of its answer. */
async function fileOperation<T>(
	cloud: Cloud,
	host: CloudHost,
	body: Record<string, unknown>,
	read: (value: unknown) => T | null,
): Promise<Result<T>> {
	const answer = await cloudFile(cloud, host, body);
	if (!answer.ok) return answer;
	const value = read(answer.value);
	return value === null
		? err(
				appError(
					"cloud_bad_response",
					"The Workspace's file answer was not what the app expected.",
				),
			)
		: ok(value);
}

/**
 * The Platform with a cloud workspace's shell and file calls sent to its Worker. Everything else,
 * including the local folders of a Mac workspace, goes to the original Platform unchanged.
 */
export function createHostedPlatform(
	platform: Platform,
	hostAt: (path: string) => CloudHost | null,
): Platform {
	const cloud = platform.cloud;
	const shell: Shell = {
		run: (command) => {
			const host = hostAt(command.cwd);
			return host === null ? platform.shell.run(command) : runCloudShell(cloud, host, command);
		},
		start: (command) => {
			const host = hostAt(command.cwd);
			if (host === null) return platform.shell.start(command);
			return {
				id: crypto.randomUUID(),
				done: runCloudShell(cloud, host, command),
				cancel: async () => {},
			};
		},
		loginEnv: (cwd) => {
			const host = cwd === undefined ? null : hostAt(cwd);
			if (host === null) return platform.shell.loginEnv(cwd);
			// The sandbox image fixes its own PATH (the CLOUD-02 image); no login shell runs there.
			return Promise.resolve({
				shell: "/bin/bash",
				path: "/usr/local/bin:/usr/bin:/bin",
				zdotdir: null,
			});
		},
	};
	const fs: FileSystem = {
		readText: (path) => {
			const host = hostAt(path);
			return host === null
				? platform.fs.readText(path)
				: fileOperation(cloud, host, { operation: "read", path }, (value) => {
						const text = (value as { text?: unknown }).text;
						return typeof text === "string" ? text : null;
					});
		},
		readBytes: (path) => {
			const host = hostAt(path);
			return host === null
				? platform.fs.readBytes(path)
				: fileOperation(cloud, host, { operation: "readBytes", path }, (value) => {
						const base64 = (value as { base64?: unknown }).base64;
						return typeof base64 === "string" ? decodeBase64(base64) : null;
					});
		},
		writeTextAtomic: (path, text) => {
			const host = hostAt(path);
			return host === null
				? platform.fs.writeTextAtomic(path, text)
				: fileOperation(cloud, host, { operation: "write", path, text }, () => undefined);
		},
		writeBytes: (path, bytes) => {
			const host = hostAt(path);
			return host === null
				? platform.fs.writeBytes(path, bytes)
				: fileOperation(
						cloud,
						host,
						{ operation: "writeBytes", path, base64: encodeBase64(bytes) },
						() => undefined,
					);
		},
		exists: (path) => {
			const host = hostAt(path);
			return host === null
				? platform.fs.exists(path)
				: fileOperation(cloud, host, { operation: "exists", path }, (value) => {
						const exists = (value as { exists?: unknown }).exists;
						return typeof exists === "boolean" ? exists : null;
					}).then((result) => (result.ok ? result.value : false));
		},
		stat: (path) => {
			const host = hostAt(path);
			return host === null
				? platform.fs.stat(path)
				: fileOperation(cloud, host, { operation: "stat", path }, (value) =>
						toFileStat((value as { stat?: unknown }).stat),
					);
		},
		mkdirp: (path) => {
			const host = hostAt(path);
			return host === null
				? platform.fs.mkdirp(path)
				: fileOperation(cloud, host, { operation: "mkdirp", path }, () => undefined);
		},
		readDir: (path) => {
			const host = hostAt(path);
			return host === null
				? platform.fs.readDir(path)
				: fileOperation(cloud, host, { operation: "readDir", path }, (value) => {
						const entries = (value as { entries?: unknown }).entries;
						if (!Array.isArray(entries)) return null;
						const stats: FileStat[] = [];
						for (const entry of entries) {
							const stat = toFileStat(entry);
							if (stat !== null) stats.push(stat);
						}
						return stats;
					});
		},
		trash: (path) => {
			const host = hostAt(path);
			return host === null
				? platform.fs.trash(path)
				: fileOperation(cloud, host, { operation: "trash", path }, () => undefined);
		},
		registerRoot: (path) => platform.fs.registerRoot(path),
		assetUrl: (path) => platform.fs.assetUrl(path),
		paths: platform.fs.paths,
	};
	return { ...platform, shell, fs };
}
