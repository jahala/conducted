/**
 * @feature CLOUD-17 Cloud settings page
 * Owns: the personal cloud settings the desktop edits: the commit identity a cloud workspace uses,
 * the environment variables only cloud workspaces receive, and the MCP servers its agents see.
 * They live in the Worker's own R2 bucket, beside the workspace backups, so every sandbox start
 * reads the same answer and the desktop never sends a secret into the sandbox.
 * Behaviour: docs/research/conductor/services-map.md 4.2.7 (the server key `gitIdentity`,
 * `{name, email}` for commits) and 4.2.8 (personal cloud variables); ui-map.md 6 Git ("Name and
 * email used for commits in cloud workspaces") and 6 Organization (MCP servers for cloud
 * workspaces, auth types None, Bearer token and custom headers). The page and its toasts are
 * CLOUD-17; the [environment_variables] `[cloud]` table of the desktop's settings files is the
 * same idea for a repository's own variables (SET-04).
 * Must handle: no saved settings (empty, no identity); a name or value of the wrong type; an
 * environment variable name that is not a shell name; a name the Worker itself sets (PATH, HOME,
 * the git scrub, the provider keys) so a user cannot break the sandbox or smuggle a credential in;
 * a bucket that cannot be read or written, which is the caller's error, never silently empty;
 * an MCP server that is not an HTTPS URL or whose name or headers are unusable; and a credential
 * that must never appear in the value a sandbox receives (D121).
 * Our design choice: one object per Worker at `settings/user.json`, because a Mac has one Worker
 * (D106); it is read on every sandbox start, and a running sandbox picks a changed identity up at
 * its next git command (the desktop's own git calls read it then).
 * Test first: a reserved name is refused, and an identity becomes the four git environment names.
 */
import { z } from "zod";

/** The name and email a cloud workspace commits with (services-map 4.2.7 `gitIdentity`). */
export interface CloudGitIdentity {
	name: string;
	email: string;
}

/** How a cloud MCP server authenticates (ui-map.md 6 Organization: None, Bearer token, headers). */
export type CloudMcpAuth = "none" | "bearer" | "headers";

/** One MCP server a cloud workspace's agents see. It is remote and HTTPS, as Conductor's are. */
export interface CloudMcpServer {
	url: string;
	authType: CloudMcpAuth;
	/** The bearer token. It stays in the Worker; the sandbox only ever gets a placeholder. */
	bearerToken?: string;
	/** The custom header values. They stay in the Worker; the sandbox gets placeholders. */
	headers?: Record<string, string>;
}

/** The personal cloud settings one Worker holds. */
export interface CloudSettings {
	gitIdentity: CloudGitIdentity | null;
	/** `personalCloudEnvVars`: names and values, given only to cloud workspaces. */
	envVars: Record<string, string>;
	/** MCP servers for cloud workspaces, by name (CLOUD-17). */
	mcpServers: Record<string, CloudMcpServer>;
}

/** The settings a Worker that has never been given any answers with. */
export function emptyCloudSettings(): CloudSettings {
	return { gitIdentity: null, envVars: {}, mcpServers: {} };
}

/** The R2 key the one settings object is stored under, beside the workspace backups. */
export const CLOUD_SETTINGS_KEY = "settings/user.json";

/** The most variables one Worker keeps, so a request cannot make the object unbounded. */
export const MAX_CLOUD_ENV_VARS = 100;

/** A name an environment variable may have; the same shape the desktop's Environment page uses. */
export const ENV_VAR_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Names the Worker or the image sets itself (CONTAINER_ENV, the git scrub and the credential
 * placeholders). A cloud variable with one of them could hide a secret swap or break git, so a
 * save that names one is refused.
 */
export const RESERVED_CLOUD_ENV_NAMES: ReadonlySet<string> = new Set([
	"PATH",
	"HOME",
	"SHELL",
	"NODE_EXTRA_CA_CERTS",
	"SSL_CERT_FILE",
	"GIT_SSL_CAINFO",
	"CURL_CA_BUNDLE",
	"GIT_TERMINAL_PROMPT",
	"GIT_CONFIG_NOSYSTEM",
	"GIT_CONFIG_GLOBAL",
	"GIT_AUTHOR_NAME",
	"GIT_AUTHOR_EMAIL",
	"GIT_COMMITTER_NAME",
	"GIT_COMMITTER_EMAIL",
	"GH_TOKEN",
	"GITHUB_TOKEN",
	"IS_SANDBOX",
	"CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
]);

/**
 * The provider keys the Worker swaps in at its outbound handler (CLOUD-05). A cloud variable of
 * one of these names would put a credential inside the sandbox, which the plan forbids, so it is
 * refused like a reserved name.
 */
export const CLOUD_PROVIDER_KEY_NAMES: ReadonlySet<string> = new Set([
	"ANTHROPIC_API_KEY",
	"ANTHROPIC_AUTH_TOKEN",
	"CLAUDE_CODE_OAUTH_TOKEN",
	"OPENAI_API_KEY",
	"CODEX_API_KEY",
	"CODEX_ACCESS_TOKEN",
	"CURSOR_API_KEY",
	"AI_GATEWAY_API_KEY",
	"OPENAI_BASE_URL",
]);

/**
 * The value a sandbox's MCP header carries in place of a real credential. The Worker's outbound
 * handler swaps it for the real one, exactly as it does for the model keys (D104).
 */
export const CLOUD_MCP_PLACEHOLDER = "provided-by-worker";

/** The most MCP servers one Worker keeps. */
export const MAX_CLOUD_MCP_SERVERS = 100;

/**
 * The names Conductor reserves for its own MCP server, "conductor", and ours, "conducted". A
 * cloud server of either name would shadow the app tools the agent needs, so it is refused.
 */
const RESERVED_MCP_SERVER_NAMES: ReadonlySet<string> = new Set(["conductor", "conducted"]);

/** An MCP server's name: 1 to 64 letters, numbers, hyphens or underscores, as Conductor says. */
export const MCP_SERVER_NAME = /^[A-Za-z0-9_-]{1,64}$/;

/** One HTTP header name (an RFC 9110 token). */
export const HTTP_HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/** Why an MCP server's name cannot be used, or null when it can. */
export function cloudMcpServerNameProblem(name: string): string | null {
	if (!MCP_SERVER_NAME.test(name)) {
		return 'Names can be 1-64 letters, numbers, hyphens, or underscores — no spaces ("conducted" names are reserved)';
	}
	if (RESERVED_MCP_SERVER_NAMES.has(name.toLowerCase())) {
		return `${name} is reserved for the app's own tools. Choose another name.`;
	}
	return null;
}

/** Why one header cannot be sent, or null when it can. */
function headerProblem(name: string, value: string): string | null {
	if (!HTTP_HEADER_NAME.test(name)) return `${name} is not a header name.`;
	if (value.includes("\n") || value.includes("\r") || value.includes("\u0000")) {
		return `${name} has a line break.`;
	}
	return null;
}

/** Everything wrong with one server, in the page's words. Empty when it can be saved. */
export function cloudMcpServerProblem(server: CloudMcpServer): string[] {
	const problems: string[] = [];
	let url: URL | null = null;
	try {
		url = new URL(server.url);
	} catch {
		problems.push("Enter a URL that starts with https://");
	}
	if (url !== null) {
		if (url.protocol !== "https:") problems.push("Enter a URL that starts with https://");
		if (url.username !== "" || url.password !== "") {
			problems.push("The URL must not hold a username or password.");
		}
	}
	if (server.authType === "bearer" && (server.bearerToken ?? "") === "") {
		problems.push("Enter a bearer token");
	}
	if (server.authType === "headers") {
		const headers = server.headers ?? {};
		if (Object.keys(headers).length === 0) {
			problems.push("Enter at least one header.");
		}
		for (const [name, value] of Object.entries(headers)) {
			const problem = headerProblem(name, value);
			if (problem !== null) problems.push(problem);
		}
	}
	return problems;
}

/**
 * The origin and path prefix a request must start with to reach one server, with a count of its
 * path segments so the longest match wins (two servers on one host stay apart).
 */
export function mcpServerPrefix(rawUrl: string): { path: string; segments: number } | null {
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		return null;
	}
	if (url.protocol !== "https:") return null;
	const path = url.pathname === "" ? "/" : url.pathname.replace(/\/+$/, "") || "/";
	return { path, segments: path === "/" ? 0 : path.split("/").length - 1 };
}

/**
 * The server a request belongs to: the one with the longest URL path prefix on the same host. A
 * look-alike host, another port or a sibling path belongs to no server, so its request is refused
 * unless the ordinary allow-list holds it.
 */
export function cloudMcpServerForUrl(
	rawUrl: string,
	servers: Readonly<Record<string, CloudMcpServer>>,
): { name: string; server: CloudMcpServer } | null {
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		return null;
	}
	let best: { name: string; server: CloudMcpServer; segments: number } | null = null;
	for (const [name, server] of Object.entries(servers)) {
		let configured: URL;
		try {
			configured = new URL(server.url);
		} catch {
			continue;
		}
		if (configured.protocol !== "https:" || url.protocol !== "https:") continue;
		if (configured.host !== url.host) continue;
		const prefix = mcpServerPrefix(server.url);
		if (prefix === null) continue;
		const path = url.pathname.replace(/\/+$/, "") || "/";
		const matches =
			prefix.path === "/" ? true : path === prefix.path || path.startsWith(`${prefix.path}/`);
		if (!matches) continue;
		if (best === null || prefix.segments > best.segments) {
			best = { name, server, segments: prefix.segments };
		}
	}
	return best === null ? null : { name: best.name, server: best.server };
}

/** Why a cloud variable's name cannot be used, or null when it can. */
export function cloudEnvVarNameProblem(name: string): string | null {
	if (!ENV_VAR_NAME.test(name)) {
		return "Variable names may only contain letters, numbers, and underscores.";
	}
	if (name.startsWith("CONDUCTED_")) {
		return `${name} is set by Conducted and cannot be changed here.`;
	}
	if (RESERVED_CLOUD_ENV_NAMES.has(name)) {
		return `${name} is set by the sandbox and cannot be changed here.`;
	}
	if (CLOUD_PROVIDER_KEY_NAMES.has(name)) {
		return `${name} is a provider key. The Worker holds it and never gives it to the sandbox.`;
	}
	return null;
}

const noNul = (value: string): boolean => !value.includes("\u0000");

const zIdentity = z
	.object({
		name: z.string().trim().min(1).max(200).refine(noNul),
		email: z.string().trim().min(1).max(320).refine(noNul),
	})
	.strict();

const zEnvVars = z.record(
	z.string(),
	z.string().refine(noNul, { message: "A variable value holds no NUL byte." }),
);

const zHeaders = z.record(
	z.string(),
	z.string().refine(noNul, { message: "A header value holds no NUL byte." }),
);

const zMcpServer = z
	.object({
		url: z.string().refine(noNul),
		authType: z.enum(["none", "bearer", "headers"]),
		bearerToken: z.string().refine(noNul).optional(),
		headers: zHeaders.optional(),
	})
	.strict();

const zMcpServers = z.record(z.string(), zMcpServer);

/** The body both `POST /settings` and the stored object accept. */
export const zCloudSettings = z
	.object({
		gitIdentity: zIdentity.nullable(),
		envVars: zEnvVars,
		// An object stored before MCP servers existed reads as having none.
		mcpServers: zMcpServers.default({}),
	})
	.strict()
	.superRefine((value, context) => {
		const names = Object.keys(value.envVars);
		if (names.length > MAX_CLOUD_ENV_VARS) {
			context.addIssue({
				code: "custom",
				message: `At most ${MAX_CLOUD_ENV_VARS} cloud variables are allowed.`,
			});
		}
		for (const name of names) {
			const problem = cloudEnvVarNameProblem(name);
			if (problem !== null) context.addIssue({ code: "custom", message: problem });
		}
		const mcpNames = Object.keys(value.mcpServers);
		if (mcpNames.length > MAX_CLOUD_MCP_SERVERS) {
			context.addIssue({
				code: "custom",
				message: `At most ${MAX_CLOUD_MCP_SERVERS} MCP servers are allowed.`,
			});
		}
		for (const name of mcpNames) {
			const nameProblem = cloudMcpServerNameProblem(name);
			if (nameProblem !== null) context.addIssue({ code: "custom", message: nameProblem });
			for (const problem of cloudMcpServerProblem(value.mcpServers[name] as CloudMcpServer)) {
				context.addIssue({ code: "custom", message: `${name}: ${problem}` });
			}
		}
	});

/** The settings in a stored object or a request, or null when it is not the shape we save. */
export function parseCloudSettings(value: unknown): CloudSettings | null {
	const parsed = zCloudSettings.safeParse(value);
	return parsed.success ? parsed.data : null;
}

/**
 * The environment names the settings add to a sandbox. An identity becomes git's four author and
 * committer names, so an agent's and the desktop's commits both carry it. A variable whose name
 * would break the sandbox is dropped rather than handed over; the save refuses it, so this only
 * guards an object written by an older version.
 */
export function cloudSettingsEnv(settings: CloudSettings): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [name, value] of Object.entries(settings.envVars)) {
		if (cloudEnvVarNameProblem(name) !== null) continue;
		env[name] = value;
	}
	const identity = settings.gitIdentity;
	if (identity !== null) {
		env.GIT_AUTHOR_NAME = identity.name;
		env.GIT_AUTHOR_EMAIL = identity.email;
		env.GIT_COMMITTER_NAME = identity.name;
		env.GIT_COMMITTER_EMAIL = identity.email;
	}
	return env;
}

/** One MCP server as the sandbox's sidecar receives it: a URL and its placeholder headers. */
export interface SandboxMcpServer {
	name: string;
	url: string;
	headers: Record<string, string>;
}

/**
 * The servers the sandbox is told about, with every credential replaced by a placeholder. A
 * server with a problem is left out rather than handed over; the save refuses it, so this only
 * guards an object written by an older version.
 */
export function sandboxMcpServers(settings: CloudSettings): SandboxMcpServer[] {
	const servers: SandboxMcpServer[] = [];
	for (const name of Object.keys(settings.mcpServers).sort()) {
		const server = settings.mcpServers[name] as CloudMcpServer;
		if (cloudMcpServerNameProblem(name) !== null || cloudMcpServerProblem(server).length > 0)
			continue;
		const headers: Record<string, string> = {};
		if (server.authType === "bearer") {
			headers.authorization = `Bearer ${CLOUD_MCP_PLACEHOLDER}`;
		} else if (server.authType === "headers") {
			for (const header of Object.keys(server.headers ?? {})) {
				headers[header] = CLOUD_MCP_PLACEHOLDER;
			}
		}
		servers.push({ name, url: server.url, headers });
	}
	return servers;
}

/**
 * The variable a sandbox starts with, naming its cloud MCP servers and placeholders only. With no
 * servers it sets nothing, so a sandbox's environment is unchanged.
 */
export function cloudMcpServersEnv(settings: CloudSettings): Record<string, string> {
	const servers = sandboxMcpServers(settings);
	return servers.length === 0 ? {} : { CONDUCTED_CLOUD_MCP_SERVERS_JSON: JSON.stringify(servers) };
}

/** The bindings the settings store needs, kept narrow so a test needs no full Env. */
export interface CloudSettingsStore {
	BACKUPS: R2Bucket;
}

/**
 * The Worker's saved settings. A bucket that cannot be read is the caller's error: the settings
 * page must say it could not reach them rather than show empty ones.
 */
export async function readCloudSettings(store: CloudSettingsStore): Promise<CloudSettings> {
	const object = await store.BACKUPS.get(CLOUD_SETTINGS_KEY);
	if (object === null) return emptyCloudSettings();
	const parsed = parseCloudSettings(await object.json<unknown>());
	if (parsed === null) return emptyCloudSettings();
	return parsed;
}

/** Replaces the saved settings with `settings`, which the caller has already checked. */
export async function writeCloudSettings(
	store: CloudSettingsStore,
	settings: CloudSettings,
): Promise<void> {
	await store.BACKUPS.put(CLOUD_SETTINGS_KEY, JSON.stringify(settings));
}
