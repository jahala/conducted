/**
 * @feature CLOUD-12 SSH into a cloud workspace and open it in a local editor
 * Owns: the Mac's SSH key and config for cloud workspaces, the local SSH listener a cloud
 * workspace's door needs, and the editor commands VS Code, Cursor and Zed run against it.
 * Behaviour: Conductor's cloud SSH door (`services-map.md` 5A.3.3): a key made and kept on the
 * Mac, its public half authorized in the sandbox, a `Host <name>.conducted` entry included from
 * `~/.ssh/config`, and `code`/`cursor`/`zed` opened over that host. Our names use `conducted`
 * (D119). D110's research does not describe Conductor's hosted backend, so the tunnel route and
 * key-install route are ours.
 * Must handle: a missing or unreadable key (generated once, then an error if it still fails); a
 * Worker that refuses the key (its own message); a missing free local port; an app that is not
 * one of the three remote editors (Conductor's exact refusal); a Zed CLI that is not on PATH (the
 * app bundle's own `cli` is tried); an existing `~/.ssh/config` (only the include line is added,
 * never replaced); a missing `~/.ssh` folder (created).
 * Our design choice: the private key lives at `~/.conducted/ssh/id_ed25519` and is generated with
 * the Mac's `ssh-keygen`; only the `.pub` text ever leaves the Mac. The SSH listener's forward id
 * carries the workspace and host name (`ssh:<workspaceId>:<hostname>`), so the config can be
 * regenerated from the running forwards without a second store.
 * Test first: a public key is installed through the Worker, the config names 127.0.0.1, and
 * Cursor opens with `--remote ssh-remote+<host>.conducted`.
 */
import type { Host } from "@conducted/protocol";
import { type AppError, appError, err, ok, type Result, type WorkspaceId } from "@conducted/shared";
import type {
	Cloud,
	FileSystem,
	Opener,
	Platform,
	PortForwarding,
	Shell,
} from "../../platform/platform.ts";
import type { Workspace } from "../model.ts";
import { expandSshKeyPath, readCustomPublicKey } from "../ssh-key.ts";
import { cloudJson } from "./host-runtime.ts";

type CloudHost = Extract<Host, { kind: "cloud" }>;

/** The suffix every SSH config host this app writes ends with. */
export const SSH_HOST_SUFFIX = ".conducted";
/** Conductor's refusal for an app it cannot open a cloud workspace in. */
export const REMOTE_OPEN_UNSUPPORTED = "Remote open is only supported for VS Code, Cursor, and Zed";
/** Where the key pair lives, under the Mac's home folder. */
export const SSH_KEY_FOLDER = ".conducted/ssh";
export const SSH_KEY_NAME = "id_ed25519";
/** The SSH config files this app owns under `~/.ssh`. */
export const SSH_CONFIG_NAME = "conducted_config";
export const SSH_CONFIG_DIR_NAME = "conducted_config.d";
export const SSH_APP_CONFIG_NAME = "ssh.config";

/** The apps Conductor opens a cloud workspace in remotely. */
export function remoteOpenSupported(appName: string): boolean {
	return appName === "Cursor" || appName === "Visual Studio Code" || appName === "Zed";
}

/** The host names and local port as the config writes them. */
export interface SshHostEntry {
	hostnames: string[];
	localPort: number;
}

/** A ready SSH door for one cloud workspace. */
export interface SshSession {
	hostname: string;
	localPort: number;
	/** The command shown by "Copy SSH command". */
	command: string;
}

/** A host name from a folder or branch name: letters, digits, dash and underscore. */
export function sanitizeSshHostname(value: string): string {
	const cleaned = value
		.trim()
		.replace(/[^a-zA-Z0-9_-]/g, "-")
		.replace(/^-+|-+$/g, "");
	return cleaned === "" ? "workspace" : cleaned.slice(0, 48);
}

/** The names a workspace answers to: its folder, and its branch when that differs. */
export function sshHostnames(workspace: Pick<Workspace, "directoryName" | "branch">): string[] {
	const folder = sanitizeSshHostname(workspace.directoryName);
	const branch = sanitizeSshHostname(workspace.branch);
	return branch === folder ? [folder] : [folder, branch];
}

/** `ssh <hostname>.conducted`, the text "Copy SSH command" puts on the clipboard. */
export function sshCommand(hostname: string): string {
	return `ssh ${hostname}${SSH_HOST_SUFFIX}`;
}

/** The include line `~/.ssh/config` gains, once. */
export function conductedIncludeLine(configPath: string): string {
	return `Include ${configPath}`;
}

/**
 * The `~/.ssh/config` text with our include line in front, or null when it is already there.
 * Nothing else in the file is touched.
 */
export function withConductedInclude(existing: string, includeLine: string): string | null {
	const present = existing.split("\n").some((line) => line.trim() === includeLine.trim());
	if (present) return null;
	return `${includeLine}\n\n${existing}`;
}

/** The per-app config text: one Host block per workspace, loopback only. */
export function sshConfigText(input: {
	entries: readonly SshHostEntry[];
	keyPath: string;
	/** Set when the Mac's ssh knows the post-quantum exchange Conductor prefers. */
	postQuantum: boolean;
}): string {
	const lines = [
		"# Auto-generated by Conducted. Do not edit.",
		"",
		"IgnoreUnknown WarnWeakCrypto",
		"",
	];
	for (const entry of input.entries) {
		const names = entry.hostnames.map((hostname) => `${hostname}${SSH_HOST_SUFFIX}`).join(" ");
		lines.push(`Host ${names}`);
		lines.push("    HostName 127.0.0.1");
		lines.push(`    Port ${entry.localPort}`);
		lines.push("    User root");
		lines.push(`    IdentityFile ${input.keyPath}`);
		if (input.postQuantum) {
			lines.push("    KexAlgorithms ^sntrup761x25519-sha512@openssh.com");
		}
		lines.push("    WarnWeakCrypto no-pq-kex");
		lines.push("    StrictHostKeyChecking no");
		lines.push("    UserKnownHostsFile /dev/null");
		lines.push("");
	}
	return lines.join("\n");
}

/** The main `~/.ssh/conducted_config` text: our per-app file, included. */
export function conductedConfigText(appConfigPath: string): string {
	return [
		"# Auto-generated by Conducted. Do not edit.",
		"",
		conductedIncludeLine(appConfigPath),
		"",
	].join("\n");
}

/** The forward id that lets the config be rebuilt from the running forwards. */
export function sshForwardId(workspaceId: WorkspaceId, hostnames: readonly string[]): string {
	return `ssh:${workspaceId}:${hostnames.join(",")}`;
}

/** The workspace and host names inside a forward id this module made. */
export function parseSshForwardId(
	forwardId: string,
): { workspaceId: string; hostnames: string[] } | null {
	if (!forwardId.startsWith("ssh:")) return null;
	const rest = forwardId.slice("ssh:".length);
	const colon = rest.indexOf(":");
	if (colon <= 0 || colon === rest.length - 1) return null;
	const hostnames = rest
		.slice(colon + 1)
		.split(",")
		.filter((name) => name !== "");
	if (hostnames.length === 0) return null;
	return { workspaceId: rest.slice(0, colon), hostnames };
}

/** The SSH entries of the forwards that are running now, in a stable order. */
export function sshEntries(
	forwards: readonly { forwardId: string; localPort: number; remotePort: number }[],
): SshHostEntry[] {
	const entries: SshHostEntry[] = [];
	for (const forward of forwards) {
		if (forward.remotePort !== 22) continue;
		const parsed = parseSshForwardId(forward.forwardId);
		if (parsed === null) continue;
		entries.push({ hostnames: parsed.hostnames, localPort: forward.localPort });
	}
	return entries.sort((left, right) =>
		(left.hostnames[0] ?? "").localeCompare(right.hostnames[0] ?? ""),
	);
}

/** The parts of the Platform the SSH door uses. */
export interface SshDeps {
	fs: Pick<FileSystem, "paths" | "exists" | "readText" | "writeTextAtomic" | "mkdirp">;
	shell: Pick<Shell, "run">;
	opener: Pick<Opener, "openRemote">;
	portForward: PortForwarding;
	cloud: Cloud;
	/** The `ssh_key_path` setting; empty means the auto-generated key. */
	sshKeyPath: () => string;
}

/** Picks a host name no other running SSH forward uses. */
function uniqueHostname(workspace: Workspace, taken: ReadonlySet<string>): string {
	for (const candidate of sshHostnames(workspace)) {
		if (!taken.has(candidate)) return candidate;
	}
	for (let index = 2; ; index += 1) {
		const candidate = `${sanitizeSshHostname(workspace.directoryName)}-${index}`;
		if (!taken.has(candidate)) return candidate;
	}
}

/** The key path and its public text: the chosen key, or generated once when none is chosen. */
async function ensureKey(
	deps: SshDeps,
	customKeyPath: string,
): Promise<Result<{ keyPath: string; publicKey: string }>> {
	const custom = customKeyPath.trim();
	if (custom !== "") {
		const keyPath = expandSshKeyPath(custom, deps.fs.paths.home);
		// Through the shell, as Conductor reads it: the file commands do not reach `~/.ssh`, and a
		// refusal there would read as a missing key (issue #601).
		const publicKey = await readCustomPublicKey(deps.shell, keyPath, deps.fs.paths.home);
		if (!publicKey.ok) return publicKey;
		return ok({ keyPath, publicKey: publicKey.value });
	}
	const folder = `${deps.fs.paths.home}/${SSH_KEY_FOLDER}`;
	const keyPath = `${folder}/${SSH_KEY_NAME}`;
	const present = await deps.fs.exists(keyPath);
	if (!present.ok) return present;
	if (!present.value) {
		const folderMade = await deps.fs.mkdirp(folder);
		if (!folderMade.ok) return folderMade;
		const generated = await deps.shell.run({
			program: "ssh-keygen",
			args: ["-t", "ed25519", "-N", "", "-f", keyPath, "-C", "conducted"],
			cwd: folder,
		});
		if (!generated.ok) return generated;
		if (generated.value.exitCode !== 0) {
			return err(
				appError(
					"ssh_key_failed",
					generated.value.stderr.trim() || "ssh-keygen could not make an SSH key.",
				),
			);
		}
	}
	const publicKey = await deps.fs.readText(`${keyPath}.pub`);
	if (!publicKey.ok) return publicKey;
	const text = publicKey.value.trim();
	if (text === "") return err(appError("ssh_key_failed", "The SSH public key is empty."));
	return ok({ keyPath, publicKey: text });
}

/** Whether this Mac's ssh offers the exchange Conductor asks for first. */
async function hasPostQuantumKex(deps: SshDeps): Promise<boolean> {
	const listed = await deps.shell.run({
		program: "ssh",
		args: ["-Q", "kex"],
		cwd: deps.fs.paths.home,
	});
	if (!listed.ok || listed.value.exitCode !== 0) return false;
	return listed.value.stdout
		.split("\n")
		.map((line) => line.trim())
		.includes("sntrup761x25519-sha512@openssh.com");
}

/** Writes both config files and adds the include line to the user's config if it is absent. */
async function writeConfig(
	deps: SshDeps,
	keyPath: string,
	forwards: readonly { forwardId: string; localPort: number; remotePort: number }[],
): Promise<Result<void>> {
	const sshDir = `${deps.fs.paths.home}/.ssh`;
	const appDir = `${sshDir}/${SSH_CONFIG_DIR_NAME}`;
	const appConfigPath = `${appDir}/${SSH_APP_CONFIG_NAME}`;
	const mainConfigPath = `${sshDir}/${SSH_CONFIG_NAME}`;
	const userConfigPath = `${sshDir}/config`;
	const made = await deps.fs.mkdirp(appDir);
	if (!made.ok) return made;
	const postQuantum = await hasPostQuantumKex(deps);
	const written = await deps.fs.writeTextAtomic(
		appConfigPath,
		sshConfigText({ entries: sshEntries(forwards), keyPath, postQuantum }),
	);
	if (!written.ok) return written;
	const main = await deps.fs.writeTextAtomic(mainConfigPath, conductedConfigText(appConfigPath));
	if (!main.ok) return main;
	const existing = await deps.fs.readText(userConfigPath);
	const before = existing.ok ? existing.value : "";
	const next = withConductedInclude(before, conductedIncludeLine(mainConfigPath));
	if (next !== null) {
		const saved = await deps.fs.writeTextAtomic(userConfigPath, next);
		if (!saved.ok) return saved;
	}
	return ok(undefined);
}

/** One 401 from the Worker means this Mac is not paired; anything else carries its own message. */
function workerFailure(status: number, body: string): AppError {
	if (status === 401) {
		return appError(
			"cloud_not_paired",
			"The Worker refused the pairing token. Pair this Mac with the Workspace again.",
		);
	}
	try {
		const parsed = JSON.parse(body) as { error?: unknown };
		if (typeof parsed.error === "string" && parsed.error !== "") {
			return appError("cloud_request_failed", parsed.error);
		}
	} catch {
		// Not JSON; the status is all the Worker said.
	}
	return appError("cloud_request_failed", `The Workspace answered ${status}.`);
}

/**
 * Makes sure the workspace's SSH door is open and its config entry is written: the Mac's public
 * key installed through the Worker at start, a local listener on the Worker's `/ssh` route, and
 * `~/.ssh/conducted_config` naming that listener. Running it twice reuses the same listener.
 */
export async function ensureSshSession(
	deps: SshDeps,
	workspace: Workspace,
): Promise<Result<SshSession>> {
	if (workspace.host.kind !== "cloud") {
		return err(appError("ssh_not_cloud", "Only a cloud workspace can be opened over SSH."));
	}
	const host: CloudHost = workspace.host;
	const key = await ensureKey(deps, deps.sshKeyPath());
	if (!key.ok) return key;

	const installed = await cloudJson(deps.cloud, host, "/ssh-key", {
		publicKey: key.value.publicKey,
	});
	if (!installed.ok) return installed;

	const listed = await deps.portForward.list();
	if (!listed.ok) return listed;
	const forwards = listed.value;
	const taken = new Set(
		forwards.flatMap((forward) => parseSshForwardId(forward.forwardId)?.hostnames ?? []),
	);
	const mine = forwards.find(
		(forward) =>
			forward.remotePort === 22 &&
			parseSshForwardId(forward.forwardId)?.workspaceId === workspace.id,
	);

	let hostnames: string[];
	let localPort: number;
	if (mine !== undefined) {
		const parsed = parseSshForwardId(mine.forwardId);
		hostnames = parsed?.hostnames ?? [uniqueHostname(workspace, taken)];
		localPort = mine.localPort;
	} else {
		hostnames = sshHostnames(workspace).filter((name) => !taken.has(name));
		if (hostnames.length === 0) hostnames = [uniqueHostname(workspace, taken)];
		const excluded = forwards.map((forward) => forward.localPort);
		const found = await deps.portForward.findAvailableLocalPort({
			excludedPorts: excluded,
			rangeStart: 20_000,
			rangeEnd: 29_999,
		});
		if (!found.ok) return found;
		localPort = found.value;
		const started = await deps.portForward.startSsh({
			forwardId: sshForwardId(workspace.id, hostnames),
			url: host.url,
			vmId: host.vmId,
			localPort,
		});
		if (!started.ok) return started;
	}

	const after = await deps.portForward.list();
	if (!after.ok) return after;
	const configured = await writeConfig(deps, key.value.keyPath, after.value);
	if (!configured.ok) return configured;
	const hostname = hostnames[0] as string;
	return ok({ hostname, localPort, command: sshCommand(hostname) });
}

/** Opens a cloud workspace's folder in one remote editor, through the SSH door. */
export async function openRemoteWorkspace(
	deps: SshDeps,
	workspace: Workspace,
	appName: string,
): Promise<Result<void>> {
	if (!remoteOpenSupported(appName)) {
		return err(appError("remote_open_unsupported", REMOTE_OPEN_UNSUPPORTED));
	}
	const session = await ensureSshSession(deps, workspace);
	if (!session.ok) return session;
	return deps.opener.openRemote({
		appName,
		host: `${session.value.hostname}${SSH_HOST_SUFFIX}`,
		path: workspace.path,
	});
}

/** The reusable Platform slice a WorkspaceService hands the SSH door. */
export type SshPlatform = Pick<Platform, "fs" | "shell" | "opener" | "portForward">;
