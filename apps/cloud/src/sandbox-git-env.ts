/**
 * @feature CLOUD-05 Secrets stay outside the sandbox: the outbound handler swaps in the model key and GitHub token
 * Owns: the part of the sandbox's environment that lets git and `gh` work without a secret and
 * without the user's own configuration: the `GH_TOKEN` placeholder the outbound handler replaces,
 * and services-map 3.9's scrub (no prompt, no system or global config, GitHub SSH remotes
 * rewritten to HTTPS, no credential helper, no hooks).
 * Behaviour: services-map.md 3.9 ("Scrubbed env for sandboxed git"), cloud-and-remote.md Part 1
 * ("Secrets never enter the sandbox") and D104. The scrub is Conductor's own list of variables;
 * the values are the standard git settings those variables name.
 * Must handle: a remote written `git@github.com:` or `ssh://git@github.com/` (both rewritten), a
 * global or system credential helper (reset), and a repository hook (disabled).
 * Our design choice: the credential helper stays empty rather than pointing at a script, because
 * the Worker adds the GitHub token to every GitHub request and the sandbox needs no helper.
 * Test first: holds only the placeholder token and rewrites GitHub SSH remotes to HTTPS.
 */

/** The value the sandbox sees where the Worker has the real GitHub token. */
export const GH_TOKEN_PLACEHOLDER = "provided-by-worker";

/**
 * Git's `GIT_CONFIG_*` environment for a list of `[key, value]` pairs. Git reads
 * `GIT_CONFIG_KEY_<n>` and `GIT_CONFIG_VALUE_<n>` for `n` from 0 to `GIT_CONFIG_COUNT - 1`.
 */
export function gitConfigEnvironment(
	pairs: readonly (readonly [string, string])[],
): Record<string, string> {
	const environment: Record<string, string> = { GIT_CONFIG_COUNT: String(pairs.length) };
	pairs.forEach(([key, value], index) => {
		environment[`GIT_CONFIG_KEY_${index}`] = key;
		environment[`GIT_CONFIG_VALUE_${index}`] = value;
	});
	return environment;
}

/**
 * The git settings the sandbox carries. The two rewrites send an SSH GitHub remote through the
 * Worker, where the token is added; the rest keeps the user's config, prompts and hooks out.
 */
const GIT_CONFIG_PAIRS: readonly (readonly [string, string])[] = [
	["url.https://github.com/.insteadOf", "git@github.com:"],
	["url.https://github.com/.insteadOf", "ssh://git@github.com/"],
	["credential.helper", ""],
	["credential.https://github.com.helper", ""],
	["core.hooksPath", "/dev/null"],
];

/**
 * The environment every sandbox command starts with for git and `gh`. `GH_TOKEN` is a marker, not
 * a token: the Worker's outbound handler replaces it.
 */
export const SANDBOX_GIT_ENV: Readonly<Record<string, string>> = Object.freeze({
	GH_TOKEN: GH_TOKEN_PLACEHOLDER,
	GIT_TERMINAL_PROMPT: "0",
	GIT_CONFIG_NOSYSTEM: "1",
	GIT_CONFIG_GLOBAL: "/dev/null",
	...gitConfigEnvironment(GIT_CONFIG_PAIRS),
});
