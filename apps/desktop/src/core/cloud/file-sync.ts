/**
 * @feature CLOUD-11 Local mirror and file sync for a cloud workspace
 * Owns: the local mirror of a cloud workspace's files, the one-way sync that fills it, the
 * status the scripts panel and the file tab read, the file search root for a cloud workspace,
 * uploading a Mac file into the sandbox, and downloading a cloud file to Downloads.
 * Behaviour: docs/research/conductor/services-map.md 5A.5.5 and 5B.10.1 (a local mirror keeps a
 * cloud workspace usable by local tools; the direction is remote to local by default; the mirror
 * lives under the root's `remote-workspace-sync` folder), native-and-sidecar-map.md A10 (a path
 * guard rejects `..`, absolute paths, NUL and `.git`), ui-map.md 3.7 and 6 (the file-sync states
 * and the "Enable file sync in new cloud workspaces" setting).
 * Must handle: a stopped or unreachable Worker leaves the last mirror and a failed status; a path
 * outside the mirror is refused with "File is outside the synced workspace"; a file the sandbox
 * no longer has is removed from the mirror at the next sync; a file over the shared cloud read
 * limit (D120) is skipped, named in the baseline with its size, and never read again while its
 * listed size stays over it; a mirror larger than the Worker's list cap is reported as
 * truncated rather than exhausting the app; a reveal that fails says "Could not open Downloads.
 * Try again."; a preview of a Local variant with no mirror says "Couldn't open preview: local
 * workspace mirror is unavailable.".
 * Our design choice: the mirror is built from the Worker's `/files list` and `/files readBytes`
 * routes, so it needs no second transport and the pairing token stays in Rust. The sync runs when the
 * file tree or a search asks for it and last ran more than five seconds ago, which is Conductor's
 * poll interval; the Worker has no `file-sync:changed` push topic yet, so polling is the only
 * trigger. The mirror path is `<conducted root>/remote-workspace-sync/<repository>/<workspace id>`.
 * Text and binary files are mirrored at any size the Worker and the local read door can carry
 * (D120); a file over either bound is named in the baseline. The bytes go as base64 because the
 * route's body is JSON. Conductor also uploads local-only files into a new cloud workspace from
 * `file_include_globs`; that push waits for a cloud workspace creation flow to call it.
 * Test first: a remote file lands in the mirror, and `../outside` is refused.
 */
import type { Host } from "@conducted/protocol";
import {
	appError,
	CLOUD_MIRROR_FILE_LIMIT_BYTES,
	cloudReadLimitMessage,
	err,
	ok,
	type Result,
	type WorkspaceId,
	withinCloudReadLimit,
} from "@conducted/shared";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { Cloud, FileSystem, Opener } from "../../platform/platform.ts";
import type { Workspace } from "../model.ts";
import { cloudJson } from "./host-runtime.ts";

type CloudHost = Extract<Host, { kind: "cloud" }>;

/** The Advanced setting that starts sync in a new cloud workspace. */
export const AUTO_SYNC_SETTING = "auto_sync_files_in_new_cloud_workspaces";
/** The folder under the Conducted root that holds every cloud workspace's mirror. */
export const MIRROR_FOLDER = "remote-workspace-sync";
/** The baseline file's name, kept in a sibling metadata folder so it never shows in the file tree. */
export const BASELINE_FILE = "baseline.json";

/** The folder beside a mirror that holds its baseline. It cannot enter the mirror's own file tree. */
export const metadataPathFor = (mirrorPath: string): string => `${mirrorPath}.sync`;
/** How often a shown cloud workspace's files are polled (services-map.md 5B.10.1). */
export const SYNC_POLL_MS = 5_000;
/**
 * The largest file the mirror reads. D120: the live Worker answered 23 MiB and failed at 24 MiB,
 * where one base64 answer passes the Durable Object RPC's 32 MiB value; 16 MiB leaves 7 MiB of
 * margin. A dial: raise it only with a new measurement.
 */
export const MIRROR_FILE_LIMIT_BYTES = CLOUD_MIRROR_FILE_LIMIT_BYTES;
export const SYNC_OFF_LABEL = "Sync files is off";
export const SYNC_FOLDER_UNAVAILABLE_LABEL = "Sync folder unavailable";
export const SYNC_FAILED_LABEL = "Sync files failed";
export const LOCAL_TERMINAL_UNAVAILABLE_LABEL = "Local terminal unavailable";
export const OUTSIDE_MIRROR_MESSAGE = "File is outside the synced workspace";
export const OPEN_DOWNLOADS_FAILED_MESSAGE = "Could not open Downloads. Try again.";
/** Conductor's error when a local-mirror preview is opened before the mirror exists (CLOUD-11). */
export const PREVIEW_MIRROR_UNAVAILABLE_MESSAGE =
	"Couldn't open preview: local workspace mirror is unavailable.";

/** One workspace's sync status, as the service keeps it. */
export interface FileSyncStatus {
	state: "idle" | "syncing" | "synced" | "failed";
	mirrorPath: string;
	lastSyncedAt: number | null;
	error: string | null;
	files: number;
	truncated: boolean;
}

/**
 * What a screen shows. `local` is a Mac workspace, which has no sync; `off` is the setting turned
 * off before a mirror exists; `unavailable` means the mirror folder is gone.
 */
export type FileSyncView =
	| { state: "local" }
	| { state: "off"; label: typeof SYNC_OFF_LABEL }
	| {
			state: "unavailable";
			label: typeof SYNC_FOLDER_UNAVAILABLE_LABEL;
			localTerminalLabel: typeof LOCAL_TERMINAL_UNAVAILABLE_LABEL;
	  }
	| { state: "syncing"; label: string; mirrorPath: string }
	| {
			state: "synced";
			label: string;
			mirrorPath: string;
			lastSyncedAt: number;
			files: number;
			truncated: boolean;
	  }
	| { state: "failed"; label: typeof SYNC_FAILED_LABEL; message: string };

export interface FileSyncState {
	byWorkspace: Readonly<Record<string, FileSyncStatus>>;
	engaged: Readonly<Record<string, boolean>>;
}

interface Baseline {
	version: 1;
	remoteRoot: string;
	syncedAt: number;
	files: string[];
	skipped: { path: string; reason: string; size: number | null }[];
	truncated: boolean;
}

const emptyStatus = (mirrorPath: string): FileSyncStatus => ({
	state: "idle",
	mirrorPath,
	lastSyncedAt: null,
	error: null,
	files: 0,
	truncated: false,
});

/** The mirror root of one workspace. A repository name cannot escape the root. */
export function mirrorPathFor(
	rootPath: string,
	repoName: string,
	workspaceId: WorkspaceId,
): string {
	const safeRepo = repoName.replace(/[/:\\]/g, "-") || "repository";
	return `${rootPath.replace(/\/+$/, "")}/${MIRROR_FOLDER}/${safeRepo}/${workspaceId}`;
}

/**
 * The one path rule for a mirror entry and an upload destination: relative, inside the mirror,
 * no NUL byte and no `.git` folder. Returns the path without a leading `./`.
 */
export function guardedRelativePath(path: string): Result<string> {
	if (path.length === 0) {
		return err(appError("cloud_path_outside_mirror", OUTSIDE_MIRROR_MESSAGE));
	}
	if (path.includes("\u0000") || path.startsWith("/") || path.startsWith("\\")) {
		return err(appError("cloud_path_outside_mirror", OUTSIDE_MIRROR_MESSAGE));
	}
	const parts = path.split("/").filter((part) => part.length > 0 && part !== ".");
	if (parts.some((part) => part === ".." || part === ".git")) {
		return err(appError("cloud_path_outside_mirror", OUTSIDE_MIRROR_MESSAGE));
	}
	if (parts.length === 0) {
		return err(appError("cloud_path_outside_mirror", OUTSIDE_MIRROR_MESSAGE));
	}
	return ok(parts.join("/"));
}

/** True for text the mirror can hold as source: valid UTF-8 with no NUL byte. */
export function isMirroredText(text: string): boolean {
	return !text.includes("\u0000") && !text.includes("\uFFFD");
}

/** The text of some bytes, or null when they are binary. A NUL byte makes a file binary. */
function textFromBytes(bytes: Uint8Array): string | null {
	let text: string;
	try {
		text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		return null;
	}
	return isMirroredText(text) ? text : null;
}

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

/** The relative path of an absolute sandbox entry under `root`, or null when outside it. */
function relativeToRoot(root: string, path: string): string | null {
	const base = root.replace(/\/+$/, "");
	if (path === base) return "";
	const prefix = `${base}/`;
	return path.startsWith(prefix) ? path.slice(prefix.length) : null;
}

/** Reads a JSON object from a Worker answer, or null. */
function objectOf(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

export interface FileSyncDeps {
	cloud: Cloud;
	fs: Pick<
		FileSystem,
		| "readText"
		| "readBytes"
		| "writeTextAtomic"
		| "writeBytes"
		| "exists"
		| "stat"
		| "mkdirp"
		| "readDir"
		| "trash"
		| "registerRoot"
		| "paths"
	>;
	opener: Pick<Opener, "revealInFinder">;
	workspaceOf: (id: WorkspaceId) => Result<Workspace>;
	repoNameOf: (id: WorkspaceId) => Result<string>;
	/** The Conducted root, with `~` expanded (the `conducted_root_path` setting). */
	rootPath: () => string;
	setting: <T>(key: string) => T;
	now: () => number;
}

export class FileSyncService {
	readonly store: StoreApi<FileSyncState> = createStore<FileSyncState>(() => ({
		byWorkspace: {},
		engaged: {},
	}));
	readonly #deps: FileSyncDeps;
	readonly #flights = new Map<WorkspaceId, Promise<Result<void>>>();

	constructor(deps: FileSyncDeps) {
		this.#deps = deps;
	}

	/** True when the Advanced setting starts sync in a new cloud workspace. */
	autoSyncEnabled(): boolean {
		return this.#deps.setting<boolean>(AUTO_SYNC_SETTING) === true;
	}

	/** True when the workspace's mirror folder is on disk, so a Mac preview can read it. */
	async mirrorReady(workspaceId: WorkspaceId): Promise<boolean> {
		const mirror = this.mirrorPathOf(workspaceId);
		if (!mirror.ok) return false;
		return this.#deps.fs.exists(mirror.value);
	}

	/** The mirror folder of a cloud workspace, without touching the network. */
	mirrorPathOf(workspaceId: WorkspaceId): Result<string> {
		const workspace = this.#deps.workspaceOf(workspaceId);
		if (!workspace.ok) return workspace;
		if (workspace.value.host.kind !== "cloud") {
			return err(appError("workspace_not_cloud", "That workspace is not a cloud workspace."));
		}
		const repo = this.#deps.repoNameOf(workspaceId);
		if (!repo.ok) return repo;
		return ok(mirrorPathFor(this.#deps.rootPath(), repo.value, workspaceId));
	}

	/** Starts the sync of one cloud workspace (or marks it for the next search). */
	async start(workspaceId: WorkspaceId): Promise<Result<void>> {
		const workspace = this.#deps.workspaceOf(workspaceId);
		if (!workspace.ok) return workspace;
		if (workspace.value.host.kind !== "cloud") return ok(undefined);
		this.#engage(workspaceId, true);
		if (!this.autoSyncEnabled()) return ok(undefined);
		return this.syncNow(workspaceId);
	}

	/** Stops the sync and leaves the mirror as it is. */
	stop(workspaceId: WorkspaceId): void {
		this.#engage(workspaceId, false);
	}

	/** Backs the file tree and the searches: the sync runs if it is engaged and stale. */
	async ensureMirror(workspaceId: WorkspaceId): Promise<Result<void>> {
		const workspace = this.#deps.workspaceOf(workspaceId);
		if (!workspace.ok) return workspace;
		if (workspace.value.host.kind !== "cloud") return ok(undefined);
		const mirror = this.mirrorPathOf(workspaceId);
		if (!mirror.ok) return mirror;
		const status = this.store.getState().byWorkspace[workspaceId];
		const exists = await this.#deps.fs.exists(mirror.value);
		if (!exists && !this.autoSyncEnabled()) {
			return err(appError("cloud_file_sync_off", SYNC_OFF_LABEL));
		}
		if (exists && !this.autoSyncEnabled()) return ok(undefined);
		this.#engage(workspaceId, true);
		const last = status?.lastSyncedAt ?? null;
		if (last !== null && this.#deps.now() - last < SYNC_POLL_MS) return ok(undefined);
		return this.syncNow(workspaceId);
	}

	/** Syncs one cloud workspace now, sharing an in-flight sync. */
	syncNow(workspaceId: WorkspaceId): Promise<Result<void>> {
		const running = this.#flights.get(workspaceId);
		if (running !== undefined) return running;
		const flight = this.#sync(workspaceId).finally(() => this.#flights.delete(workspaceId));
		this.#flights.set(workspaceId, flight);
		return flight;
	}

	/** Uploads one Mac file into the sandbox at `relativePath`. */
	async uploadFile(
		workspaceId: WorkspaceId,
		sourcePath: string,
		relativePath: string,
	): Promise<Result<string>> {
		const workspace = this.#deps.workspaceOf(workspaceId);
		if (!workspace.ok) return workspace;
		if (workspace.value.host.kind !== "cloud") {
			return err(appError("workspace_not_cloud", "That workspace is not a cloud workspace."));
		}
		const guarded = guardedRelativePath(relativePath);
		if (!guarded.ok) return guarded;
		const read = await this.#deps.fs.readBytes(sourcePath);
		if (!read.ok) return read;
		const text = textFromBytes(read.value);
		const destination = `${workspace.value.path.replace(/\/+$/, "")}/${guarded.value}`;
		const answer = await cloudJson(
			this.#deps.cloud,
			workspace.value.host,
			"/files",
			text === null
				? { operation: "writeBytes", path: destination, base64: encodeBase64(read.value) }
				: { operation: "write", path: destination, text },
		);
		if (!answer.ok) return answer;
		const mirror = this.mirrorPathOf(workspaceId);
		if (mirror.ok) {
			const local = `${mirror.value}/${guarded.value}`;
			const parent = local.slice(0, local.lastIndexOf("/"));
			if (parent.length > 0) await this.#deps.fs.mkdirp(parent);
			if (text === null) await this.#deps.fs.writeBytes(local, read.value);
			else await this.#deps.fs.writeTextAtomic(local, text);
		}
		return ok(destination);
	}

	/**
	 * Opens a cloud file: the mirror's copy when it has one, else a copy written to Downloads. The
	 * path must stay inside (or be writable from) the synced workspace.
	 */
	async downloadFile(
		workspaceId: WorkspaceId,
		relativePath: string,
		options: { reveal?: boolean } = {},
	): Promise<Result<{ path: string; downloaded: boolean }>> {
		const guarded = guardedRelativePath(relativePath);
		if (!guarded.ok) return guarded;
		const workspace = this.#deps.workspaceOf(workspaceId);
		if (!workspace.ok) return workspace;
		if (workspace.value.host.kind === "local") {
			return err(appError("workspace_not_cloud", "That workspace is not a cloud workspace."));
		}
		const mirror = this.mirrorPathOf(workspaceId);
		if (!mirror.ok) return mirror;
		const mirrored = `${mirror.value}/${guarded.value}`;
		if (await this.#deps.fs.exists(mirrored)) {
			if (options.reveal !== false) {
				const revealed = await this.#reveal(mirrored);
				if (!revealed.ok) return revealed;
			}
			return ok({ path: mirrored, downloaded: false });
		}
		const answer = await cloudJson(this.#deps.cloud, workspace.value.host, "/files", {
			operation: "readBytes",
			path: `${workspace.value.path.replace(/\/+$/, "")}/${guarded.value}`,
		});
		if (!answer.ok) return answer;
		const value = answer.value as { base64?: unknown };
		if (typeof value.base64 !== "string") {
			return err(appError("cloud_bad_response", "The Workspace did not send that file's bytes."));
		}
		const bytes = decodeBase64(value.base64);
		const text = textFromBytes(bytes);
		const downloads = `${this.#deps.fs.paths.home}/Downloads`;
		const made = await this.#deps.fs.mkdirp(downloads);
		if (!made.ok) return made;
		const name = guarded.value.split("/").at(-1) ?? "download";
		const target = `${downloads}/${name}`;
		const written =
			text === null
				? await this.#deps.fs.writeBytes(target, bytes)
				: await this.#deps.fs.writeTextAtomic(target, text);
		if (!written.ok) return written;
		if (options.reveal !== false) {
			const revealed = await this.#reveal(target);
			if (!revealed.ok) return revealed;
		}
		return ok({ path: target, downloaded: true });
	}

	/** Whether the sandbox already holds `relativePath` (for an upload that must not replace). */
	async remoteExists(workspaceId: WorkspaceId, relativePath: string): Promise<Result<boolean>> {
		const guarded = guardedRelativePath(relativePath);
		if (!guarded.ok) return guarded;
		const workspace = this.#deps.workspaceOf(workspaceId);
		if (!workspace.ok) return workspace;
		if (workspace.value.host.kind !== "cloud") return ok(false);
		const answer = await cloudJson(this.#deps.cloud, workspace.value.host, "/files", {
			operation: "exists",
			path: `${workspace.value.path.replace(/\/+$/, "")}/${guarded.value}`,
		});
		if (!answer.ok) return answer;
		const value = answer.value as { exists?: unknown };
		return ok(value.exists === true);
	}

	/** The view a screen shows for one workspace. */
	viewOf(workspaceId: WorkspaceId, host: Host): FileSyncView {
		if (host.kind === "local") return { state: "local" };
		const status = this.store.getState().byWorkspace[workspaceId];
		const mirror = this.mirrorPathOf(workspaceId);
		const mirrorPath = mirror.ok ? mirror.value : "";
		if (status?.state === "failed") {
			return { state: "failed", label: SYNC_FAILED_LABEL, message: status.error ?? "" };
		}
		if (status?.state === "syncing") {
			return { state: "syncing", label: "Syncing files", mirrorPath };
		}
		if (status?.state === "synced" && status.lastSyncedAt !== null) {
			return {
				state: "synced",
				label: "Files in sync",
				mirrorPath,
				lastSyncedAt: status.lastSyncedAt,
				files: status.files,
				truncated: status.truncated,
			};
		}
		if (this.autoSyncEnabled()) {
			return {
				state: "unavailable",
				label: SYNC_FOLDER_UNAVAILABLE_LABEL,
				localTerminalLabel: LOCAL_TERMINAL_UNAVAILABLE_LABEL,
			};
		}
		return { state: "off", label: SYNC_OFF_LABEL };
	}

	async #sync(workspaceId: WorkspaceId): Promise<Result<void>> {
		const workspace = this.#deps.workspaceOf(workspaceId);
		if (!workspace.ok) return workspace;
		if (workspace.value.host.kind !== "cloud") return ok(undefined);
		const host = workspace.value.host;
		const mirror = this.mirrorPathOf(workspaceId);
		if (!mirror.ok) return mirror;
		const status = this.store.getState().byWorkspace[workspaceId] ?? emptyStatus(mirror.value);
		this.#setStatus(workspaceId, { ...status, state: "syncing", error: null });
		const synced = await this.#walkAndWrite(host, workspace.value.path, mirror.value);
		if (!synced.ok) {
			this.#setStatus(workspaceId, {
				...status,
				state: "failed",
				error: synced.error.message,
				mirrorPath: mirror.value,
			});
			return synced;
		}
		this.#setStatus(workspaceId, {
			state: "synced",
			mirrorPath: mirror.value,
			lastSyncedAt: this.#deps.now(),
			error: null,
			files: synced.value.files,
			truncated: synced.value.truncated,
		});
		return ok(undefined);
	}

	/** Lists the sandbox, writes every text file to the mirror, then removes stale entries. */
	async #walkAndWrite(
		host: CloudHost,
		remoteRoot: string,
		mirrorPath: string,
	): Promise<Result<{ files: number; truncated: boolean }>> {
		const listed = await cloudJson(this.#deps.cloud, host, "/files", {
			operation: "list",
			path: remoteRoot,
		});
		if (!listed.ok) return listed;
		const body = objectOf(listed.value);
		if (body === null || !Array.isArray(body.entries)) {
			return err(appError("cloud_bad_response", "The Workspace did not list its files."));
		}
		const truncated = body.truncated === true;
		const root = await this.#deps.fs.mkdirp(mirrorPath);
		if (!root.ok) return root;
		const registered = await this.#deps.fs.registerRoot(mirrorPath);
		if (!registered.ok) return registered;
		const previous = await this.#readBaseline(mirrorPath);
		const seen = new Set<string>();
		const skipped: { path: string; reason: string; size: number | null }[] = [];
		let files = 0;
		for (const raw of body.entries) {
			const entry = objectOf(raw);
			if (entry === null || typeof entry.path !== "string") continue;
			const relative = relativeToRoot(remoteRoot, entry.path);
			if (relative === null || relative.length === 0) continue;
			const guarded = guardedRelativePath(relative);
			if (!guarded.ok) {
				skipped.push({ path: relative, reason: OUTSIDE_MIRROR_MESSAGE, size: null });
				continue;
			}
			const path = guarded.value;
			const local = `${mirrorPath}/${path}`;
			if (entry.isDirectory === true) {
				const made = await this.#deps.fs.mkdirp(local);
				if (!made.ok) return made;
				continue;
			}
			if (entry.isSymlink === true) {
				skipped.push({ path, reason: "A symlink is not mirrored.", size: null });
				continue;
			}
			if (typeof entry.size === "number" && !withinCloudReadLimit(entry.size)) {
				// The list already named the size, so an unchanged oversize file is never read;
				// the report says why, and a later smaller file is tried again.
				skipped.push({ path, reason: cloudReadLimitMessage(entry.size), size: entry.size });
				continue;
			}
			seen.add(path);
			const read = await cloudJson(this.#deps.cloud, host, "/files", {
				operation: "readBytes",
				path: entry.path,
			});
			if (!read.ok) {
				skipped.push({ path, reason: read.error.message, size: null });
				continue;
			}
			const value = objectOf(read.value);
			if (value === null || typeof value.base64 !== "string") {
				skipped.push({ path, reason: "The Workspace sent no bytes for it.", size: null });
				continue;
			}
			const bytes = decodeBase64(value.base64);
			const text = textFromBytes(bytes);
			const parent = local.slice(0, local.lastIndexOf("/"));
			if (parent.length > 0) {
				const made = await this.#deps.fs.mkdirp(parent);
				if (!made.ok) return made;
			}
			const written =
				text === null
					? await this.#deps.fs.writeBytes(local, bytes)
					: await this.#deps.fs.writeTextAtomic(local, text);
			if (!written.ok) return written;
			files += 1;
		}
		for (const stale of previous?.files ?? []) {
			if (seen.has(stale)) continue;
			const local = `${mirrorPath}/${stale}`;
			if (await this.#deps.fs.exists(local)) await this.#deps.fs.trash(local);
		}
		const baseline: Baseline = {
			version: 1,
			remoteRoot,
			syncedAt: this.#deps.now(),
			files: [...seen].sort(),
			skipped,
			truncated,
		};
		const metadata = metadataPathFor(mirrorPath);
		const madeMetadata = await this.#deps.fs.mkdirp(metadata);
		if (!madeMetadata.ok) return madeMetadata;
		const stored = await this.#deps.fs.writeTextAtomic(
			`${metadata}/${BASELINE_FILE}`,
			`${JSON.stringify(baseline, null, 2)}\n`,
		);
		if (!stored.ok) return stored;
		return ok({ files, truncated });
	}

	async #readBaseline(mirrorPath: string): Promise<Baseline | null> {
		const read = await this.#deps.fs.readText(`${metadataPathFor(mirrorPath)}/${BASELINE_FILE}`);
		if (!read.ok) return null;
		try {
			const parsed = JSON.parse(read.value) as Partial<Baseline>;
			if (parsed.version !== 1 || !Array.isArray(parsed.files)) return null;
			return {
				version: 1,
				remoteRoot: typeof parsed.remoteRoot === "string" ? parsed.remoteRoot : "",
				syncedAt: typeof parsed.syncedAt === "number" ? parsed.syncedAt : 0,
				files: parsed.files.filter((path): path is string => typeof path === "string"),
				skipped: Array.isArray(parsed.skipped)
					? parsed.skipped
							.filter(
								(entry): entry is { path: string; reason: string; size: number | null } =>
									typeof entry === "object" &&
									entry !== null &&
									typeof (entry as { path?: unknown }).path === "string" &&
									typeof (entry as { reason?: unknown }).reason === "string",
							)
							.map((entry) => ({
								path: entry.path,
								reason: entry.reason,
								size:
									typeof (entry as { size?: unknown }).size === "number"
										? (entry as { size: number }).size
										: null,
							}))
					: [],
				truncated: parsed.truncated === true,
			};
		} catch {
			return null;
		}
	}

	async #reveal(path: string): Promise<Result<void>> {
		try {
			await this.#deps.opener.revealInFinder(path);
			return ok(undefined);
		} catch (cause) {
			return err(appError("cloud_open_downloads_failed", OPEN_DOWNLOADS_FAILED_MESSAGE, cause));
		}
	}

	#engage(workspaceId: WorkspaceId, engaged: boolean): void {
		this.store.setState((state) => ({
			...state,
			engaged: { ...state.engaged, [workspaceId]: engaged },
		}));
	}

	#setStatus(workspaceId: WorkspaceId, status: FileSyncStatus): void {
		this.store.setState((state) => ({
			...state,
			byWorkspace: { ...state.byWorkspace, [workspaceId]: status },
		}));
	}

	/** Stops every in-flight sync's status; the sync itself is harmless when it finishes. */
	dispose(): void {
		this.store.setState({ byWorkspace: {}, engaged: {} });
	}
}
