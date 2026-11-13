/**
 * @feature CLOUD-17 MCP servers in the cloud sandbox
 * Owns: the MCP page's OAuth calls to the paired Worker: the callback URL and each OAuth server's
 * credential, a connect (the sign-in URL to open and its state), the connect's status, a cancel,
 * a disconnect, and the detection an import asks for. The tokens stay in the Worker; this service
 * only ever sees their status.
 * Behaviour: Conductor's MCP queries and mutations (renderApp-DeUrsznk.js `Owe` @8671113,
 * `$Wi`, `BWi`, `dGo`, `hGo` @8673142 to @8676502): the list holds `oauthCallbackUrl` and each
 * server's credential; a connect answers `authorizationUrl` and `state`; the status is `pending`,
 * `failed` or `absent`; a cancel answers `cancelled`. The Worker's routes are apps/cloud's
 * mcp-oauth-routes.ts.
 * Must handle: an unpaired Mac (no request); a Worker that cannot be reached; a Worker's refusal
 * (its own reason, which the page toasts); an answer that is not the shape it should be.
 * Test first: mcp-oauth.test.ts reads a connected server's status and connects another.
 */
import { appError, err, ok, type Result } from "@conducted/shared";
import { createStore, type StoreApi } from "zustand/vanilla";
import {
	CLOUD_MCP_CONNECT_FAILED,
	CLOUD_MCP_DISCONNECT_FAILED,
	type CloudMcpConnectStatus,
	type CloudMcpCredential,
	type CloudMcpOAuthView,
} from "../cloud-mcp.ts";
import { CLOUD_SETTINGS_UNREACHABLE } from "../cloud-messages.ts";
import { type CloudSettingsDeps, requestWorkerJson } from "./settings.ts";

export type CloudMcpOAuthState =
	| { state: "unknown" }
	| { state: "ready"; view: CloudMcpOAuthView }
	| { state: "error"; message: string };

export interface CloudMcpOAuthService {
	readonly store: StoreApi<CloudMcpOAuthState>;
	/** Reads the callback URL and every OAuth server's credential. */
	load(): Promise<Result<CloudMcpOAuthView>>;
	/** Starts a sign-in: the URL to open in the browser and the state the status check names. */
	connect(name: string): Promise<Result<{ authorizationUrl: string; state: string }>>;
	status(name: string, state: string): Promise<Result<CloudMcpConnectStatus>>;
	/** Stops waiting. False when the sign-in had already finished or gone. */
	cancel(name: string, state: string): Promise<Result<boolean>>;
	/** Forgets the server's tokens, then reads the list again. */
	disconnect(name: string): Promise<Result<CloudMcpOAuthView>>;
	/** Whether a server needs OAuth, for an import of a server without headers. */
	detect(url: string): Promise<Result<"oauth" | "none">>;
}

const UNREACHABLE = { code: "cloud_mcp_oauth_unreachable", message: CLOUD_SETTINGS_UNREACHABLE };
const CONNECT = { code: "cloud_mcp_connect_failed", message: CLOUD_MCP_CONNECT_FAILED };

const badAnswer = () =>
	err(appError("cloud_bad_response", "The Worker answered with something other than expected."));

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** The list's shape, with any credential that is not one of Conductor's statuses left out. */
export function normalizeOAuthView(value: unknown): CloudMcpOAuthView | null {
	if (!isRecord(value) || typeof value.callbackUrl !== "string" || !isRecord(value.servers)) {
		return null;
	}
	const credentials: Record<string, CloudMcpCredential> = {};
	for (const [name, entry] of Object.entries(value.servers)) {
		if (!isRecord(entry) || (entry.status !== "active" && entry.status !== "needs_reauth"))
			continue;
		credentials[name] = {
			status: entry.status,
			...(typeof entry.statusDetail === "string" ? { statusDetail: entry.statusDetail } : {}),
		};
	}
	return { callbackUrl: value.callbackUrl, credentials };
}

const path = (name: string, action: string): string =>
	`/mcp-oauth/${encodeURIComponent(name)}/${action}`;

export function createCloudMcpOAuth(deps: CloudSettingsDeps): CloudMcpOAuthService {
	const store = createStore<CloudMcpOAuthState>(() => ({ state: "unknown" }));

	const load = async (): Promise<Result<CloudMcpOAuthView>> => {
		const answer = await requestWorkerJson(deps, "GET", "/mcp-oauth", undefined, UNREACHABLE);
		if (!answer.ok) {
			store.setState({ state: "error", message: answer.error.message });
			return answer;
		}
		const view = normalizeOAuthView(answer.value);
		if (view === null) return badAnswer();
		store.setState({ state: "ready", view });
		return ok(view);
	};

	return {
		store,
		load,
		connect: async (name) => {
			const answer = await requestWorkerJson(
				deps,
				"POST",
				path(name, "connect"),
				undefined,
				CONNECT,
			);
			if (!answer.ok) return answer;
			const value = answer.value;
			if (
				!isRecord(value) ||
				typeof value.authorizationUrl !== "string" ||
				typeof value.state !== "string"
			) {
				return badAnswer();
			}
			return ok({ authorizationUrl: value.authorizationUrl, state: value.state });
		},
		status: async (name, state) => {
			const answer = await requestWorkerJson(
				deps,
				"GET",
				`${path(name, "status")}?state=${encodeURIComponent(state)}`,
				undefined,
				CONNECT,
			);
			if (!answer.ok) return answer;
			const status = isRecord(answer.value) ? answer.value.status : undefined;
			if (status !== "pending" && status !== "failed" && status !== "absent") return badAnswer();
			return ok(status);
		},
		cancel: async (name, state) => {
			const answer = await requestWorkerJson(
				deps,
				"POST",
				path(name, "cancel"),
				{ state },
				CONNECT,
			);
			if (!answer.ok) return answer;
			const cancelled = isRecord(answer.value) ? answer.value.cancelled : undefined;
			return typeof cancelled === "boolean" ? ok(cancelled) : badAnswer();
		},
		disconnect: async (name) => {
			const answer = await requestWorkerJson(deps, "POST", path(name, "disconnect"), undefined, {
				code: "cloud_mcp_disconnect_failed",
				message: CLOUD_MCP_DISCONNECT_FAILED,
			});
			if (!answer.ok) return answer;
			return load();
		},
		detect: async (url) => {
			const answer = await requestWorkerJson(
				deps,
				"POST",
				"/mcp-oauth/detect",
				{ url },
				UNREACHABLE,
			);
			if (!answer.ok) return answer;
			const authType = isRecord(answer.value) ? answer.value.authType : undefined;
			return authType === "oauth" || authType === "none" ? ok(authType) : badAnswer();
		},
	};
}
