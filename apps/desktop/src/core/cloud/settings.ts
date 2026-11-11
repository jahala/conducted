/**
 * @feature CLOUD-17 Cloud settings page
 * Owns: the Mac's personal cloud settings as a screen reads them: the commit identity cloud
 * workspaces use, the variables only cloud workspaces receive, and the MCP servers its agents
 * see. All live in the Worker (apps/cloud/src/settings.ts), beside the workspace backups, so they
 * reach every sandbox start (D113, D121).
 * Behaviour: docs/research/conductor/services-map.md 4.2.7 (the server key `gitIdentity`,
 * `{name, email}` for commits) and 4.2.8 (personal cloud variables); ui-map.md 6 Git ("Name and
 * email used for commits in cloud workspaces"). Conductor stores them in its hosted settings
 * service; ours are the Worker's because the Mac has its own Worker (D018, D106).
 * Must handle: an unpaired Mac (a plain message, no request); a Worker that cannot be reached (the
 * page's own "Conducted could not connect to cloud settings. Try again."); a refused token; a
 * Worker answer that is not the settings shape; a save that fails, which leaves the saved settings
 * as they were and names the thing that did not change.
 * Our design choice: one settings object and one request helper, so a read and every save share
 * the same failure messages and the token never enters the web view (the Rust shell adds it).
 * Test first: reading settings from a Worker that cannot be reached shows the page's own message.
 */
import { type AppError, appError, err, ok, type Result } from "@conducted/shared";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { Cloud, CloudPairing } from "../../platform/platform.ts";
import {
	CLOUD_MCP_ADD_FAILED,
	CLOUD_MCP_DELETE_FAILED,
	CLOUD_MCP_UPDATE_FAILED,
	type CloudMcpServer,
} from "../cloud-mcp.ts";
import { CLOUD_ENV_SAVE_FAILED, CLOUD_SETTINGS_UNREACHABLE } from "../cloud-messages.ts";

/** The name and email a cloud workspace commits with (services-map 4.2.7 `gitIdentity`). */
export interface CloudGitIdentity {
	name: string;
	email: string;
}

/** The personal cloud settings one Worker holds. */
export interface CloudSettings {
	gitIdentity: CloudGitIdentity | null;
	/** `personalCloudEnvVars`: names and values, given only to cloud workspaces. */
	envVars: Record<string, string>;
	/** MCP servers for cloud workspaces, by name (CLOUD-17). */
	mcpServers: Record<string, CloudMcpServer>;
}

/** What Conductor says when the cloud commit identity could not be changed. */
export const CLOUD_GIT_IDENTITY_FAILED = "Couldn't update Git identity";

/** The settings a Worker that has never been given any answers with. */
export function emptyCloudSettings(): CloudSettings {
	return { gitIdentity: null, envVars: {}, mcpServers: {} };
}

export type CloudSettingsState =
	| { state: "unknown" }
	| { state: "loading" }
	| { state: "ready"; settings: CloudSettings; paired: boolean }
	| { state: "error"; error: AppError };

export interface CloudSettingsService {
	readonly store: StoreApi<CloudSettingsState>;
	/** Reads the Worker's settings. An unpaired Mac answers with empty settings, unpaired. */
	load(): Promise<Result<CloudSettings>>;
	/** Replaces the commit identity; null clears it. */
	saveGitIdentity(identity: CloudGitIdentity | null): Promise<Result<CloudSettings>>;
	/** Adds or replaces one personal cloud variable. */
	setEnvVar(name: string, value: string): Promise<Result<CloudSettings>>;
	/** Removes one personal cloud variable. */
	removeEnvVar(name: string): Promise<Result<CloudSettings>>;
	/** Adds or replaces one cloud MCP server. */
	saveMcpServer(name: string, server: CloudMcpServer): Promise<Result<CloudSettings>>;
	/** Removes one cloud MCP server. */
	removeMcpServer(name: string): Promise<Result<CloudSettings>>;
	/** Adds the MCP servers an import chose, keeping the ones already saved. */
	importMcpServers(
		servers: Readonly<Record<string, CloudMcpServer>>,
	): Promise<Result<CloudSettings>>;
}

export interface CloudSettingsDeps {
	cloud: Pick<Cloud, "request">;
	/** The pairing the shell holds, read when a call runs (CLOUD-07). */
	pairing: () => CloudPairing;
}

/** The first `error` string a Worker answer carries, or null. */
function workerError(body: string): string | null {
	try {
		const parsed = JSON.parse(body) as { error?: unknown };
		return typeof parsed.error === "string" && parsed.error.length > 0 ? parsed.error : null;
	} catch {
		return null;
	}
}

/** One `GET` or `POST /settings` against the paired Worker. */
async function requestSettings(
	deps: CloudSettingsDeps,
	method: "GET" | "POST",
	settings?: CloudSettings,
	failure: { code: string; message: string } = {
		code: "cloud_settings_unreachable",
		message: CLOUD_SETTINGS_UNREACHABLE,
	},
): Promise<Result<CloudSettings>> {
	const pairing = deps.pairing();
	if (!pairing.paired || pairing.url === null) {
		return err(appError("cloud_not_paired", "Pair this Mac with a Worker first."));
	}
	const answer = await deps.cloud.request({
		url: pairing.url,
		method,
		path: "/settings",
		...(settings === undefined ? {} : { body: settings }),
		timeoutMs: 20_000,
	});
	if (!answer.ok) return err(appError(failure.code, failure.message, answer.error));
	if (answer.value.status === 401) {
		return err(
			appError(
				"cloud_not_paired",
				"The Worker refused the pairing token. Pair this Mac with the Worker again.",
			),
		);
	}
	if (answer.value.status < 200 || answer.value.status >= 300) {
		return err(appError(failure.code, workerError(answer.value.body) ?? failure.message));
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(answer.value.body);
	} catch {
		return err(
			appError("cloud_bad_response", "The Worker answered with something other than its settings."),
		);
	}
	const normalized = normalizeCloudSettings(parsed);
	if (normalized === null) {
		return err(
			appError("cloud_bad_response", "The Worker answered with something other than its settings."),
		);
	}
	return ok(normalized);
}

/** Why one MCP server's shape is wrong, or null when it is the Worker's shape. */
function mcpServerOk(value: unknown): value is CloudMcpServer {
	if (typeof value !== "object" || value === null) return false;
	const server = value as {
		url?: unknown;
		authType?: unknown;
		bearerToken?: unknown;
		headers?: unknown;
	};
	if (typeof server.url !== "string") return false;
	if (server.authType !== "none" && server.authType !== "bearer" && server.authType !== "headers") {
		return false;
	}
	if (server.bearerToken !== undefined && typeof server.bearerToken !== "string") return false;
	if (server.headers !== undefined) {
		if (typeof server.headers !== "object" || server.headers === null) return false;
		if (!Object.values(server.headers).every((entry) => typeof entry === "string")) return false;
	}
	return true;
}

/**
 * The shape the Worker answers with: an identity or null, a name-to-value map, and the MCP
 * servers. A Worker from before MCP servers answers without that field; it reads as none.
 */
export function normalizeCloudSettings(value: unknown): CloudSettings | null {
	if (typeof value !== "object" || value === null) return null;
	const settings = value as { gitIdentity?: unknown; envVars?: unknown; mcpServers?: unknown };
	const identity = settings.gitIdentity;
	const identityOk =
		identity === null ||
		(typeof identity === "object" &&
			identity !== null &&
			typeof (identity as { name?: unknown }).name === "string" &&
			typeof (identity as { email?: unknown }).email === "string");
	const vars = settings.envVars;
	if (typeof vars !== "object" || vars === null || Array.isArray(vars)) return null;
	if (!Object.values(vars).every((entry) => typeof entry === "string")) return null;
	const servers = settings.mcpServers ?? {};
	if (typeof servers !== "object" || servers === null || Array.isArray(servers)) return null;
	if (!Object.values(servers).every(mcpServerOk)) return null;
	if (!identityOk) return null;
	return {
		gitIdentity: identity as CloudGitIdentity | null,
		envVars: vars as Record<string, string>,
		mcpServers: servers as Record<string, CloudMcpServer>,
	};
}

/** True when `value` is the shape the Worker answers with. */
export function isCloudSettings(value: unknown): value is CloudSettings {
	return normalizeCloudSettings(value) !== null;
}

/** The cloud settings service over the shell's cloud door. */
export function createCloudSettings(deps: CloudSettingsDeps): CloudSettingsService {
	const store = createStore<CloudSettingsState>(() => ({ state: "unknown" }));
	const keep = (result: Result<CloudSettings>, paired: boolean): Result<CloudSettings> => {
		store.setState(
			result.ok
				? { state: "ready", settings: result.value, paired }
				: { state: "error", error: result.error },
		);
		return result;
	};

	/** The settings a save starts from; a store that was never read is read first. */
	const current = async (): Promise<Result<CloudSettings>> => {
		const state = store.getState();
		if (state.state === "ready") return ok(state.settings);
		return load();
	};

	const save = async (
		change: (settings: CloudSettings) => CloudSettings,
		failure: { code: string; message: string },
	): Promise<Result<CloudSettings>> => {
		const before = await current();
		if (!before.ok) {
			return err(appError(failure.code, failure.message, before.error));
		}
		const pairing = deps.pairing();
		if (!pairing.paired || pairing.url === null) {
			return err(appError("cloud_not_paired", "Pair this Mac with a Worker first."));
		}
		const written = await requestSettings(deps, "POST", change(before.value), failure);
		// A failed save keeps what the Worker last said: the page still shows the saved settings,
		// and the failure is the toast's own message.
		if (!written.ok) return err(written.error);
		store.setState({ state: "ready", settings: written.value, paired: true });
		return written;
	};

	const load = async (): Promise<Result<CloudSettings>> => {
		const pairing = deps.pairing();
		if (!pairing.paired || pairing.url === null) {
			const empty = emptyCloudSettings();
			store.setState({ state: "ready", settings: empty, paired: false });
			return ok(empty);
		}
		store.setState({ state: "loading" });
		const read = await requestSettings(deps, "GET");
		return keep(read, true);
	};

	return {
		store,
		load,
		saveGitIdentity: (identity) =>
			save((settings) => ({ ...settings, gitIdentity: identity }), {
				code: "cloud_git_identity_failed",
				message: CLOUD_GIT_IDENTITY_FAILED,
			}),
		setEnvVar: (name, value) =>
			save((settings) => ({ ...settings, envVars: { ...settings.envVars, [name]: value } }), {
				code: "cloud_env_save_failed",
				message: CLOUD_ENV_SAVE_FAILED,
			}),
		removeEnvVar: (name) =>
			save(
				(settings) => {
					const { [name]: _removed, ...rest } = settings.envVars;
					return { ...settings, envVars: rest };
				},
				{ code: "cloud_env_save_failed", message: CLOUD_ENV_SAVE_FAILED },
			),
		saveMcpServer: (name, server) =>
			save(
				(settings) => ({ ...settings, mcpServers: { ...settings.mcpServers, [name]: server } }),
				{ code: "cloud_mcp_save_failed", message: CLOUD_MCP_UPDATE_FAILED },
			),
		removeMcpServer: (name) =>
			save(
				(settings) => {
					const { [name]: _removed, ...rest } = settings.mcpServers;
					return { ...settings, mcpServers: rest };
				},
				{ code: "cloud_mcp_save_failed", message: CLOUD_MCP_DELETE_FAILED },
			),
		importMcpServers: (servers) =>
			save(
				(settings) => ({
					...settings,
					mcpServers: { ...settings.mcpServers, ...servers },
				}),
				{ code: "cloud_mcp_save_failed", message: CLOUD_MCP_ADD_FAILED },
			),
	};
}
