/**
 * @feature PR-06 Read a pull request's checks
 * @feature PR-07 Merge a pull request
 * @feature PRJ-02 Clone a GitHub repository
 * Owns: the messages the Account page, the merge bar and the GitHub failures show, the rule that
 * reads owner and name from a GitHub remote, the rule that picks the forge for a remote, and the
 * token shape check. These are the pure parts of the GitHub service.
 * Behaviour: services-map.md 3.1 (remotes), 5B.1.7 (merge), ui-map.md 6 (Account page).
 */
import { appError, err, ok, type Result } from "@conducted/shared";

/** Shown by the Account page when the text in the token field is not shaped like a GitHub token. */
export const GITHUB_TOKEN_WARNING = "That doesn't look like a GitHub token. Are you sure?";
export const GITHUB_UNAUTHORIZED_MESSAGE = "Reconnect GitHub in Settings to keep pushing changes.";
export const GITHUB_SAML_SSO_MESSAGE =
	"GitHub requires single sign-on for this organization. Authorize your account for the organization, then try again.";
/** Shown when the workspace's HEAD is not the pull request's head, so a merge would act on other code. */
export const GITHUB_HEAD_MISMATCH_MESSAGE =
	"Merge blocked: this workspace's code is different from the pull request's head. Pull the latest changes and try again.";

export type GithubFailureClass =
	| "unauthorized"
	| "saml-sso-required"
	| "missing-scope"
	| "offline"
	| "other";

/**
 * The scope the failure says is missing, when GitHub names one. The Account page and the toast
 * use it to say exactly which scope to add.
 */
export function missingScopeFrom(text: string): string | null {
	const accepted = /x-accepted-oauth-scopes:\s*([^\r\n]+)/i.exec(text);
	if (accepted !== null) return accepted[1]?.split(",")[0]?.trim() ?? null;
	const quoted = /scope[^.\r\n]{0,120}?["'`]([a-z][a-z0-9:_-]*)["'`]/i.exec(text);
	if (quoted !== null) return quoted[1] ?? null;
	const known =
		/(?:needs|requires|missing|add)[^.\r\n]{0,80}?\b(repo|gist|workflow|notifications|user|project|read:org|write:org|admin:org|read:packages|write:packages|delete:packages|read:discussion|write:discussion|read:project|write:project|codespace)\b["'`]?\s+scope/i.exec(
			text,
		);
	return known?.[1] ?? null;
}

/** The sentence the UI shows for a classified failure. Null when the class needs no message. */
export function githubFailureMessage(failure: GithubFailureClass, text: string): string | null {
	switch (failure) {
		case "unauthorized":
			return GITHUB_UNAUTHORIZED_MESSAGE;
		case "saml-sso-required":
			return GITHUB_SAML_SSO_MESSAGE;
		case "missing-scope": {
			const scope = missingScopeFrom(text);
			return scope === null
				? "GitHub access is missing a scope this action needs. Add it to your token and try again."
				: `GitHub access is missing the "${scope}" scope. Add it to your token and try again.`;
		}
		default:
			return null;
	}
}

/**
 * GitHub's personal access tokens start with a known prefix. A guard against a pasted password or
 * a half-copied value, not a validation: only GitHub can say whether a token works.
 */
export function looksLikeGithubToken(token: string): boolean {
	const trimmed = token.trim();
	return /^(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})$/.test(trimmed);
}

/**
 * The warning the Account page shows before saving a value that is not shaped like a GitHub
 * token. Null when the value looks right. Saving is the caller's decision after the user
 * confirms, because an enterprise token can have an unexpected prefix.
 */
export function githubTokenWarning(token: string): string | null {
	return looksLikeGithubToken(token) ? null : GITHUB_TOKEN_WARNING;
}

/** The owner and repository name GitHub needs for its REST paths. */
export interface GithubRepository {
	owner: string;
	name: string;
}

const NOT_GITHUB_REMOTE = "This repository has no GitHub remote.";

/** A GitHub remote: the host it names and the repository's owner and name. */
export interface GithubRemote extends GithubRepository {
	/** The host name, lower case, for example "github.com" or "ssh.github.com". */
	host: string;
}

/**
 * Whether a remote URL points at GitHub. Only github.com and ssh.github.com get the GitHub forge;
 * every other host is treated as local git (services-map 3.1).
 */
export function isGithubRemoteUrl(url: string): boolean {
	const trimmed = url.trim();
	if (trimmed.length === 0) return false;
	const scp = hasUrlScheme(trimmed) ? null : SCP_LIKE_REMOTE.exec(trimmed);
	if (scp !== null) return isGithubHost(scp[1]);
	try {
		return isGithubHost(new URL(trimmed).hostname);
	} catch {
		return false;
	}
}

/** Whether the text names a URL with a scheme, such as `https://` or `ssh://`. */
const hasUrlScheme = (url: string): boolean => /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(url);

/** git's scp-like remote, `user@host:owner/repo`. Only used when there is no URL scheme. */
const SCP_LIKE_REMOTE = /^[^@\s]+@([^:\s/]+):(.+)$/;

export const isGithubHost = (host: string | undefined): boolean => {
	const name = (host ?? "").toLowerCase();
	return name === "github.com" || name === "ssh.github.com";
};

/**
 * The forge a remote gets: GitHub for github.com only, local git for everything else, and local
 * git for a repository with no remote at all (null). The one home of this rule.
 */
export function forgeForRemoteUrl(url: string | null): "github" | "local" {
	return url !== null && isGithubRemoteUrl(url) ? "github" : "local";
}

/**
 * Reads `owner/name` out of a GitHub remote URL, in any of the shapes git stores: HTTPS, scp-like
 * SSH and an ssh:// URL. Every other host is refused, the same rule as `isGithubRemoteUrl`.
 */
export function githubRepositoryFromRemote(url: string): Result<GithubRepository> {
	const remote = githubRemoteFromUrl(url);
	return remote.ok ? ok({ owner: remote.value.owner, name: remote.value.name }) : remote;
}

/** The one parser behind `githubRepositoryFromRemote`, keeping the host as well. */
export function githubRemoteFromUrl(url: string): Result<GithubRemote> {
	const trimmed = url.trim();
	if (trimmed === "") return err(appError("github_not_github", NOT_GITHUB_REMOTE));
	let host: string;
	let path: string;
	const scp = hasUrlScheme(trimmed) ? null : SCP_LIKE_REMOTE.exec(trimmed);
	if (scp !== null) {
		host = scp[1] ?? "";
		path = scp[2] ?? "";
	} else {
		let parsed: URL;
		try {
			parsed = new URL(trimmed);
		} catch {
			return err(appError("github_not_github", NOT_GITHUB_REMOTE));
		}
		host = parsed.hostname;
		path = parsed.pathname;
	}
	if (!isGithubHost(host)) return err(appError("github_not_github", NOT_GITHUB_REMOTE));
	const parts = path
		.replace(/^\/+/, "")
		.replace(/\/+$/, "")
		.replace(/\.git$/i, "")
		.split("/")
		.filter((part) => part.length > 0);
	const owner = parts[0];
	const name = parts[1];
	if (owner === undefined || name === undefined) {
		return err(appError("github_not_github", NOT_GITHUB_REMOTE));
	}
	return ok({ host: host.toLowerCase(), owner, name });
}
