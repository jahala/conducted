/**
 * @feature PR-01 GitHub service: access, health, merge and the personal access token
 * Owns: probing `gh` access (`gh auth status`, the user's login, the git protocol), the access
 * health store, reading and writing the personal access token, and merging a workspace's pull
 * request. Also owns PR-11's REST reads (issues, pull requests, recent repositories), turning
 * a GitHub issue or pull request into a workspace context file, the owners and repositories
 * the clone picker lists (PRJ-02), and moving an open pull request's base when the target branch
 * changes (GIT-08).
 * Behaviour: services-map.md 3.9 (auth probes, method resolution, health), 5B.1.11 (failure
 * classes; only unauthorized breaks access), 5B.1.7 (merge method and dedupe), 2.5.2 and
 * 5B.1.10 (GitHub reads for the workspace pickers), 5B.8.2 (open issues, 50 newest), 5B.8.3
 * (an issue becomes `[GITHUB]-<n>.md`, a pull request `.context/pull-requests/<n>.md`),
 * ui-map.md 6 (Account: GitHub through the `gh` CLI or a personal access token).
 * Must handle: `gh` missing, signed out, unauthorized, offline, an SSO requirement and a missing
 * scope, with the failure class kept on the access state; only unauthorized marks access broken;
 * GH_TOKEN is passed only when the resolved method is pat; a merge is pinned to the local HEAD
 * and refused when HEAD cannot be read; the merge method follows the repo's allowed methods
 * (squash, then rebase, then merge); two merge calls at once send one `gh pr merge`; a token that
 * does not look like one is a warning the caller can confirm, not a refusal, but an empty one is
 * refused; every `gh` result updates the health store; only the newest access check writes the
 * access state; a response the app cannot parse is an error, not an empty list; a context file is
 * reported as written only after the file was written.
 * Our design choice: access is the user's own `gh auth login`, or the personal access token the
 * user saved on the Account page (D029). The token is kept in the Keychain and given to `gh` as
 * GH_TOKEN; nothing is brokered per session. Polling, the remaining write actions and the stack
 * catch-up belong to other features (PR-03, PR-05, PR-06, PR-08, PR-10, PR-12).
 * Test first: two merge calls at once send one `gh pr merge`.
 * PR-11 test first: an issue with a `pull_request` field is left out of the issues list.
 */
import {
	type AppError,
	appError,
	err,
	notImplemented,
	ok,
	type Result,
	type WorkspaceId,
} from "@conducted/shared";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { FileSystem, Keychain, ShellOutput, Unsubscribe } from "../../platform/platform.ts";
import { createLatestWins } from "../async/latest-wins.ts";
import { createSingleFlight, type SingleFlight } from "../async/single-flight.ts";
import {
	type GitCommand,
	lsFiles,
	remoteGetUrl,
	revParseHead,
	statusPorcelainAll,
} from "../git/commands.ts";
import {
	apiUserLogin,
	authStatus,
	configGetGitProtocol,
	githubOwnerRepositories,
	githubUserOrganizations,
	issueByNumber as issueByNumberCommand,
	type MergeMethod,
	prCreateWeb,
	prEdit,
	prMerge,
	prViewState,
	pullRequestByNumber as pullRequestByNumberCommand,
	recentRepositories,
	repoMergeMethodsQuery,
	repositoryIssues,
	repositoryPullRequests,
} from "../git/gh-commands.ts";
import { failedCommandError, type GitRunner, isSuccessfulExit } from "../git/runner.ts";
import type {
	GitHubAccess as GitHubAccessView,
	GitHubOwner,
	GitHubRepoSummary,
	IssueView,
	PullRequest,
	PullRequestSummary,
} from "../model.ts";
import { createPrInstruction } from "./agent-instructions.ts";
import type { GitCache } from "./git-cache.ts";
import { buildDeepLink } from "./notifications.ts";
import type { PollRole } from "./pr-polling.ts";
import type { AgentMessenger } from "./sessions.ts";

/** The paths GitHub reads a pull request template from, in the order the research lists them. */
export const PR_TEMPLATE_PATHS = [
	"pull_request_template.md",
	".github/pull_request_template.md",
	"docs/pull_request_template.md",
] as const;

/** The Keychain entry the Account page writes and `gh` receives as GH_TOKEN (D029). */
export const GH_PAT_KEYCHAIN_KEY = "gh_pat_token";
/** Shown by the Account page when the text in the token field is not shaped like a GitHub token. */
export const GITHUB_TOKEN_WARNING = "That doesn't look like a GitHub token. Are you sure?";
/** Shown when a refresh of GitHub data fails for a reason the service cannot classify. */
export const GITHUB_REFRESH_FAILED_MESSAGE = "Couldn't refresh GitHub";
export const GITHUB_UNAUTHORIZED_MESSAGE =
	"GitHub denied the request. Sign in again with `gh auth login`, or update your token on the Account page.";
export const GITHUB_SAML_SSO_MESSAGE =
	"GitHub requires single sign-on for this organization. Authorize your account for the organization, then try again.";

export type GithubAuthMethod = "cli" | "pat";
export type GithubFailureClass =
	| "unauthorized"
	| "saml-sso-required"
	| "missing-scope"
	| "offline"
	| "other";

export type GithubAccess =
	| { status: "unknown"; reason?: "check_failed" }
	| {
			status: "ok";
			login: string;
			host: string;
			scopes: string[];
			usesToken: boolean;
			gitProtocol: string | null;
	  }
	| { status: "gh_missing" }
	/** `failure` keeps a class the UI must explain, such as an SSO requirement or a missing scope. */
	| { status: "signed_out"; failure?: GithubFailureClass }
	| { status: "unauthorized" }
	| { status: "offline" };

/** What the health check keeps about GitHub access (services-map 5B.1.11). */
export interface GithubHealth {
	status: "unknown" | "ok" | "broken";
	reason: GithubFailureClass | null;
	authMethod: GithubAuthMethod;
	lastSuccessAtMs: number | null;
	lastFailureAtMs: number | null;
}

// ---------------------------------------------------------------- pure access helpers

/**
 * The class of a `gh` failure, from its output. Unauthorized means the sign-in is no longer
 * accepted; the other classes tell the user what to fix.
 */
export function classifyGhFailure(text: string): GithubFailureClass {
	const lower = text.toLowerCase();
	if (/bad credentials|http 401|"status"\s*:\s*"?401|status\s*:?\s*401/.test(lower)) {
		return "unauthorized";
	}
	if (/saml enforcement|saml sso|saml-sso|requires saml|sso for this organization/.test(lower)) {
		return "saml-sso-required";
	}
	if (/(\b403\b|forbidden)/.test(lower) && /scope/.test(lower)) {
		return "missing-scope";
	}
	if (
		/could not resolve host|connection refused|network is unreachable|no such host|temporary failure in name resolution|dial tcp|timed out|timeout/.test(
			lower,
		)
	) {
		return "offline";
	}
	return "other";
}

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

export interface ParsedAuthStatus {
	login: string | null;
	host: string | null;
	scopes: string[];
}

/** Reads the signed-in account, host and token scopes out of `gh auth status` output. */
export function parseAuthStatus(text: string): ParsedAuthStatus {
	const modern = /logged in to (\S+) account (\S+)/i.exec(text);
	const older = /logged in to (\S+) as (\S+)/i.exec(text);
	const match = modern ?? older;
	const scopesLine = /token scopes:\s*([^\r\n]+)/i.exec(text);
	const scopesText = scopesLine?.[1] ?? "";
	const scopes = scopesText
		.split(",")
		.map((scope) => scope.trim().replace(/^['"`]|['"`]$/g, ""))
		.filter((scope) => scope.length > 0 && scope.toLowerCase() !== "none");
	return { login: match?.[2] ?? null, host: match?.[1] ?? null, scopes };
}

/**
 * Whether a remote URL points at GitHub. Only github.com and ssh.github.com get the GitHub forge;
 * every other host is treated as local git (services-map 3.1).
 */
export function isGithubRemoteUrl(url: string): boolean {
	const trimmed = url.trim();
	if (trimmed.length === 0) return false;
	const scp = /^[^@\s]+@([^:\s/]+):/.exec(trimmed);
	if (scp !== null) return isGithubHost(scp[1]);
	try {
		return isGithubHost(new URL(trimmed).hostname);
	} catch {
		return false;
	}
}

const isGithubHost = (host: string | undefined): boolean => {
	const name = (host ?? "").toLowerCase();
	return name === "github.com" || name === "ssh.github.com";
};

/** The forge a remote gets: GitHub for github.com only, local git for everything else. */
export function forgeForRemoteUrl(url: string): "github" | "local" {
	return isGithubRemoteUrl(url) ? "github" : "local";
}

/** The owner and repository name GitHub needs for its REST paths. */
export interface GithubRepository {
	owner: string;
	name: string;
}

const NOT_GITHUB_REMOTE = "This repository has no GitHub remote.";

/**
 * Reads `owner/name` out of a GitHub remote URL, in any of the shapes git stores: HTTPS, scp-like
 * SSH and an ssh:// URL. Every other host is refused, the same rule as `isGithubRemoteUrl`.
 */
export function githubRepositoryFromRemote(url: string): Result<GithubRepository> {
	const trimmed = url.trim();
	if (trimmed === "") return err(appError("github_not_github", NOT_GITHUB_REMOTE));
	let path: string;
	const scp = /^[^@\s]+@([^:\s/]+):(.+)$/.exec(trimmed);
	if (scp !== null) {
		if (!isGithubHost(scp[1])) return err(appError("github_not_github", NOT_GITHUB_REMOTE));
		path = scp[2] ?? "";
	} else {
		let parsed: URL;
		try {
			parsed = new URL(trimmed);
		} catch {
			return err(appError("github_not_github", NOT_GITHUB_REMOTE));
		}
		if (!isGithubHost(parsed.hostname)) {
			return err(appError("github_not_github", NOT_GITHUB_REMOTE));
		}
		path = parsed.pathname;
	}
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
	return ok({ owner, name });
}

/** Whether the issues tab may ask GitHub for this repository (services-map 5B.8.2). */
export function canListGithubIssues(remoteUrl: string | null, access: GithubAccess): boolean {
	return remoteUrl !== null && isGithubRemoteUrl(remoteUrl) && access.status === "ok";
}

/** Whether the pull request picker may ask GitHub for this repository. */
export function canListGithubPullRequests(remoteUrl: string | null): boolean {
	return remoteUrl !== null && isGithubRemoteUrl(remoteUrl);
}

function repositoryPath(repository: GithubRepository): string {
	return `${repository.owner}/${repository.name}`;
}

function issueNumber(id: string): Result<number> {
	const trimmed = id.trim();
	const parsed = Number.parseInt(trimmed, 10);
	if (!/^\d+$/.test(trimmed) || !Number.isSafeInteger(parsed) || parsed <= 0) {
		return err(appError("github_issue_invalid", "That is not a GitHub issue number."));
	}
	return ok(parsed);
}

// ---------------------------------------------------------------- REST responses

export interface GithubIssueRecord {
	view: IssueView;
	body: string | null;
	/** GitHub's issue endpoint also returns pull requests, marked by this field. */
	pullRequest: boolean;
}

export interface GithubPullRequestRecord extends PullRequestSummary {
	url: string;
	body: string | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const responseInvalid = (): AppError =>
	appError("github_response_invalid", "GitHub sent a response the app could not read.");

function parseJson(text: string): Result<unknown> {
	try {
		return ok(JSON.parse(text));
	} catch (error) {
		return err(
			appError("github_response_invalid", "GitHub sent a response the app could not read.", error),
		);
	}
}

function stringField(record: Record<string, unknown>, key: string): string | null {
	const value = record[key];
	return typeof value === "string" ? value : null;
}

function parseTimestamp(text: string | null): number | null {
	if (text === null) return null;
	const at = Date.parse(text);
	return Number.isNaN(at) ? null : at;
}

function parseIssueRecord(raw: unknown): Result<GithubIssueRecord> {
	if (!isRecord(raw)) return err(responseInvalid());
	const number = raw.number;
	const title = stringField(raw, "title");
	const url = stringField(raw, "html_url");
	const state = stringField(raw, "state");
	const updatedAt = parseTimestamp(stringField(raw, "updated_at"));
	if (
		typeof number !== "number" ||
		!Number.isSafeInteger(number) ||
		title === null ||
		url === null ||
		state === null ||
		updatedAt === null
	) {
		return err(responseInvalid());
	}
	return ok({
		view: {
			provider: "github",
			id: String(number),
			identifier: `#${number}`,
			title,
			url,
			state,
			branchName: null,
			updatedAt,
		},
		body: stringField(raw, "body"),
		pullRequest: raw.pull_request !== undefined && raw.pull_request !== null,
	});
}

function parsePullRequestRecord(raw: unknown): Result<GithubPullRequestRecord> {
	if (!isRecord(raw)) return err(responseInvalid());
	const number = raw.number;
	const title = stringField(raw, "title");
	const updatedAt = parseTimestamp(stringField(raw, "updated_at"));
	const url = stringField(raw, "html_url");
	const head = raw.head;
	const branch = isRecord(head) ? stringField(head, "ref") : null;
	if (
		typeof number !== "number" ||
		!Number.isSafeInteger(number) ||
		title === null ||
		updatedAt === null ||
		url === null ||
		branch === null
	) {
		return err(responseInvalid());
	}
	const user = raw.user;
	const authorLogin = isRecord(user) ? stringField(user, "login") : null;
	const authorAvatarUrl = isRecord(user) ? stringField(user, "avatar_url") : null;
	const merged = stringField(raw, "merged_at") !== null;
	const draft = raw.draft === true;
	const state = draft
		? "draft"
		: merged
			? "merged"
			: stringField(raw, "state") === "open"
				? "open"
				: "closed";
	return ok({
		number,
		title,
		branch,
		authorLogin,
		authorAvatarUrl,
		state,
		updatedAt,
		url,
		body: stringField(raw, "body"),
	});
}

/** Parses the open issues GitHub returned, dropping the pull requests it lists there too. */
export function parseGithubIssues(text: string): Result<IssueView[]> {
	const json = parseJson(text);
	if (!json.ok) return err(json.error);
	if (!Array.isArray(json.value)) return err(responseInvalid());
	const issues: IssueView[] = [];
	for (const item of json.value) {
		if (isRecord(item) && item.pull_request !== undefined && item.pull_request !== null) continue;
		const parsed = parseIssueRecord(item);
		if (!parsed.ok) return err(parsed.error);
		issues.push(parsed.value.view);
	}
	return ok(issues);
}

/** Parses the single issue or pull request from its number endpoint. */
export function parseGithubIssue(text: string): Result<GithubIssueRecord> {
	const json = parseJson(text);
	if (!json.ok) return err(json.error);
	return parseIssueRecord(json.value);
}

export function parseGithubPullRequests(text: string): Result<PullRequestSummary[]> {
	const json = parseJson(text);
	if (!json.ok) return err(json.error);
	if (!Array.isArray(json.value)) return err(responseInvalid());
	const rows: PullRequestSummary[] = [];
	for (const item of json.value) {
		const parsed = parsePullRequestRecord(item);
		if (!parsed.ok) return err(parsed.error);
		rows.push({
			number: parsed.value.number,
			title: parsed.value.title,
			branch: parsed.value.branch,
			authorLogin: parsed.value.authorLogin,
			authorAvatarUrl: parsed.value.authorAvatarUrl,
			state: parsed.value.state,
			updatedAt: parsed.value.updatedAt,
		});
	}
	return ok(rows);
}

export function parseGithubPullRequest(text: string): Result<GithubPullRequestRecord> {
	const json = parseJson(text);
	if (!json.ok) return err(json.error);
	return parsePullRequestRecord(json.value);
}

export function parseGithubRepos(text: string): Result<GitHubRepoSummary[]> {
	const json = parseJson(text);
	if (!json.ok) return err(json.error);
	if (!Array.isArray(json.value)) return err(responseInvalid());
	const repos: GitHubRepoSummary[] = [];
	for (const item of json.value) {
		if (!isRecord(item)) return err(responseInvalid());
		const name = stringField(item, "name");
		const cloneUrl = stringField(item, "clone_url");
		const updatedAt = parseTimestamp(stringField(item, "updated_at"));
		const owner = item.owner;
		const login = isRecord(owner) ? stringField(owner, "login") : null;
		if (name === null || cloneUrl === null || updatedAt === null || login === null) {
			return err(responseInvalid());
		}
		repos.push({
			owner: login,
			name,
			description: stringField(item, "description"),
			isPrivate: item.private === true,
			cloneUrl,
			updatedAt,
		});
	}
	return ok(repos);
}

// ---------------------------------------------------------------- context files

/** Replaces everything GitHub does not allow in a folder name (services-map 5B.8.3). */
export function sanitizeIssueKey(key: string): string {
	return key.replace(/[^A-Za-z0-9._-]/g, "-");
}

/** Relative path of a GitHub issue's context file inside a workspace. */
export function githubIssueContextPath(id: string): string {
	return `.context/attachments/${sanitizeIssueKey(`github:${id}`)}/[GITHUB]-${id}.md`;
}

/** Relative path of a pull request's context file inside a workspace. */
export function pullRequestContextPath(number: number): string {
	return `.context/pull-requests/${number}.md`;
}

export function githubIssueContextFile(record: GithubIssueRecord): string {
	const body = record.body?.trim() ?? "";
	return `# ${record.view.identifier}: ${record.view.title}\n\n- Source: ${record.view.url}\n- State: ${record.view.state}\n\n${body.length > 0 ? body : "No description."}\n`;
}

export function githubPullRequestContextFile(record: GithubPullRequestRecord): string {
	const body = record.body?.trim() ?? "";
	return `# Pull request #${record.number}: ${record.title}\n\n- Source: ${record.url}\n- State: ${record.state}\n- Branch: ${record.branch}\n\n${body.length > 0 ? body : "No description."}\n`;
}

function absolutePath(root: string, relative: string): string {
	return `${root.replace(/\/+$/, "")}/${relative}`;
}

function matchesQuery(query: string, values: readonly string[]): boolean {
	const needle = query.trim().toLowerCase();
	if (needle === "") return true;
	return values.some((value) => value.toLowerCase().includes(needle));
}

/**
 * The repository's pull request template, when it has one. GitHub looks for the three names
 * below; the comparison ignores case because GitHub's does too.
 */
export function findPrTemplate(paths: readonly string[]): string | null {
	const byLower = new Map(paths.map((path) => [path.toLowerCase(), path]));
	for (const candidate of PR_TEMPLATE_PATHS) {
		const found = byLower.get(candidate);
		if (found !== undefined) return found;
	}
	return null;
}

/**
 * The sign-in method Conductor offers (D029): an explicit `gh_auth_method` wins, otherwise a
 * saved token means pat and nothing saved means the user's own gh login.
 */
export function resolveGhAuthMethod(
	explicit: string | null | undefined,
	hasStoredToken: boolean,
): GithubAuthMethod {
	return explicit === "cli" || explicit === "pat" ? explicit : hasStoredToken ? "pat" : "cli";
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

/** The merge method GitHub allows, in Conductor's preference order (services-map 5B.1.7). */
export function chooseMergeMethod(output: string): MergeMethod | null {
	let allowed: unknown;
	try {
		allowed = JSON.parse(output);
	} catch {
		return null;
	}
	if (!Array.isArray(allowed)) return null;
	if (allowed[0] === true) return "squash";
	if (allowed[1] === true) return "rebase";
	if (allowed[2] === true) return "merge";
	return null;
}

/** Maps the service's access state to the shape the Account page reads (model.ts). */
export function toGitHubAccessView(access: GithubAccess): GitHubAccessView {
	switch (access.status) {
		case "ok":
			return {
				state: "signed_in",
				login: access.login,
				host: access.host,
				scopes: access.scopes,
				usesToken: access.usesToken,
			};
		case "gh_missing":
			return { state: "gh_missing" };
		// A rejected sign-in is fixed the same way as a sign-out, so the page offers that command.
		case "signed_out":
		case "unauthorized":
			return { state: "signed_out" };
		case "offline":
			return { state: "unknown", reason: "offline" };
		case "unknown":
			return { state: "unknown", reason: "check_failed" };
	}
}

/** The access a probe that could not run means: no `gh` program, or a check that failed. */
function accessFromProbeError(code: string): GithubAccess {
	return code === "process_spawn"
		? { status: "gh_missing" }
		: { status: "unknown", reason: "check_failed" };
}

/** The access state a failed probe means. Only the failure class changes the answer. */
function accessFromFailure(text: string): GithubAccess {
	const failure = classifyGhFailure(text);
	if (failure === "unauthorized") return { status: "unauthorized" };
	if (failure === "offline") return { status: "offline" };
	if (failure === "saml-sso-required" || failure === "missing-scope") {
		return { status: "signed_out", failure };
	}
	return { status: "signed_out" };
}

/** Reads the organisation logins `gh api user/orgs` prints, one per line, without repeats. */
export function parseGithubOrgLogins(text: string): string[] {
	const seen = new Set<string>();
	const logins: string[] = [];
	for (const line of text.split(/\r?\n/)) {
		const login = line.trim();
		if (login === "" || seen.has(login)) continue;
		seen.add(login);
		logins.push(login);
	}
	return logins;
}

/** The signed-in account first, then its organisations, as the owner picker shows them. */
export function githubOwnersFrom(
	login: string | null,
	organisations: readonly string[],
): GitHubOwner[] {
	const owners: GitHubOwner[] = [];
	if (login !== null && login !== "") {
		owners.push({ login, kind: "user", avatarUrl: null });
	}
	for (const organisation of organisations) {
		if (organisation === login) continue;
		owners.push({ login: organisation, kind: "organization", avatarUrl: null });
	}
	return owners;
}

interface RawGithubRepository {
	name?: unknown;
	owner?: { login?: unknown } | null;
	description?: unknown;
	isPrivate?: unknown;
	sshUrl?: unknown;
	url?: unknown;
	updatedAt?: unknown;
}

/** Reads `gh repo list --json` output. A shape it does not understand is an error, not an empty list. */
export function parseGithubRepositories(text: string): Result<GitHubRepoSummary[]> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return err(appError("github_response_invalid", "GitHub's repository list could not be read."));
	}
	if (!Array.isArray(parsed)) {
		return err(appError("github_response_invalid", "GitHub's repository list could not be read."));
	}
	const repositories: GitHubRepoSummary[] = [];
	for (const entry of parsed) {
		if (typeof entry !== "object" || entry === null) {
			return err(
				appError("github_response_invalid", "GitHub's repository list could not be read."),
			);
		}
		const raw = entry as RawGithubRepository;
		const name = typeof raw.name === "string" ? raw.name : "";
		const owner =
			typeof raw.owner === "object" &&
			raw.owner !== null &&
			typeof raw.owner.login === "string" &&
			raw.owner.login !== ""
				? raw.owner.login
				: "";
		if (name === "" || owner === "" || typeof raw.isPrivate !== "boolean") {
			return err(
				appError("github_response_invalid", "GitHub's repository list could not be read."),
			);
		}
		const updatedAtMs = typeof raw.updatedAt === "string" ? Date.parse(raw.updatedAt) : Number.NaN;
		if (!Number.isFinite(updatedAtMs)) {
			return err(
				appError("github_response_invalid", "GitHub's repository list could not be read."),
			);
		}
		const sshUrl = typeof raw.sshUrl === "string" && raw.sshUrl !== "" ? raw.sshUrl : null;
		const webUrl = typeof raw.url === "string" && raw.url !== "" ? raw.url : null;
		repositories.push({
			owner,
			name,
			description: typeof raw.description === "string" ? raw.description : null,
			isPrivate: raw.isPrivate,
			cloneUrl: sshUrl ?? webUrl ?? `https://github.com/${owner}/${name}.git`,
			updatedAt: updatedAtMs,
		});
	}
	return ok(repositories);
}

/** The error a `gh` command that did not succeed means, with its classified message when it has one. */
function ghCommandError(command: GitCommand, output: ShellOutput): AppError {
	const text = `${output.stderr}\n${output.stdout}`;
	const message = githubFailureMessage(classifyGhFailure(text), text);
	return message === null
		? failedCommandError(command, output)
		: appError("github_failed", message);
}

/** The repositories whose name, owner/name or description contains the query. */
export function filterGithubRepositories(
	repositories: readonly GitHubRepoSummary[],
	query: string,
): GitHubRepoSummary[] {
	const needle = query.trim().toLowerCase();
	if (needle === "") return [...repositories];
	return repositories.filter((repository) => {
		const label = `${repository.owner}/${repository.name}`.toLowerCase();
		const description = (repository.description ?? "").toLowerCase();
		return label.includes(needle) || description.includes(needle);
	});
}

export interface WorkspacePrEntry {
	pullRequest: PullRequest | null;
	/** Why there is no PR to show, when there is not. */
	unavailable: "none" | "offline" | "no_github_access" | "not_github" | "loading" | "no_pr";
	fetchedAt: number | null;
}

export interface GithubState {
	access: GithubAccess;
	health: GithubHealth;
	byWorkspace: Readonly<Record<string, WorkspacePrEntry>>;
}

export interface PrWorkspaceContext {
	workspaceId: WorkspaceId;
	workspacePath: string;
	branch: string;
	/** Name of the remote, for example "origin". */
	remote: string;
	prNumber: number | null;
	/** The target branch as stored, for example "origin/main". */
	targetBranch?: string;
	/** The repository's custom Create PR prompt, read from its loaded config. */
	customPrompt?: string | null;
}

/** Why a catch-up did not rebase. Every one is a normal answer, not an error. */
export type CatchUpSkipReason =
	| "not_in_stack"
	| "no_write_permission"
	| "not_diverged"
	| "detached_head"
	| "identity_changed"
	| "no_baseline"
	| "dirty_tree"
	| "operation_in_progress"
	| "ignored_file_collision";

export type CatchUpOutcome =
	| { kind: "rebased"; newTip: string }
	| { kind: "skipped"; reason: CatchUpSkipReason };

interface GhCallSettings {
	authMethod: GithubAuthMethod;
	/** GH_TOKEN, present only for the pat method. */
	env: Readonly<Record<string, string>> | undefined;
}

export interface GithubServiceDeps {
	git: GitRunner;
	/** The last pull request info of each workspace, shown before the first poll answers (DATA-07). */
	cache: GitCache;
	agent: AgentMessenger;
	contextOf: (workspaceId: WorkspaceId) => Promise<Result<PrWorkspaceContext>>;
	/** Called when a PR becomes merged, so the workspace service can archive on merge. */
	onMerged: (workspaceId: WorkspaceId, prNumber: number) => void;
	now: () => number;
	/** The Keychain the Account page's token is kept in (D029). */
	keychain?: Pick<Keychain, "get" | "set" | "delete">;
	/** Reads `gh_auth_method` (services-map 3.9, D029). */
	setting?: <T>(key: string) => T;
	/** Folder for probes that belong to no workspace, normally the user's home folder. */
	probeCwd: string;
	/** Writes a context file into a workspace (PR-11). */
	fs?: Pick<FileSystem, "mkdirp" | "writeTextAtomic">;
}

export class GithubService {
	readonly store: StoreApi<GithubState>;
	readonly #deps: GithubServiceDeps;
	/** Makes each PR action run once while it is in flight (services-map 5B.1.7). */
	readonly #flights: SingleFlight<string>;
	/** Only the newest access check may write `access`; an older one that ends late is dropped. */
	readonly #accessChecks = createLatestWins();

	constructor(deps: GithubServiceDeps) {
		this.#deps = deps;
		this.#flights = createSingleFlight<string>();
		this.store = createStore<GithubState>(() => ({
			access: { status: "unknown" },
			health: {
				status: "unknown",
				reason: null,
				authMethod: "cli",
				lastSuccessAtMs: null,
				lastFailureAtMs: null,
			},
			byWorkspace: {},
		}));
	}

	/** Runs `gh auth status` and `gh api user`, reads the git protocol, and updates `access`. */
	async checkAccess(): Promise<Result<GithubAccess>> {
		const ticket = this.#accessChecks.begin("access");
		const probed = await this.#probeAccess();
		const latest = this.#accessChecks.isLatest(ticket);
		this.#accessChecks.settle(ticket);
		// A newer check started while this one ran, so its answer owns the store.
		if (!latest) return ok(this.store.getState().access);
		this.#setAccess(probed.ok ? probed.value : { status: "unknown", reason: "check_failed" });
		return probed;
	}

	/** The probes of `checkAccess`. They read the machine and return the access; the store is the caller's. */
	async #probeAccess(): Promise<Result<GithubAccess>> {
		const settings = await this.#ghSettings();
		if (!settings.ok) return err(settings.error);
		const runOptions = this.#runOptions(settings.value);
		const auth = await this.#deps.git.run(authStatus(), runOptions);
		if (!auth.ok) return ok(accessFromProbeError(auth.error.code));

		const authText = `${auth.value.stderr}\n${auth.value.stdout}`;
		await this.recordGhResult(auth.value);
		if (auth.value.exitCode !== 0) return ok(accessFromFailure(authText));
		if (!/logged in to /i.test(authText)) return ok({ status: "signed_out" });

		const parsed = parseAuthStatus(authText);
		const user = await this.#deps.git.run(apiUserLogin(), runOptions);
		if (!user.ok) return ok(accessFromProbeError(user.error.code));
		await this.recordGhResult(user.value);
		if (user.value.exitCode !== 0) {
			return ok(accessFromFailure(`${user.value.stderr}\n${user.value.stdout}`));
		}
		const login = user.value.stdout.trim();
		if (login.length === 0) return ok({ status: "unknown", reason: "check_failed" });

		const protocol = await this.#deps.git.run(configGetGitProtocol(), runOptions);
		let gitProtocol: string | null = null;
		if (protocol.ok) {
			await this.recordGhResult(protocol.value);
			const value = protocol.value.stdout.trim();
			gitProtocol = protocol.value.exitCode === 0 && value.length > 0 ? value : null;
		}

		return ok({
			status: "ok",
			login,
			host: parsed.host ?? "github.com",
			scopes: parsed.scopes,
			usesToken: settings.value.env !== undefined,
			gitProtocol,
		});
	}

	/** Backs `Actions.app.recheckGitHubAccess`: runs the access probes again and updates the store. */
	async recheckAccess(): Promise<Result<void>> {
		const result = await this.checkAccess();
		return result.ok
			? ok(undefined)
			: err(appError("github_refresh_failed", GITHUB_REFRESH_FAILED_MESSAGE, result.error));
	}

	/**
	 * The owners the clone picker offers: the signed-in account first, then the user's organisations.
	 * Reads them with `gh api user/orgs --paginate` (services-map 3.9).
	 */
	async listOwners(): Promise<Result<GitHubOwner[]>> {
		const settings = await this.#ghSettings();
		if (!settings.ok) return err(settings.error);
		const command = githubUserOrganizations();
		const result = await this.#deps.git.run(command, this.#runOptions(settings.value));
		if (!result.ok) return err(result.error);
		await this.recordGhResult(result.value);
		if (!isSuccessfulExit(command, result.value.exitCode)) {
			return err(ghCommandError(command, result.value));
		}
		const access = this.store.getState().access;
		const login = access.status === "ok" ? access.login : null;
		return ok(githubOwnersFrom(login, parseGithubOrgLogins(result.value.stdout)));
	}

	/**
	 * One owner's repositories, filtered by the picker's query. `gh repo list` answers in JSON, so a
	 * shape this file cannot read is an error rather than a shorter list.
	 */
	async listRepositories(owner: string, query: string): Promise<Result<GitHubRepoSummary[]>> {
		const trimmedOwner = owner.trim();
		if (trimmedOwner === "") {
			return err(appError("github_owner_missing", "Choose a GitHub account or organisation."));
		}
		const settings = await this.#ghSettings();
		if (!settings.ok) return err(settings.error);
		const command = githubOwnerRepositories(trimmedOwner);
		const result = await this.#deps.git.run(command, this.#runOptions(settings.value));
		if (!result.ok) return err(result.error);
		await this.recordGhResult(result.value);
		if (!isSuccessfulExit(command, result.value.exitCode)) {
			return err(ghCommandError(command, result.value));
		}
		const parsed = parseGithubRepositories(result.value.stdout);
		if (!parsed.ok) return parsed;
		return ok(filterGithubRepositories(parsed.value, query));
	}

	/**
	 * Records what one `gh` call did (services-map 5B.1.11). Every action calls this, so the health
	 * store is never stale. Only an unauthorized answer marks access broken.
	 */
	async recordGhResult(output: {
		exitCode: number;
		stdout: string;
		stderr: string;
	}): Promise<void> {
		const authMethod = await this.#authMethod();
		const previous = this.store.getState().health;
		const now = this.#deps.now();
		if (output.exitCode === 0) {
			this.store.setState({
				health: {
					...previous,
					status: "ok",
					reason: null,
					authMethod,
					lastSuccessAtMs: now,
				},
			});
			return;
		}
		const reason = classifyGhFailure(`${output.stderr}\n${output.stdout}`);
		this.store.setState({
			health: {
				...previous,
				status: reason === "unauthorized" ? "broken" : previous.status,
				reason,
				authMethod,
				lastFailureAtMs: now,
			},
		});
	}

	#setAccess(access: GithubAccess): GithubAccess {
		this.store.setState({ access });
		return access;
	}

	#runOptions(settings: GhCallSettings, cwd = this.#deps.probeCwd) {
		return {
			cwd,
			...(settings.env === undefined ? {} : { env: settings.env }),
		};
	}

	async #readToken(): Promise<Result<string | null>> {
		const keychain = this.#deps.keychain;
		if (keychain === undefined) return ok(null);
		return keychain.get(GH_PAT_KEYCHAIN_KEY);
	}

	/**
	 * One place for how a `gh` call is signed in. The saved token is read once and reaches `gh`
	 * only when the resolved method is pat, so an explicit `cli` choice is never overridden by a
	 * leftover Keychain value.
	 */
	async #ghSettings(): Promise<Result<GhCallSettings>> {
		const setting = this.#deps.setting;
		const explicit = setting === undefined ? null : setting<string>("gh_auth_method");
		if (explicit === "cli") return ok({ authMethod: "cli", env: undefined });
		const token = await this.#readToken();
		if (!token.ok) return err(token.error);
		const authMethod = resolveGhAuthMethod(explicit, token.value !== null);
		const inject = authMethod === "pat" ? token.value : null;
		return ok({
			authMethod,
			env: inject === null ? undefined : { GH_TOKEN: inject },
		});
	}

	async #authMethod(): Promise<GithubAuthMethod> {
		const settings = await this.#ghSettings();
		return settings.ok ? settings.value.authMethod : "cli";
	}

	watch(_workspaceId: WorkspaceId, _role: PollRole): Unsubscribe {
		return notImplemented("PR-03");
	}

	pollNow(_workspaceId: WorkspaceId): Promise<Result<void>> {
		return notImplemented("PR-03");
	}

	/** Backs `Actions.pullRequests.create`: asks the agent to open the PR. */
	async create(workspaceId: WorkspaceId): Promise<Result<void>> {
		const context = await this.#deps.contextOf(workspaceId);
		if (!context.ok) return err(context.error);
		const found = context.value;
		const target = this.#targetBranchOf(found);
		if (!target.ok) return target;
		const forge = await this.#assertGithubRemote(found);
		if (!forge.ok) return forge;

		const cwd = found.workspacePath;
		const [status, files] = await Promise.all([
			this.#deps.git.stdout(statusPorcelainAll(), { cwd }),
			this.#deps.git.stdout(lsFiles(), { cwd }),
		]);
		if (!status.ok) return err(status.error);
		if (!files.ok) return err(files.error);

		const includeLink = this.#deps.setting?.<boolean>("include_workspace_link_in_pr") ?? false;
		const text = createPrInstruction({
			remote: found.remote,
			targetBranch: target.value,
			branch: found.branch,
			customPrompt: found.customPrompt ?? null,
			prTemplatePath: findPrTemplate(
				files.value
					.split("\n")
					.map((path) => path.trim())
					.filter((path) => path.length > 0),
			),
			hasUncommittedChanges: status.value.trim().length > 0,
			workspaceLink: includeLink ? buildDeepLink(found.workspaceId, null) : null,
		});
		const sent = await this.#deps.agent.sendInstruction(workspaceId, text);
		return sent.ok ? ok(undefined) : err(sent.error);
	}

	/** Opens GitHub's new-PR page in the browser. */
	async openOnGithub(workspaceId: WorkspaceId): Promise<Result<void>> {
		const context = await this.#deps.contextOf(workspaceId);
		if (!context.ok) return err(context.error);
		const found = context.value;
		const target = this.#targetBranchOf(found);
		if (!target.ok) return target;
		const forge = await this.#assertGithubRemote(found);
		if (!forge.ok) return forge;

		const settings = await this.#ghSettings();
		if (!settings.ok) return err(settings.error);
		const command = prCreateWeb(target.value, found.branch);
		const result = await this.#deps.git.run(
			command,
			this.#runOptions(settings.value, found.workspacePath),
		);
		if (!result.ok) return err(result.error);
		await this.recordGhResult(result.value);
		if (isSuccessfulExit(command, result.value.exitCode)) return ok(undefined);
		const text = `${result.value.stderr}\n${result.value.stdout}`;
		const message = githubFailureMessage(classifyGhFailure(text), text);
		return err(
			message === null
				? failedCommandError(command, result.value)
				: appError("github_failed", message),
		);
	}

	/** The target branch without its remote prefix, as `gh pr create --base` expects it. */
	#targetBranchOf(context: PrWorkspaceContext): Result<string> {
		const stored = context.targetBranch?.trim() ?? "";
		if (stored.length === 0) {
			return err(appError("github_target_unknown", "This workspace has no target branch."));
		}
		const prefix = `${context.remote}/`;
		return ok(
			context.remote.length > 0 && stored.startsWith(prefix) ? stored.slice(prefix.length) : stored,
		);
	}

	/** Refuses to act on a repository without a GitHub remote. */
	async #assertGithubRemote(context: PrWorkspaceContext): Promise<Result<void>> {
		if (context.remote.trim().length === 0) {
			return err(appError("github_not_github", "This repository has no GitHub remote."));
		}
		const url = await this.#deps.git.stdout(remoteGetUrl(context.remote), {
			cwd: context.workspacePath,
		});
		if (!url.ok) return err(url.error);
		return forgeForRemoteUrl(url.value) === "github"
			? ok(undefined)
			: err(appError("github_not_github", "This repository has no GitHub remote."));
	}

	/** Backs `Actions.pullRequests.fixErrors`: sends failing checks and log tails to the agent. */
	fixErrors(_workspaceId: WorkspaceId): Promise<Result<void>> {
		return notImplemented("PR-05");
	}

	rerunFailedChecks(_workspaceId: WorkspaceId): Promise<Result<void>> {
		return notImplemented("PR-05");
	}

	markReady(_workspaceId: WorkspaceId): Promise<Result<void>> {
		return notImplemented("PR-06");
	}

	merge(workspaceId: WorkspaceId): Promise<Result<void>> {
		return this.#flights.run(`merge:${workspaceId}`, async (): Promise<Result<void>> => {
			const context = await this.#deps.contextOf(workspaceId);
			if (!context.ok) return err(context.error);
			const { workspacePath, prNumber } = context.value;
			if (prNumber === null) {
				return err(appError("github_pr_missing", "This workspace has no pull request yet."));
			}

			const cwd = workspacePath;
			const settings = await this.#ghSettings();
			if (!settings.ok) return err(settings.error);
			const runOptions = this.#runOptions(settings.value, cwd);

			const head = await this.#deps.git.stdout(revParseHead(), { cwd });
			if (!head.ok) return err(head.error);
			if (head.value.length === 0) {
				return err(
					appError("github_head_unknown", "Merge blocked: can't read the workspace's HEAD commit."),
				);
			}

			const mergeMethodsQuery = repoMergeMethodsQuery();
			const allowed = await this.#deps.git.run(mergeMethodsQuery, runOptions);
			if (!allowed.ok) return err(allowed.error);
			await this.recordGhResult(allowed.value);
			if (!isSuccessfulExit(mergeMethodsQuery, allowed.value.exitCode)) {
				return err(failedCommandError(mergeMethodsQuery, allowed.value));
			}
			const method = chooseMergeMethod(allowed.value.stdout.trim());
			if (method === null) {
				return err(
					appError(
						"github_merge_not_allowed",
						"This repository doesn't allow merging pull requests.",
					),
				);
			}

			const command = prMerge(prNumber, method, head.value, false);
			return this.#deps.git.withWorktreeLock(workspacePath, async (): Promise<Result<void>> => {
				const result = await this.#deps.git.run(command, runOptions);
				if (!result.ok) return err(result.error);
				await this.recordGhResult(result.value);
				if (isSuccessfulExit(command, result.value.exitCode)) return ok(undefined);
				const text = `${result.value.stderr}\n${result.value.stdout}`;
				const message = githubFailureMessage(classifyGhFailure(text), text);
				return err(
					message === null
						? failedCommandError(command, result.value)
						: appError("github_failed", message),
				);
			});
		});
	}

	setAutoMerge(_workspaceId: WorkspaceId, _enabled: boolean): Promise<Result<void>> {
		return notImplemented("PR-06");
	}

	approve(_workspaceId: WorkspaceId): Promise<Result<void>> {
		return notImplemented("PR-06");
	}

	updateTitleAndBody(
		_workspaceId: WorkspaceId,
		_title: string,
		_body: string,
	): Promise<Result<void>> {
		return notImplemented("PR-06");
	}

	/**
	 * GIT-08: moves the base of the workspace's open pull request. Returns false when there is no
	 * open pull request, so the caller can fall back to the local fetch and reset.
	 */
	async moveOpenPullRequestBase(
		workspaceId: WorkspaceId,
		branch: string,
	): Promise<Result<boolean>> {
		const context = await this.#deps.contextOf(workspaceId);
		if (!context.ok) return err(context.error);
		const found = context.value;
		if (found.prNumber === null) return ok(false);

		const settings = await this.#ghSettings();
		if (!settings.ok) return err(settings.error);
		const runOptions = this.#runOptions(settings.value, found.workspacePath);

		const state = prViewState(found.prNumber);
		const stateResult = await this.#deps.git.run(state, runOptions);
		if (!stateResult.ok) return err(stateResult.error);
		await this.recordGhResult(stateResult.value);
		if (!isSuccessfulExit(state, stateResult.value.exitCode)) {
			return err(failedCommandError(state, stateResult.value));
		}
		const current = stateResult.value.stdout.trim().replace(/^"|"$/g, "");
		if (current !== "OPEN") return ok(false);

		const command = prEdit(found.prNumber, { base: branch });
		const edited = await this.#deps.git.run(command, runOptions);
		if (!edited.ok) return err(edited.error);
		await this.recordGhResult(edited.value);
		if (!isSuccessfulExit(command, edited.value.exitCode)) {
			return err(failedCommandError(command, edited.value));
		}
		return ok(true);
	}

	/** Runs `gh stack sync` for a stacked branch. */
	syncStack(_workspaceId: WorkspaceId): Promise<Result<void>> {
		return notImplemented("PR-08");
	}

	/**
	 * Catches a stack branch up with its rewritten upstream (PR-12). Runs on its own when polling
	 * sees the branch fall behind; skipping is the normal result, see `CatchUpSkipReason`.
	 */
	catchUpStackBranch(_workspaceId: WorkspaceId): Promise<Result<CatchUpOutcome>> {
		return notImplemented("PR-12");
	}

	/** Backs `Actions.pullRequests.requestReview`. */
	requestReview(_workspaceId: WorkspaceId, _logins: readonly string[]): Promise<Result<void>> {
		return notImplemented("PR-06");
	}

	/** Backs `Actions.pullRequests.removeReviewRequest`. */
	removeReviewRequest(_workspaceId: WorkspaceId, _login: string): Promise<Result<void>> {
		return notImplemented("PR-06");
	}

	/** Backs `Actions.pullRequests.link`. */
	linkPullRequest(_workspaceId: WorkspaceId, _urlOrNumber: string): Promise<Result<void>> {
		return notImplemented("PR-10");
	}

	/** Open issues, 50 newest, filtered by the picker's search text (services-map 5B.8.2). */
	async listIssues(remoteUrl: string, query: string): Promise<Result<IssueView[]>> {
		const repository = githubRepositoryFromRemote(remoteUrl);
		if (!repository.ok) return err(repository.error);
		const result = await this.#readGh(repositoryIssues(repositoryPath(repository.value)));
		if (!result.ok) return err(result.error);
		const parsed = parseGithubIssues(result.value);
		if (!parsed.ok) return err(parsed.error);
		return ok(
			parsed.value.filter((issue) =>
				matchesQuery(query, [issue.identifier, issue.title, issue.id]),
			),
		);
	}

	/** Open pull requests for the new-workspace picker, filtered by its search text. */
	async listPullRequests(remoteUrl: string, query: string): Promise<Result<PullRequestSummary[]>> {
		const repository = githubRepositoryFromRemote(remoteUrl);
		if (!repository.ok) return err(repository.error);
		const result = await this.#readGh(repositoryPullRequests(repositoryPath(repository.value)));
		if (!result.ok) return err(result.error);
		const parsed = parseGithubPullRequests(result.value);
		if (!parsed.ok) return err(parsed.error);
		return ok(
			parsed.value.filter((pullRequest) =>
				matchesQuery(query, [
					String(pullRequest.number),
					pullRequest.title,
					pullRequest.branch,
					pullRequest.authorLogin ?? "",
				]),
			),
		);
	}

	/** One pull request by number, for a link the user typed or picked. */
	async pullRequestByNumber(
		remoteUrl: string,
		number: number,
	): Promise<Result<PullRequestSummary>> {
		const repository = githubRepositoryFromRemote(remoteUrl);
		if (!repository.ok) return err(repository.error);
		const result = await this.#readGh(
			pullRequestByNumberCommand(repositoryPath(repository.value), number),
		);
		if (!result.ok) return err(result.error);
		const parsed = parseGithubPullRequest(result.value);
		if (!parsed.ok) return err(parsed.error);
		const { url: _url, body: _body, ...pullRequest } = parsed.value;
		return ok(pullRequest);
	}

	/** The user's eight most recently updated repositories (services-map 5B.1.10). */
	async recentRepos(): Promise<Result<GitHubRepoSummary[]>> {
		const result = await this.#readGh(recentRepositories());
		if (!result.ok) return err(result.error);
		return parseGithubRepos(result.value);
	}

	/** Backs `Actions.issues.attachToWorkspace` for GitHub issues and pull requests. Returns the file path. */
	async attachIssueToWorkspace(
		workspaceId: WorkspaceId,
		issue: Pick<IssueView, "provider" | "id">,
	): Promise<Result<string>> {
		if (issue.provider !== "github") {
			return err(
				appError("issue_provider_unsupported", "Only GitHub issues become GitHub context files."),
			);
		}
		const number = issueNumber(issue.id);
		if (!number.ok) return err(number.error);
		const context = await this.#deps.contextOf(workspaceId);
		if (!context.ok) return err(context.error);
		const repository = await this.#repositoryOf(context.value);
		if (!repository.ok) return err(repository.error);
		const fetched = await this.#readGh(
			issueByNumberCommand(repositoryPath(repository.value), number.value),
			context.value.workspacePath,
		);
		if (!fetched.ok) return err(fetched.error);
		const parsed = parseGithubIssue(fetched.value);
		if (!parsed.ok) return err(parsed.error);
		// GitHub's issue endpoint also returns pull requests. They get the pull request file name.
		if (parsed.value.pullRequest) {
			return this.attachPullRequestToWorkspace(workspaceId, number.value);
		}
		const relativePath = githubIssueContextPath(issue.id);
		const written = await this.#writeContextFile(
			context.value.workspacePath,
			relativePath,
			githubIssueContextFile(parsed.value),
		);
		return written.ok ? ok(relativePath) : err(written.error);
	}

	/** Writes a pull request as `.context/pull-requests/<n>.md`. Returns the relative path. */
	async attachPullRequestToWorkspace(
		workspaceId: WorkspaceId,
		number: number,
	): Promise<Result<string>> {
		const context = await this.#deps.contextOf(workspaceId);
		if (!context.ok) return err(context.error);
		const repository = await this.#repositoryOf(context.value);
		if (!repository.ok) return err(repository.error);
		const fetched = await this.#readGh(
			pullRequestByNumberCommand(repositoryPath(repository.value), number),
			context.value.workspacePath,
		);
		if (!fetched.ok) return err(fetched.error);
		const parsed = parseGithubPullRequest(fetched.value);
		if (!parsed.ok) return err(parsed.error);
		const relativePath = pullRequestContextPath(number);
		const written = await this.#writeContextFile(
			context.value.workspacePath,
			relativePath,
			githubPullRequestContextFile(parsed.value),
		);
		return written.ok ? ok(relativePath) : err(written.error);
	}

	/** Runs a read-only `gh` call and records its health, like every other GitHub action. */
	async #readGh(command: GitCommand, cwd = this.#deps.probeCwd): Promise<Result<string>> {
		const settings = await this.#ghSettings();
		if (!settings.ok) return err(settings.error);
		const result = await this.#deps.git.run(command, this.#runOptions(settings.value, cwd));
		if (!result.ok) return err(result.error);
		await this.recordGhResult(result.value);
		if (isSuccessfulExit(command, result.value.exitCode)) return ok(result.value.stdout);
		const text = `${result.value.stderr}\n${result.value.stdout}`;
		const message = githubFailureMessage(classifyGhFailure(text), text);
		return err(
			message === null
				? failedCommandError(command, result.value)
				: appError("github_failed", message),
		);
	}

	/** The GitHub repository of a workspace, from its configured remote. */
	async #repositoryOf(context: PrWorkspaceContext): Promise<Result<GithubRepository>> {
		const url = await this.#deps.git.stdout(remoteGetUrl(context.remote), {
			cwd: context.workspacePath,
		});
		if (!url.ok) return err(url.error);
		return githubRepositoryFromRemote(url.value);
	}

	/** Writes a context file under the workspace, creating its folder first. */
	async #writeContextFile(
		workspacePath: string,
		relativePath: string,
		text: string,
	): Promise<Result<void>> {
		const fs = this.#deps.fs;
		if (fs === undefined) {
			return err(
				appError("github_context_unavailable", "The app can't write into this workspace."),
			);
		}
		const absolute = absolutePath(workspacePath, relativePath);
		const slash = absolute.lastIndexOf("/");
		const made = await fs.mkdirp(absolute.slice(0, slash));
		if (!made.ok) return err(made.error);
		return fs.writeTextAtomic(absolute, text);
	}

	/**
	 * Backs `Actions.accounts.setGitHubToken`: the Keychain entry `gh` gets as GH_TOKEN (D029).
	 * A value that is not shaped like a GitHub token is only a warning (`githubTokenWarning`),
	 * which the caller confirms; it still saves, because enterprise tokens can use another prefix.
	 */
	async setToken(token: string | null): Promise<Result<void>> {
		const keychain = this.#deps.keychain;
		if (keychain === undefined) {
			return err(
				appError(
					"github_keychain_unavailable",
					"The app can't reach the Keychain to store the GitHub token.",
				),
			);
		}
		if (token === null) return keychain.delete(GH_PAT_KEYCHAIN_KEY);
		const trimmed = token.trim();
		// An empty token would reach `gh` as an empty GH_TOKEN and break a working sign-in.
		if (trimmed === "") {
			return err(appError("github_token_empty", "Enter a token, or clear the saved one."));
		}
		return keychain.set(GH_PAT_KEYCHAIN_KEY, trimmed);
	}
}
