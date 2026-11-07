/**
 * @feature CLOUD-17 Cloud settings page
 * Owns: the personal cloud settings the desktop edits: the commit identity a cloud workspace uses
 * and the environment variables only cloud workspaces receive. They live in the Worker's own R2
 * bucket, beside the workspace backups, so every sandbox start reads the same answer and the
 * desktop never sends a secret into the sandbox.
 * Behaviour: docs/research/conductor/services-map.md 4.2.7 (the server key `gitIdentity`,
 * `{name, email}` for commits) and 4.2.8 (personal cloud variables); ui-map.md 6 Git ("Name and
 * email used for commits in cloud workspaces"). The page and its toasts are CLOUD-17; the
 * [environment_variables] `[cloud]` table of the desktop's settings files is the same idea for a
 * repository's own variables (SET-04).
 * Must handle: no saved settings (empty, no identity); a name or value of the wrong type; an
 * environment variable name that is not a shell name; a name the Worker itself sets (PATH, HOME,
 * the git scrub, the provider keys) so a user cannot break the sandbox or smuggle a credential in;
 * a bucket that cannot be read or written, which is the caller's error, never silently empty.
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

/** The personal cloud settings one Worker holds. */
export interface CloudSettings {
	gitIdentity: CloudGitIdentity | null;
	/** `personalCloudEnvVars`: names and values, given only to cloud workspaces. */
	envVars: Record<string, string>;
}

/** The settings a Worker that has never been given any answers with. */
export function emptyCloudSettings(): CloudSettings {
	return { gitIdentity: null, envVars: {} };
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

/** The body both `POST /settings` and the stored object accept. */
export const zCloudSettings = z
	.object({
		gitIdentity: zIdentity.nullable(),
		envVars: zEnvVars,
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
